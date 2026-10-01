from datetime import UTC, datetime, timedelta

from celery import Task
from sqlalchemy import select

from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.metrics import worker_job_failures_total, worker_jobs_total
from app.models import Notification
from app.services import notification_service
from app.services.retry import backoff_delay
from worker.celery_app import celery_app

log = get_logger("worker.notify")
SWEEP_AFTER = timedelta(minutes=2)


def enqueue_notifications(ids: list[int]) -> None:
    for notification_id in ids:
        try:
            send_notification.delay(notification_id)
        except Exception as exc:  # noqa: BLE001 - broker down; sweeper will pick the row up
            log.error(
                "notification_enqueue_failed", extra={"notification_id": notification_id, "error": type(exc).__name__}
            )


@celery_app.task(
    name="worker.tasks.notify.send_notification",
    bind=True,
    max_retries=notification_service.MAX_ATTEMPTS,
    soft_time_limit=60,
    time_limit=90,
)
def send_notification(self: Task, notification_id: int) -> None:
    worker_jobs_total.labels("send_notification").inc()
    try:
        with session_scope() as db:
            retry_error = notification_service.deliver(db, notification_id)
    except Exception:
        worker_job_failures_total.labels("send_notification").inc()
        raise
    if retry_error is not None:
        # Delivery state was committed above; retry with exponential backoff (2s, 4s, 8s, ...).
        raise self.retry(countdown=backoff_delay(self.request.retries, base=2, cap=300), exc=retry_error)


@celery_app.task(name="worker.tasks.notify.sweep_pending_notifications")
def sweep_pending_notifications() -> int:
    """Re-enqueue notifications stuck in 'pending' (e.g. Redis was down when they were created)."""
    cutoff = datetime.now(UTC) - SWEEP_AFTER
    with session_scope() as db:
        ids = list(
            db.scalars(
                select(Notification.id)
                .where(Notification.status == "pending", Notification.created_at < cutoff)
                .limit(200)
            )
        )
    if ids:
        log.warning("notification_sweep_requeued", extra={"count": len(ids)})
        enqueue_notifications(ids)
    return len(ids)
