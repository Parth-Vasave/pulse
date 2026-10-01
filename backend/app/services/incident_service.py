"""Applies a check outcome to monitor health and the incident lifecycle.

Everything for one outcome happens in ONE transaction under a row lock on the
monitor, so (a) the result, the counters and the incident can never diverge, and
(b) two workers checking the same monitor serialise instead of racing into a
duplicate incident. The partial unique index on open incidents is the backstop.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.metrics import incidents_created_total, incidents_resolved_total
from app.models import CheckResult, Incident, IncidentEvent, Monitor, Notification, NotificationChannel
from app.services.state_machine import Action, HealthState, Status, next_state

log = get_logger("app.incidents")


@dataclass(frozen=True)
class CheckOutcome:
    checked_at: datetime
    success: bool
    status_code: int | None = None
    response_time_ms: int | None = None
    check_duration_ms: int | None = None
    error_type: str | None = None
    error_message: str | None = None


def _describe_failure(outcome: CheckOutcome) -> str:
    if outcome.error_message:
        return outcome.error_message
    return outcome.error_type or "check failed"


def _add_event(db: Session, incident_id: int, at: datetime, kind: str, message: str) -> None:
    db.add(IncidentEvent(incident_id=incident_id, occurred_at=at, event_type=kind, message=message))


def _queue_notifications(db: Session, incident: Incident, monitor: Monitor, event_type: str) -> list[int]:
    channels = db.scalars(
        select(NotificationChannel).where(
            NotificationChannel.user_id == monitor.user_id, NotificationChannel.enabled.is_(True)
        )
    ).all()
    rows = [Notification(incident_id=incident.id, channel_id=c.id, event_type=event_type) for c in channels]
    db.add_all(rows)
    db.flush()
    return [r.id for r in rows]


def _recent_results(db: Session, monitor_id: int, limit: int) -> list[CheckResult]:
    rows = db.scalars(
        select(CheckResult)
        .where(CheckResult.monitor_id == monitor_id)
        .order_by(CheckResult.checked_at.desc(), CheckResult.id.desc())
        .limit(limit)
    ).all()
    return list(reversed(rows))


def _open_incident(
    db: Session, monitor: Monitor, outcome: CheckOutcome, failures: int
) -> tuple[Incident | None, list[int]]:
    incident = Incident(
        monitor_id=monitor.id,
        started_at=outcome.checked_at,
        status="open",
        failure_count=failures,
        reason=f"{failures} consecutive failures. Last error: {_describe_failure(outcome)}",
    )
    try:
        with db.begin_nested():  # savepoint: a unique violation must not poison the outer transaction
            db.add(incident)
            db.flush()
    except IntegrityError:
        log.warning("duplicate_incident_prevented", extra={"monitor_id": monitor.id})
        return None, []

    streak = _recent_results(db, monitor.id, failures)
    for i, r in enumerate(streak):
        label = "First failure" if i == 0 else f"Failure #{i + 1}"
        detail = r.error_message or r.error_type or (f"HTTP {r.status_code}" if r.status_code else "failed")
        _add_event(db, incident.id, r.checked_at, "first_failure" if i == 0 else "failure", f"{label}: {detail}")
    _add_event(
        db,
        incident.id,
        outcome.checked_at,
        "incident_created",
        f"Incident created after {failures} consecutive failures",
    )
    ids = _queue_notifications(db, incident, monitor, "created")
    incidents_created_total.inc()
    log.info("incident_created", extra={"monitor_id": monitor.id, "incident_id": incident.id})
    return incident, ids


def _resolve_incident(db: Session, monitor: Monitor, outcome: CheckOutcome, successes: int) -> list[int]:
    incident = db.scalars(select(Incident).where(Incident.monitor_id == monitor.id, Incident.status == "open")).first()
    if incident is None:
        return []
    incident.status = "resolved"
    incident.resolved_at = outcome.checked_at
    incident.recovery_count = successes
    streak = _recent_results(db, monitor.id, successes)
    for i, r in enumerate(streak[:-1]):
        _add_event(db, incident.id, r.checked_at, "recovery_check", f"Recovery check {i + 1}/{successes} passed")
    _add_event(db, incident.id, outcome.checked_at, "recovered", "API recovered")
    _add_event(db, incident.id, outcome.checked_at, "incident_resolved", "Incident resolved")
    db.flush()
    ids = _queue_notifications(db, incident, monitor, "resolved")
    incidents_resolved_total.inc()
    log.info("incident_resolved", extra={"monitor_id": monitor.id, "incident_id": incident.id})
    return ids


def reset_health(monitor: Monitor, *, clear_last_check: bool = False) -> None:
    """Forget accumulated health so the state machine starts fresh (UNKNOWN, no streaks)."""
    monitor.status = Status.UNKNOWN.value
    monitor.consecutive_failures = 0
    monitor.consecutive_successes = 0
    monitor.last_response_time_ms = None
    if clear_last_check:
        monitor.last_checked_at = None


def close_open_incident(db: Session, monitor: Monitor, why: str, at: datetime | None = None) -> Incident | None:
    """End an open incident that was NOT resolved by recovery (monitor paused, or retargeted).

    Deliberately sends no "recovered" notification: nothing recovered, monitoring just stopped
    being about this outage. The timeline records why.
    """
    incident = db.scalars(select(Incident).where(Incident.monitor_id == monitor.id, Incident.status == "open")).first()
    if incident is None:
        return None
    now = at or datetime.now(UTC)
    incident.status = "resolved"
    incident.resolved_at = now
    _add_event(db, incident.id, now, "incident_closed", f"Incident closed: {why}")
    log.info("incident_closed", extra={"monitor_id": monitor.id, "incident_id": incident.id, "why": why})
    return incident


def record_check(
    db: Session, monitor_id: int, outcome: CheckOutcome, target: tuple[str, str] | None = None
) -> list[int]:
    """Persist the result and advance health state. Returns pending notification ids.

    The caller commits, then enqueues deliveries. Nothing here talks to Redis, so a
    Redis outage cannot lose a check result or an incident.

    `target` is the (url, method) the check was actually run against. A check that was already in
    flight when the monitor was paused or pointed at a different API is stale: its result says
    nothing about the monitor's current configuration, so it is discarded.
    """
    monitor = db.scalars(select(Monitor).where(Monitor.id == monitor_id).with_for_update()).first()
    if monitor is None:
        return []  # deleted while the job was queued
    if not monitor.enabled or (target is not None and target != (monitor.url, monitor.method)):
        log.info("stale_check_discarded", extra={"monitor_id": monitor_id})
        return []

    db.add(
        CheckResult(
            monitor_id=monitor.id,
            checked_at=outcome.checked_at,
            success=outcome.success,
            status_code=outcome.status_code,
            response_time_ms=outcome.response_time_ms,
            check_duration_ms=outcome.check_duration_ms,
            error_type=outcome.error_type,
            error_message=outcome.error_message,
        )
    )
    db.flush()

    current = HealthState(Status(monitor.status), monitor.consecutive_failures, monitor.consecutive_successes)
    transition = next_state(current, outcome.success, monitor.failure_threshold, monitor.recovery_threshold)
    new = transition.state
    monitor.status = new.status.value
    monitor.consecutive_failures = new.consecutive_failures
    monitor.consecutive_successes = new.consecutive_successes
    monitor.last_checked_at = outcome.checked_at
    monitor.last_response_time_ms = outcome.response_time_ms

    notification_ids: list[int] = []
    if transition.action is Action.OPEN_INCIDENT:
        incident, notification_ids = _open_incident(db, monitor, outcome, new.consecutive_failures)
        if incident is None:  # lost a race to an existing open incident; keep it consistent
            monitor.status = Status.DOWN.value
    elif transition.action is Action.RESOLVE_INCIDENT:
        notification_ids = _resolve_incident(db, monitor, outcome, new.consecutive_successes)
    elif new.status is Status.DOWN:
        open_incident = db.scalars(
            select(Incident).where(Incident.monitor_id == monitor.id, Incident.status == "open")
        ).first()
        if open_incident:
            open_incident.failure_count = new.consecutive_failures
            open_incident.recovery_count = new.consecutive_successes
    return notification_ids
