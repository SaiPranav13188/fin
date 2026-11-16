from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..schemas import LoginIn, RefreshIn, SignupIn, TokenOut, UserOut, UserPatch
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


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    user_id, new_refresh = rotate_refresh_token(db, body.refresh_token)
    return TokenOut(access_token=make_access_token(user_id), refresh_token=new_refresh)


@router.post("/logout", status_code=204)
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    revoke_refresh_token(db, body.refresh_token)


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
    """Account deletion (required by Google Play). Personal data goes; shared ledgers keep an anonymous member."""
    from ..models import Member
    for m in db.scalars(select(Member).where(Member.user_id == user.id)):
        m.user_id, m.upi_id, m.verified, m.name = None, None, False, "Former member"
    db.delete(db.get(User, user.id))
    db.commit()
