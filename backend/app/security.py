import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import RefreshToken, User, new_id

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(dk))
    except Exception:
        return False


def make_access_token(user_id: str) -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.access_token_minutes)
    return jwt.encode({"sub": user_id, "exp": exp, "typ": "access"}, s.jwt_secret, algorithm="HS256")


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_refresh_token(db: Session, user_id: str, family: str | None = None) -> str:
    raw = secrets.token_urlsafe(48)
    db.add(RefreshToken(
        user_id=user_id, token_hash=_hash_token(raw), family=family or new_id(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=get_settings().refresh_token_days),
    ))
    return raw


def rotate_refresh_token(db: Session, raw: str) -> tuple[str, str]:
    """Returns (user_id, new_refresh_token). A reused token revokes its whole family."""
    row = db.query(RefreshToken).filter_by(token_hash=_hash_token(raw)).first()
    bad = HTTPException(401, "Session expired. Please log in again.")
    if not row:
        raise bad
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if row.revoked or expires < datetime.now(timezone.utc):
        db.query(RefreshToken).filter_by(family=row.family).update({"revoked": True})
        db.commit()
        raise bad
    row.revoked = True
    new_raw = issue_refresh_token(db, row.user_id, row.family)
    db.commit()
    return row.user_id, new_raw


def revoke_refresh_token(db: Session, raw: str) -> None:
    row = db.query(RefreshToken).filter_by(token_hash=_hash_token(raw)).first()
    if row:
        db.query(RefreshToken).filter_by(family=row.family).update({"revoked": True})
        db.commit()


def user_from_token(db: Session, token: str) -> User | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if data.get("typ") != "access":
        return None
    return db.get(User, data.get("sub"))


_bearer = HTTPBearer(auto_error=False)


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> User:
    user = user_from_token(db, cred.credentials) if cred else None
    if not user:
        raise HTTPException(401, "Not signed in")
    return user


# ---- rate limiting (Redis when configured, otherwise per-process memory) ----
_hits: dict[str, deque] = defaultdict(deque)
_redis = None


def _get_redis():
    global _redis
    url = get_settings().redis_url
    if url and _redis is None:
        import redis
        _redis = redis.Redis.from_url(url, socket_timeout=1)
    return _redis


def check_rate(key: str, limit: int, window: int = 60) -> None:
    r = _get_redis()
    if r is not None:
        try:
            k = f"rl:{key}:{int(time.time() // window)}"
            n = r.incr(k)
            if n == 1:
                r.expire(k, window)
            if n > limit:
                raise HTTPException(429, "Too many requests. Take a breath and try again in a minute.")
            return
        except HTTPException:
            raise
        except Exception:
            pass  # Redis down: fall through to memory
    q = _hits[key]
    t = time.monotonic()
    while q and q[0] < t - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many requests. Take a breath and try again in a minute.")
    q.append(t)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
