"""Auth helpers: password hashing, JWT issuance, current-user dependency."""

import os
import time
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional
from types import SimpleNamespace

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db

# ---------------------------------------------------------------------------
# In-process user cache — avoids a DB round-trip on every authenticated
# request.  Entries expire after 60 s so stale data (e.g. a deleted account)
# is never served for more than a minute.  The cache is keyed by user_id
# (the JWT "sub" claim) and is safe for concurrent async use because CPython's
# GIL protects dict reads/writes.
# ---------------------------------------------------------------------------
_USER_CACHE: dict[str, tuple[float, SimpleNamespace]] = {}
_USER_CACHE_TTL = 60.0  # seconds
_CACHE_LOCK = threading.Lock()


def _cache_get(user_id: str) -> Optional[SimpleNamespace]:
    entry = _USER_CACHE.get(user_id)
    if entry and (time.monotonic() - entry[0]) < _USER_CACHE_TTL:
        return entry[1]
    return None


def _cache_set(user_id: str, user: SimpleNamespace) -> None:
    with _CACHE_LOCK:
        _USER_CACHE[user_id] = (time.monotonic(), user)


def _cache_invalidate(user_id: str) -> None:
    _USER_CACHE.pop(user_id, None)

JWT_ALGORITHM = "HS256"
ACCESS_TTL_MIN = 60 * 24 * 7  # 7 days (long-lived; offline-friendly for CHWs)


def get_jwt_secret() -> str:
    # Keep auth functional in misconfigured preview/local environments.
    # Production should always set JWT_SECRET explicitly.
    return os.environ.get("JWT_SECRET", "communitymed-dev-jwt-secret-change-me")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_db)
):
    # Authorization header takes precedence so that a stale cookie can never
    # silently authenticate a request that explicitly carries a different
    # bearer token.
    token: Optional[str] = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload.get("sub")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Fast path: return cached user to avoid a DB round-trip on every request.
    cached = _cache_get(str(user_id))
    if cached:
        return cached

    # Cache miss — fetch from DB (includes phone + best_suited_role).
    row = (
        await db.execute(
            text(
                "SELECT id, email, password_hash, name, role, "
                "COALESCE(phone, '') AS phone, "
                "COALESCE(best_suited_role, '') AS best_suited_role "
                "FROM users WHERE id = :id LIMIT 1"
            ),
            {"id": str(user_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")

    user = SimpleNamespace(
        id=str(row["id"]),
        email=row["email"],
        password_hash=row["password_hash"],
        name=row["name"] or "",
        role=row["role"] or "worker",
        phone=row["phone"] or "",
        best_suited_role=row["best_suited_role"] or "",
    )
    _cache_set(str(user_id), user)
    return user
