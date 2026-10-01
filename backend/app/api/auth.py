from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.schemas.auth import LoginIn, RegisterIn, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = get_logger("app.auth")
# Verified against when the email is unknown, so response time doesn't reveal which emails exist.
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def _set_cookie(response: Response, user_id: int) -> None:
    s = get_settings()
    response.set_cookie(
        s.cookie_name,
        create_access_token(user_id),
        max_age=s.access_token_minutes * 60,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)) -> User:
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "An account with this email already exists") from None
    log.info("user_registered", extra={"user_id": user.id})
    _set_cookie(response, user.id)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> User:
    user = db.scalars(select(User).where(User.email == payload.email)).first()
    valid = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not valid:
        log.info("login_failed")
        raise AppError(401, "Invalid email or password")
    _set_cookie(response, user.id)
    return user


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(get_settings().cookie_name, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
