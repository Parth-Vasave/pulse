from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.security import generate_api_key
from app.models import ApiKey, NotificationChannel, User
from app.schemas.settings import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    ChannelCreate,
    ChannelOut,
    ChannelUpdate,
    StatusPageSettings,
)
from app.services.notifications.base import IncidentMessage, NotificationError
from app.services.notifications.providers import get_provider
from app.services.ssrf import SSRFError, validate_url

router = APIRouter(prefix="/api", tags=["settings"])
log = get_logger("app.settings")


def _mask(channel: NotificationChannel) -> str:
    cfg = channel.configuration
    if channel.type == "email":
        return str(cfg.get("address", ""))
    url = str(cfg.get("url", ""))
    return url.split("//", 1)[-1].split("/", 1)[0] + "/…"  # host only: webhook paths carry secrets


def _channel_out(c: NotificationChannel) -> ChannelOut:
    return ChannelOut(id=c.id, type=c.type, name=c.name, enabled=c.enabled, target=_mask(c), created_at=c.created_at)


def _owned_channel(db: Session, user: User, channel_id: int) -> NotificationChannel:
    c = db.scalars(
        select(NotificationChannel).where(NotificationChannel.id == channel_id, NotificationChannel.user_id == user.id)
    ).first()
    if c is None:
        raise AppError(404, "Channel not found")
    return c


@router.get("/channels", response_model=list[ChannelOut])
def list_channels(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(NotificationChannel).where(NotificationChannel.user_id == user.id).order_by(NotificationChannel.id)
    ).all()
    return [_channel_out(c) for c in rows]


@router.post("/channels", response_model=ChannelOut, status_code=201)
def create_channel(data: ChannelCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = db.scalar(
        select(func.count()).select_from(NotificationChannel).where(NotificationChannel.user_id == user.id)
    )
    if (count or 0) >= get_settings().max_channels_per_user:
        raise AppError(409, "Channel limit reached", code="limit_reached")
    if data.type == "email":
        config = {"address": data.address}
    else:
        try:
            validate_url(data.url or "")
        except SSRFError as exc:
            raise AppError(422, f"URL not allowed: {exc}", code="invalid_target") from exc
        config = {"url": data.url}
    channel = NotificationChannel(
        user_id=user.id, type=data.type, name=data.name, configuration=config, enabled=data.enabled
    )
    db.add(channel)
    db.commit()
    return _channel_out(channel)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
def update_channel(
    channel_id: int, patch: ChannelUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    channel = _owned_channel(db, user, channel_id)
    for field, value in patch.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(channel, field, value)
    db.commit()
    return _channel_out(channel)


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(channel_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    db.delete(_owned_channel(db, user, channel_id))
    db.commit()


@router.post("/channels/{channel_id}/test", status_code=200)
def test_channel(channel_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = _owned_channel(db, user, channel_id)
    now = datetime.now(UTC)
    message = IncidentMessage(
        "created", 0, "Test monitor", "https://example.com/health", "This is a test notification", now
    )
    try:
        get_provider(channel.type).send(channel.configuration, message)
    except NotificationError as exc:
        raise AppError(502, f"Delivery failed: {exc}", code="delivery_failed") from exc
    return {"status": "sent"}


@router.get("/api-keys", response_model=list[ApiKeyOut])
def list_keys(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(ApiKey).where(ApiKey.user_id == user.id).order_by(ApiKey.id.desc())).all()


@router.post("/api-keys", response_model=ApiKeyCreated, status_code=201)
def create_key(data: ApiKeyCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active = db.scalar(
        select(func.count()).select_from(ApiKey).where(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None))
    )
    if (active or 0) >= get_settings().max_api_keys_per_user:
        raise AppError(409, "API key limit reached", code="limit_reached")
    raw, prefix, key_hash = generate_api_key()
    key = ApiKey(user_id=user.id, name=data.name, prefix=prefix, key_hash=key_hash)
    db.add(key)
    db.commit()
    log.info("api_key_created", extra={"user_id": user.id, "key_id": key.id})
    return ApiKeyCreated(**ApiKeyOut.model_validate(key).model_dump(), key=raw)


@router.delete("/api-keys/{key_id}", status_code=204)
def revoke_key(key_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    key = db.scalars(select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id)).first()
    if key is None:
        raise AppError(404, "API key not found")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
        db.commit()
        log.info("api_key_revoked", extra={"user_id": user.id, "key_id": key.id})


@router.get("/status-page", response_model=StatusPageSettings)
def get_status_page(user: User = Depends(get_current_user)):
    return StatusPageSettings(enabled=user.status_page_enabled, slug=user.status_page_slug)


@router.put("/status-page", response_model=StatusPageSettings)
def set_status_page(data: StatusPageSettings, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.status_page_enabled = data.enabled
    user.status_page_slug = data.slug
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "That slug is already taken") from None
    return data
