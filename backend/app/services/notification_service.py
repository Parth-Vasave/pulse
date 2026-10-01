"""Delivers queued notifications. Failures are recorded, never raised into incident logic."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.metrics import notifications_failed_total, notifications_sent_total
from app.models import Incident, IncidentEvent, Monitor, Notification, NotificationChannel
from app.services.notifications.base import IncidentMessage, NotificationError
from app.services.notifications.providers import get_provider

log = get_logger("app.notifications")

MAX_ATTEMPTS = 5


def _build_message(notification: Notification, incident: Incident, monitor: Monitor) -> IncidentMessage:
    return IncidentMessage(
        kind="created" if notification.event_type == "created" else "resolved",
        incident_id=incident.id,
        monitor_name=monitor.name,
        monitor_url=monitor.url,
        reason=incident.reason,
        started_at=incident.started_at,
        resolved_at=incident.resolved_at,
    )


def deliver(db: Session, notification_id: int) -> NotificationError | None:
    """Attempt one delivery.

    Returns None when finished (sent, failed permanently, or nothing to do). Returns the
    error when the caller should schedule a retry. Row state is updated here.
    """
    # SKIP LOCKED: if another worker is already delivering this row, do nothing (no duplicate sends).
    n = db.scalars(
        select(Notification).where(Notification.id == notification_id).with_for_update(skip_locked=True)
    ).first()
    if n is None or n.status in ("sent", "failed"):
        return None
    channel = db.get(NotificationChannel, n.channel_id) if n.channel_id else None
    incident = db.get(Incident, n.incident_id)
    monitor = db.get(Monitor, incident.monitor_id) if incident else None
    if channel is None or not channel.enabled or incident is None or monitor is None:
        n.status, n.error_message = "failed", "Channel removed or disabled"
        return None

    n.attempts += 1
    try:
        get_provider(channel.type).send(channel.configuration, _build_message(n, incident, monitor))
    except NotificationError as exc:
        n.error_message = str(exc)
        notifications_failed_total.labels(channel.type).inc()
        log.warning(
            "notification_failed",
            extra={
                "notification_id": n.id,
                "channel_type": channel.type,
                "attempt": n.attempts,
                "error": str(exc),
                "retryable": exc.retryable,
            },
        )
        if exc.retryable and n.attempts < MAX_ATTEMPTS:
            return exc
        n.status = "failed"
        db.add(
            IncidentEvent(
                incident_id=incident.id,
                occurred_at=datetime.now(UTC),
                event_type="notification_failed",
                message=f"{channel.type} notification '{channel.name}' failed: {exc}",
            )
        )
        return None

    n.status, n.sent_at, n.error_message = "sent", datetime.now(UTC), None
    notifications_sent_total.labels(channel.type).inc()
    db.add(
        IncidentEvent(
            incident_id=incident.id,
            occurred_at=n.sent_at,
            event_type="notification_sent",
            message=f"{channel.type} notification sent to '{channel.name}'",
        )
    )
    log.info("notification_sent", extra={"notification_id": n.id, "channel_type": channel.type})
    return None
