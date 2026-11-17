import hashlib
import hmac
import html
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import PasswordReset, RefreshToken, User
from ..schemas import ForgotIn, LoginIn, RefreshIn, ResetIn, SignupIn, TokenOut, UserOut, UserPatch
from ..services.demo import create_demo_user, delete_account
from ..services.mailer import mail_enabled, send_mail
from ..security import (check_rate, client_ip, current_user, hash_password, issue_refresh_token, make_access_token,
                        revoke_refresh_token, rotate_refresh_token, verify_password)

router = APIRouter(prefix="/auth", tags=["auth"])

# Verifying against a dummy hash keeps login timing the same whether or not the email exists.
_DUMMY = hash_password("not-a-real-password")


def _tokens(db: Session, user_id: str) -> TokenOut:
    refresh = issue_refresh_token(db, user_id)
    db.commit()
    return TokenOut(access_token=make_access_token(user_id), refresh_token=refresh)


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, request: Request, db: Session = Depends(get_db)):
    check_rate(f"signup:{client_ip(request)}", get_settings().rate_login_per_minute)
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Try logging in.")
    user = User(name=body.name.strip(), email=email, password_hash=hash_password(body.password),
                upi_id=body.upi_id, language=body.language)
    db.add(user)
    db.flush()
    return _tokens(db, user.id)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    limit = get_settings().rate_login_per_minute
    check_rate(f"login:{client_ip(request)}", limit)
    check_rate(f"login:{body.email.lower()}", limit)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY)
    if not user or not ok:
        raise HTTPException(401, "Wrong email or password")
    return _tokens(db, user.id)


@router.post("/demo", response_model=TokenOut, status_code=201)
def demo(request: Request, db: Session = Depends(get_db)):
    """A fresh sample account for trying Fin without signing up. It is deleted after 24 hours."""
    ip = client_ip(request)
    check_rate(f"demo:{ip}", 5)
    check_rate(f"demo-hour:{ip}", 20, window=3600)
    user = create_demo_user(db)
    return _tokens(db, user.id)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    user_id, new_refresh = rotate_refresh_token(db, body.refresh_token)
    return TokenOut(access_token=make_access_token(user_id), refresh_token=new_refresh)


@router.post("/logout", status_code=204)
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    revoke_refresh_token(db, body.refresh_token)


RESET_MINUTES = 15
RESET_ATTEMPTS = 5


def _code_hash(user_id: str, code: str) -> str:
    return hmac.new(get_settings().jwt_secret.encode(), f"{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


@router.post("/forgot")
def forgot(body: ForgotIn, request: Request, db: Session = Depends(get_db)):
    """Emails a 6-digit code. Always answers the same way, so it can't be used to find out who has an account."""
    if not mail_enabled():
        raise HTTPException(503, "Password reset isn't switched on yet. Please try again later.")
    limit = get_settings().rate_login_per_minute
    check_rate(f"forgot:{client_ip(request)}", limit)
    check_rate(f"forgot:{body.email.lower()}", 3)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user:
        db.query(PasswordReset).filter_by(user_id=user.id, used=False).update({"used": True})
        code = f"{secrets.randbelow(1_000_000):06d}"
        db.add(PasswordReset(user_id=user.id, code_hash=_code_hash(user.id, code),
                             expires_at=datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES)))
        db.commit()
        send_mail(user.email, f"Your Fin code: {code}",
                  f"Hi {user.name},\n\nYour Fin password reset code is {code}. It works for {RESET_MINUTES} minutes.\n\n"
                  "If you didn't ask for this, ignore this email. Your password stays the same.",
                  f"<div style='font-family:sans-serif;max-width:420px'><p>Hi {html.escape(user.name)},</p>"
                  f"<p>Your Fin password reset code is</p><p style='font-size:32px;font-weight:800;letter-spacing:6px'>{code}</p>"
                  f"<p>It works for {RESET_MINUTES} minutes. If you didn't ask for this, ignore this email.</p></div>")
    return {"ok": True, "message": "If that email has a Fin account, a code is on its way."}


@router.post("/reset", response_model=TokenOut)
def reset(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    check_rate(f"reset:{client_ip(request)}", get_settings().rate_login_per_minute)
    bad = HTTPException(400, "That code is wrong or has expired. Ask for a new one.")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user:
        raise bad
    row = db.scalar(select(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.used.is_(False))
                    .order_by(PasswordReset.created_at.desc()))
    if not row:
        raise bad
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    row.attempts += 1
    if row.attempts > RESET_ATTEMPTS or expires < datetime.now(timezone.utc):
        row.used = True
        db.commit()
        raise bad
    if not hmac.compare_digest(row.code_hash, _code_hash(user.id, body.code.strip())):
        db.commit()
        raise bad
    row.used = True
    user.password_hash = hash_password(body.password)
    db.query(RefreshToken).filter_by(user_id=user.id).update({"revoked": True})  # sign out every other phone
    db.commit()
    return _tokens(db, user.id)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.merge(user)
    db.commit()
    return user


@router.delete("/me", status_code=204)
def delete_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Account deletion (required by Google Play).

    Personal data goes: profile, login sessions, drafts, assistant logs, bills and subscriptions.
    Shared groups stay for the friends who still use them, with this person shown as "Former member".
    A group passes to another member who has an account; a group nobody else uses is deleted.
    """
    delete_account(db, db.get(User, user.id))
    db.commit()
