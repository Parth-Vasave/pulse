from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.core.security import API_KEY_PREFIX, credential_version, decode_access_token, hash_api_key
from app.models import ApiKey, Monitor, User


def _unauthorized() -> AppError:
    return AppError(401, "Not authenticated")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Accepts, in order: `Authorization: Bearer apm_...` (API key), Bearer JWT, session cookie."""
    auth = request.headers.get("authorization", "")
    token: str | None = None
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token.startswith(API_KEY_PREFIX):
            key = db.scalars(select(ApiKey).where(ApiKey.key_hash == hash_api_key(token))).first()
            if key is None or key.revoked_at is not None:
                raise _unauthorized()
            key.last_used_at = datetime.now(UTC)
            user = db.get(User, key.user_id)
            if user is None:
                raise _unauthorized()
            db.commit()
            return user
    else:
        token = request.cookies.get(get_settings().cookie_name)
    claims = decode_access_token(token) if token else None
    user = db.get(User, claims[0]) if claims else None
    # A token minted before the last password change carries an old credential version: reject it.
    if user is None or claims is None or claims[1] != credential_version(user.password_changed_at):
        raise _unauthorized()
    return user


def get_owned_monitor(
    monitor_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Monitor:
    """Tenant isolation: another user's monitor is indistinguishable from a missing one (404)."""
    monitor = db.scalars(select(Monitor).where(Monitor.id == monitor_id, Monitor.user_id == user.id)).first()
    if monitor is None:
        raise AppError(404, "Monitor not found")
    return monitor
