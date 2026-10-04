import random
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import cast
from urllib.parse import urlsplit

import httpx
import redis
from sqlalchemy import delete, or_, select

from app.core.config import get_settings
from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.metrics import (
    heartbeat_pings_total,
    queue_depth,
    scheduler_last_tick_timestamp_seconds,
    worker_jobs_total,
)
from app.models import CheckResult, Monitor
from worker.celery_app import celery_app
from worker.tasks.check import run_monitor_check

log = get_logger("worker.scheduler")
BATCH = 500
MAX_BATCHES_PER_TICK = 20  # bounds one tick at 10k monitors; the rest is picked up by the next tick
QUEUES = ("checks", "notifications")  # Celery's Redis transport keeps each queue as a list named after the queue
HEARTBEAT_LOCK_KEY = "pulse:heartbeat:lock"


def _jitter(interval_seconds: int) -> timedelta:
    """Up to 10% of the interval (max 10 s) so monitors that start together don't stay in lockstep."""
    return timedelta(seconds=random.uniform(0, min(interval_seconds * 0.1, 10)))  # noqa: S311 - not security-sensitive


def _next_slot(previous: datetime | None, interval_seconds: int, now: datetime) -> datetime:
    """Anchor to the previous slot so a late tick doesn't push the cadence back (no drift).

    If we fell a whole interval or more behind (outage, backlog) or the monitor has no schedule yet,
    re-anchor on `now` with jitter instead of firing the missed checks in a burst.
    """
    interval = timedelta(seconds=interval_seconds)
    if previous is not None and previous + interval > now:
        return previous + interval
    return now + interval + _jitter(interval_seconds)


def _schedule_batch(now: datetime) -> int:
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
            monitor.next_check_at = _next_slot(monitor.next_check_at, monitor.interval_seconds, now)
    return len(due)


def schedule_due(now: datetime | None = None) -> int:
    """Enqueue a check for every enabled monitor whose next_check_at has passed.

    The DB is the schedule: `FOR UPDATE SKIP LOCKED` makes overlapping ticks safe, and we enqueue
    BEFORE committing the new next_check_at. If Redis is down the transaction rolls back and the
    monitor is simply picked up again on the next tick (at-least-once, never silently skipped).
    Due monitors are drained in batches (one transaction each) so more than BATCH monitors don't lag.
    """
    now = now or datetime.now(UTC)
    total = 0
    for _ in range(MAX_BATCHES_PER_TICK):
        n = _schedule_batch(now)
        total += n
        if n < BATCH:
            break
    return total


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, socket_timeout=2, socket_connect_timeout=2)


def _observe_queues() -> None:
    for name in QUEUES:
        queue_depth.labels(name).set(cast(int, _redis().llen(name)))  # sync client: never awaitable


def _ping_heartbeat() -> None:
    """Tell the external dead-man's switch we are alive, at most once per interval across all workers.

    Called only after a tick succeeded, so the pings stopping means the scheduler (Beat, Redis, a worker or the
    database) is broken, which is exactly what this exists to report from outside. Failures never affect scheduling.
    """
    settings = get_settings()
    if not settings.heartbeat_url:
        return
    if not _redis().set(HEARTBEAT_LOCK_KEY, "1", nx=True, ex=settings.heartbeat_interval_seconds):
        return  # another tick already pinged within this interval
    host = urlsplit(settings.heartbeat_url).netloc  # the path usually carries a secret token; never log it
    try:
        httpx.get(settings.heartbeat_url, timeout=5, follow_redirects=True).raise_for_status()
    except httpx.HTTPError as exc:
        heartbeat_pings_total.labels("failure").inc()
        log.warning("heartbeat_ping_failed", extra={"host": host, "error": type(exc).__name__})
    else:
        heartbeat_pings_total.labels("success").inc()


@celery_app.task(name="worker.scheduler.tasks.enqueue_due_checks")
def enqueue_due_checks() -> int:
    worker_jobs_total.labels("enqueue_due_checks").inc()
    count = schedule_due()
    scheduler_last_tick_timestamp_seconds.set_to_current_time()
    try:
        _observe_queues()
        _ping_heartbeat()
    except redis.RedisError as exc:  # observability must never break scheduling
        log.warning("scheduler_observability_failed", extra={"error": type(exc).__name__})
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
