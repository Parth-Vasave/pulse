from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, or_, select

from app.core.config import get_settings
from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.metrics import worker_jobs_total
from app.models import CheckResult, Monitor
from worker.celery_app import celery_app
from worker.tasks.check import run_monitor_check

log = get_logger("worker.scheduler")
BATCH = 500


def schedule_due(now: datetime | None = None) -> int:
    """Enqueue a check for every enabled monitor whose next_check_at has passed.

    The DB is the schedule: `FOR UPDATE SKIP LOCKED` makes overlapping ticks safe, and we enqueue
    BEFORE committing the new next_check_at. If Redis is down the transaction rolls back and the
    monitor is simply picked up again on the next tick (at-least-once, never silently skipped).
    """
    now = now or datetime.now(UTC)
    with session_scope() as db:
        due = db.scalars(
            select(Monitor)
            .where(Monitor.enabled.is_(True), or_(Monitor.next_check_at.is_(None), Monitor.next_check_at <= now))
            .order_by(Monitor.next_check_at.asc().nulls_first())
            .limit(BATCH)
            .with_for_update(skip_locked=True)
        ).all()
        for monitor in due:
            # `expires`: a check that sat in the queue longer than one interval is stale; drop it
            # rather than let a backlog turn into a burst of requests against the target.
            run_monitor_check.apply_async(args=[monitor.id], expires=max(monitor.interval_seconds, 30))
            monitor.next_check_at = now + timedelta(seconds=monitor.interval_seconds)
    return len(due)


@celery_app.task(name="worker.scheduler.tasks.enqueue_due_checks")
def enqueue_due_checks() -> int:
    worker_jobs_total.labels("enqueue_due_checks").inc()
    count = schedule_due()
    if count:
        log.info("checks_enqueued", extra={"count": count})
    return count


@celery_app.task(name="worker.scheduler.tasks.purge_old_results")
def purge_old_results() -> int:
    cutoff = datetime.now(UTC) - timedelta(days=get_settings().check_retention_days)
    total = 0
    while True:  # batched so a large backlog never holds one giant lock
        with session_scope() as db:
            ids = list(db.scalars(select(CheckResult.id).where(CheckResult.checked_at < cutoff).limit(5000)))
            if not ids:
                break
            db.execute(delete(CheckResult).where(CheckResult.id.in_(ids)))
            total += len(ids)
    if total:
        log.info("check_results_purged", extra={"count": total})
    return total
