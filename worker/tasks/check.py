from sqlalchemy.exc import OperationalError

from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.metrics import (
    monitor_check_duration_seconds,
    monitor_check_failures_total,
    monitor_checks_total,
    worker_job_failures_total,
    worker_jobs_total,
)
from app.models import Monitor
from app.services.incident_service import record_check
from worker.celery_app import celery_app
from worker.services.http_checker import CheckSpec, run_check
from worker.tasks.notify import enqueue_notifications

log = get_logger("worker.check")


@celery_app.task(
    name="worker.tasks.check.run_monitor_check",
    # Only infrastructure errors are retried (exponential backoff + jitter, bounded). A failing
    # *target* is a normal outcome and is recorded, never retried at this level.
    autoretry_for=(OperationalError,),
    retry_backoff=2,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=5,
    soft_time_limit=100,
    time_limit=120,
)
def run_monitor_check(monitor_id: int) -> None:
    worker_jobs_total.labels("run_monitor_check").inc()
    try:
        _execute(monitor_id)
    except Exception:
        worker_job_failures_total.labels("run_monitor_check").inc()
        raise


def _execute(monitor_id: int) -> None:
    # Load config and release the DB connection BEFORE the (slow) outbound request.
    with session_scope() as db:
        monitor = db.get(Monitor, monitor_id)
        if monitor is None or not monitor.enabled:
            return
        spec = CheckSpec(
            url=monitor.url,
            method=monitor.method,
            headers=dict(monitor.headers or {}),
            body=monitor.body,
            expected_status_code=monitor.expected_status_code,
            timeout_seconds=monitor.timeout_seconds,
            response_time_threshold_ms=monitor.response_time_threshold_ms,
            assertions=list(monitor.assertions or []),
            retries=monitor.check_retries,
        )
        target = (monitor.url, monitor.method)
    log.info("check_started", extra={"monitor_id": monitor_id})

    outcome = run_check(spec)

    monitor_checks_total.inc()
    monitor_check_duration_seconds.observe((outcome.check_duration_ms or 0) / 1000)
    if not outcome.success:
        monitor_check_failures_total.labels(outcome.error_type or "unknown").inc()

    with session_scope() as db:
        notification_ids = record_check(db, monitor_id, outcome, target)

    log.info(
        "check_completed",
        extra={
            "monitor_id": monitor_id,
            "success": outcome.success,
            "status_code": outcome.status_code,
            "response_time_ms": outcome.response_time_ms,
            "error_type": outcome.error_type,
        },
    )
    # After commit: if Redis is down this is logged and the sweeper re-enqueues from the DB.
    enqueue_notifications(notification_ids)
