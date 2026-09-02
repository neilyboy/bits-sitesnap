"""PIN-based auth + JWT issuance.

PIN is stored as an argon2 hash in SITESNAP_PIN_HASH. JWTs are HS256 signed
with JWT_SECRET and carry an `exp` claim.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

_hasher = PasswordHasher()
_bearer = HTTPBearer(auto_error=False)

# Simple in-memory rate limiter for failed PIN attempts.
# (single-process, single-user — sufficient.)
_failed_attempts: dict[str, list[float]] = {}
_MAX_ATTEMPTS = 5
_LOCKOUT_SEC = 300


def _client_key(request) -> str:  # noqa: ANN001
    return request.client.host if request and request.client else "unknown"


def check_rate_limit(client_key: str) -> None:
    now = time.time()
    attempts = [t for t in _failed_attempts.get(client_key, []) if now - t < _LOCKOUT_SEC]
    _failed_attempts[client_key] = attempts
    if len(attempts) >= _MAX_ATTEMPTS:
        wait = int(_LOCKOUT_SEC - (now - attempts[0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {wait}s.",
        )


def record_failed_attempt(client_key: str) -> None:
    _failed_attempts.setdefault(client_key, []).append(time.time())


def clear_failed_attempts(client_key: str) -> None:
    _failed_attempts.pop(client_key, None)


def verify_pin(pin: str) -> bool:
    settings = get_settings()
    if not settings.sitesnap_pin_hash:
        # No PIN configured: refuse all logins until setup is complete.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PIN not configured. Set SITESNAP_PIN_HASH before logging in.",
        )
    try:
        return _hasher.verify(settings.sitesnap_pin_hash, pin)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def issue_token() -> tuple[str, datetime]:
    settings = get_settings()
    if not settings.jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JWT_SECRET not configured.",
        )
    exp = datetime.now(timezone.utc) + timedelta(days=settings.jwt_ttl_days)
    payload = {"exp": exp, "iat": datetime.now(timezone.utc), "sub": "sitesnap-user"}
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, exp


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
        )


def require_auth(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    return decode_token(creds.credentials)


def hash_pin(pin: str) -> str:
    """Hash a PIN for storage. Used by the CLI helper script."""
    return _hasher.hash(pin)
