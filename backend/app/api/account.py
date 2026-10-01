from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.security import hash_password, verify_password
from app.core.session import clear_session_cookie, set_session_cookie
from app.models import User
from app.schemas.account import ChangeEmailIn, ChangePasswordIn, DeleteAccountIn
from app.schemas.auth import UserOut

router = APIRouter(prefix="/api/account", tags=["account"])
log = get_logger("app.account")


def _require_password(user: User, password: str) -> None:
    """Re-authentication for sensitive actions. 403, not 401: the session itself is valid, and a 401
    would make clients think the user was logged out."""
    if not verify_password(password, user.password_hash):
        log.info("account_reauth_failed", extra={"user_id": user.id})
        raise AppError(403, "Current password is incorrect", code="incorrect_password")


@router.post("/email", response_model=UserOut)
def change_email(data: ChangeEmailIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_password(user, data.current_password)
    if data.new_email == user.email:
        raise AppError(422, "That is already your email address", code="validation_error")
    taken = db.scalars(select(User.id).where(User.email == data.new_email)).first()
    if taken:
        raise AppError(409, "An account with this email already exists")
    user.email = data.new_email
    try:
        db.commit()
    except IntegrityError:  # lost a race with another registration
        db.rollback()
        raise AppError(409, "An account with this email already exists") from None
    log.info("email_changed", extra={"user_id": user.id})
    return user


@router.post("/password", status_code=204)
def change_password(
    data: ChangePasswordIn, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    """Changing the password signs out every other session (their tokens carry the old credential
    version). This session gets a fresh cookie. API keys are unaffected; revoke them separately."""
    _require_password(user, data.current_password)
    user.password_hash = hash_password(data.new_password)
    user.password_changed_at = datetime.now(UTC)
    db.commit()
    set_session_cookie(response, user)
    log.info("password_changed", extra={"user_id": user.id})


@router.post("/delete", status_code=204)
def delete_account(
    data: DeleteAccountIn, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    """Permanently deletes the user. Monitors, results, incidents, channels, notifications and API keys
    go with it via ON DELETE CASCADE."""
    _require_password(user, data.current_password)
    user_id = user.id
    db.delete(user)
    db.commit()
    clear_session_cookie(response)
    log.info("account_deleted", extra={"user_id": user_id})
