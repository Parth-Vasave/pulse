from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.models import Monitor, User
from app.schemas.monitor import MonitorCreate, MonitorUpdate
from app.services.incident_service import close_open_incident, reset_health
from app.services.ssrf import SSRFError, validate_url

log = get_logger("app.monitors")

_FIELDS = (
    "name",
    "url",
    "method",
    "headers",
    "body",
    "expected_status_code",
    "timeout_seconds",
    "interval_seconds",
    "response_time_threshold_ms",
    "failure_threshold",
    "recovery_threshold",
    "check_retries",
    "enabled",
    "show_on_status_page",
)


def _check_target(url: str) -> None:
    try:
        validate_url(url)
    except SSRFError as exc:
        raise AppError(422, f"URL not allowed: {exc}", code="invalid_target") from exc


def create_monitor(db: Session, user: User, data: MonitorCreate) -> Monitor:
    count = db.scalar(select(func.count()).select_from(Monitor).where(Monitor.user_id == user.id))
    if (count or 0) >= get_settings().max_monitors_per_user:
        raise AppError(409, "Monitor limit reached", code="limit_reached")
    _check_target(data.url)
    monitor = Monitor(
        user_id=user.id,
        assertions=[a.model_dump() for a in data.assertions],
        next_check_at=datetime.now(UTC),
        **{f: getattr(data, f) for f in _FIELDS},
    )
    db.add(monitor)
    db.commit()
    log.info("monitor_created", extra={"monitor_id": monitor.id, "user_id": user.id})
    return monitor


def update_monitor(db: Session, monitor: Monitor, patch: MonitorUpdate) -> Monitor:
    """Merge the patch over current values and re-validate the whole thing, so a PATCH can
    never produce a configuration that POST would reject."""
    merged = {f: getattr(monitor, f) for f in _FIELDS} | {"assertions": monitor.assertions}
    merged |= patch.model_dump(exclude_unset=True)
    try:
        data = MonitorCreate.model_validate(merged)
    except ValidationError as exc:
        raise AppError(
            422,
            "Request validation failed",
            code="validation_error",
            details=[{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()],
        ) from exc
    if data.url != monitor.url:
        _check_target(data.url)
    # Serialise with any check result being recorded for this monitor right now.
    db.refresh(monitor, with_for_update=True)
    was_enabled = monitor.enabled
    retargeted = (data.url, data.method) != (monitor.url, monitor.method)
    pausing = was_enabled and not data.enabled
    for f in _FIELDS:
        setattr(monitor, f, getattr(data, f))
    monitor.assertions = [a.model_dump() for a in data.assertions]
    if data.enabled and not was_enabled:
        monitor.next_check_at = datetime.now(UTC)  # resumed: check right away
    if retargeted or pausing:
        # The old UP/DOWN state, streaks and any open incident describe something that no longer
        # applies. Close the incident (no recovery alert) and start the state machine fresh.
        why = "the monitor's URL or method was changed" if retargeted else "monitoring was paused"
        close_open_incident(db, monitor, why)
        reset_health(monitor, clear_last_check=retargeted)
        log.info(
            "monitor_health_reset", extra={"monitor_id": monitor.id, "reason": "retargeted" if retargeted else "paused"}
        )
    db.commit()
    return monitor


def delete_monitor(db: Session, monitor: Monitor) -> None:
    monitor_id = monitor.id
    db.delete(monitor)
    db.commit()
    log.info("monitor_deleted", extra={"monitor_id": monitor_id})
