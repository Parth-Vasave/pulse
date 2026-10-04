from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import CheckResult, Monitor
from tests.integration.helpers import make_monitor, make_user
from worker.scheduler import tasks as sched


@pytest.fixture
def enqueued(monkeypatch):
    calls = []
    monkeypatch.setattr(sched.run_monitor_check, "apply_async", lambda **kw: calls.append(kw))
    return calls


def test_due_monitors_are_enqueued_and_rescheduled(db, enqueued):
    u = make_user(db)
    now = datetime.now(UTC)
    due = make_monitor(db, u, name="due", interval_seconds=30, next_check_at=now - timedelta(seconds=1))
    fresh = make_monitor(db, u, name="fresh", interval_seconds=60, next_check_at=now + timedelta(minutes=5))
    never = make_monitor(db, u, name="never", interval_seconds=300, next_check_at=None)
    paused = make_monitor(db, u, name="paused", enabled=False, next_check_at=now - timedelta(hours=1))
    assert sched.schedule_due(now) == 2
    assert sorted(c["args"][0] for c in enqueued) == sorted([due.id, never.id])
    db.expire_all()
    assert db.get(Monitor, due.id).next_check_at == now + timedelta(seconds=29)  # anchored to its slot, no drift
    never_at = db.get(Monitor, never.id).next_check_at
    assert now + timedelta(seconds=300) <= never_at <= now + timedelta(seconds=310)  # re-anchored with jitter
    assert db.get(Monitor, fresh.id).next_check_at == now + timedelta(minutes=5)
    assert db.get(Monitor, paused.id).next_check_at < now
    assert all(c["expires"] >= 30 for c in enqueued)


def test_different_intervals_are_respected(db, enqueued):
    u = make_user(db)
    t0 = datetime.now(UTC)
    a = make_monitor(db, u, name="a", interval_seconds=30, next_check_at=t0)
    b = make_monitor(db, u, name="b", interval_seconds=300, next_check_at=t0)
    sched.schedule_due(t0)
    enqueued.clear()
    assert sched.schedule_due(t0 + timedelta(seconds=31)) == 1
    assert enqueued[0]["args"] == [a.id]
    _ = b


def test_late_tick_does_not_drift_and_long_outage_does_not_burst(db, enqueued):
    u = make_user(db)
    now = datetime.now(UTC)
    late = make_monitor(db, u, name="late", interval_seconds=60, next_check_at=now - timedelta(seconds=20))
    lost = make_monitor(db, u, name="lost", interval_seconds=60, next_check_at=now - timedelta(hours=3))
    sched.schedule_due(now)
    db.expire_all()
    assert db.get(Monitor, late.id).next_check_at == now + timedelta(seconds=40)  # still on the original grid
    lost_at = db.get(Monitor, lost.id).next_check_at
    assert now + timedelta(seconds=60) <= lost_at <= now + timedelta(seconds=66)  # one check, not 180 catch-ups
    assert len(enqueued) == 2


def test_backlog_larger_than_one_batch_is_drained_in_one_tick(db, enqueued, monkeypatch):
    monkeypatch.setattr(sched, "BATCH", 2)
    u = make_user(db)
    now = datetime.now(UTC)
    for i in range(5):
        make_monitor(db, u, name=f"m{i}", interval_seconds=60, next_check_at=now - timedelta(seconds=1))
    assert sched.schedule_due(now) == 5
    assert len({c["args"][0] for c in enqueued}) == 5


def test_broker_outage_does_not_lose_the_schedule(db, monkeypatch):
    u = make_user(db)
    now = datetime.now(UTC)
    m = make_monitor(db, u, next_check_at=now - timedelta(seconds=1))
    original = m.next_check_at

    def broker_down(**kw):
        raise ConnectionError("redis down")

    monkeypatch.setattr(sched.run_monitor_check, "apply_async", broker_down)
    with pytest.raises(ConnectionError):
        sched.schedule_due(now)
    db.expire_all()
    assert db.get(Monitor, m.id).next_check_at == original  # rolled back: retried on the next tick


def test_purge_old_results(db):
    u = make_user(db)
    m = make_monitor(db, u)
    old = datetime.now(UTC) - timedelta(days=90)
    db.add_all(
        [
            CheckResult(monitor_id=m.id, checked_at=old, success=True),
            CheckResult(monitor_id=m.id, checked_at=datetime.now(UTC), success=True),
        ]
    )
    db.commit()
    assert sched.purge_old_results() == 1
    assert len(db.scalars(select(CheckResult)).all()) == 1


# --- Pulse watching itself: tick timestamp, queue depth, dead-man's-switch ---------------------------------------


@pytest.fixture
def watch(monkeypatch):
    """Clean Redis keys and metrics, and stub out enqueueing so a tick needs only the DB and Redis."""
    import redis

    from app.core.config import get_settings

    r = redis.Redis.from_url(get_settings().redis_url)
    cleanup = lambda: r.delete(sched.HEARTBEAT_LOCK_KEY, *sched.QUEUES)  # noqa: E731
    cleanup()
    monkeypatch.setattr(sched.run_monitor_check, "apply_async", lambda **kw: None)
    sched.scheduler_last_tick_timestamp_seconds.set(0)
    yield r
    cleanup()


def sample(name, **labels):
    from prometheus_client import REGISTRY

    return REGISTRY.get_sample_value(name, labels)


def test_a_completed_tick_advances_the_heartbeat_timestamp(db, watch):
    before = datetime.now(UTC).timestamp()
    sched.enqueue_due_checks()
    assert sample("scheduler_last_tick_timestamp_seconds") >= before


def test_a_failed_tick_does_not_advance_the_timestamp(db, watch, monkeypatch):
    def broken(*a, **kw):
        raise ConnectionError("db down")

    monkeypatch.setattr(sched, "schedule_due", broken)
    with pytest.raises(ConnectionError):
        sched.enqueue_due_checks()
    assert sample("scheduler_last_tick_timestamp_seconds") == 0  # a stalled scheduler must look stalled


def test_queue_depth_is_exported_per_queue(db, watch):
    watch.rpush("checks", "a", "b", "c")
    watch.rpush("notifications", "x")
    sched.enqueue_due_checks()
    assert sample("queue_depth", queue="checks") == 3
    assert sample("queue_depth", queue="notifications") == 1


def test_heartbeat_is_not_sent_unless_configured(db, watch, target, monkeypatch):
    monkeypatch.setattr(sched.get_settings(), "heartbeat_url", "")
    sched.enqueue_due_checks()
    assert target.requests == []


def test_heartbeat_pings_once_per_interval_across_ticks(db, watch, target, monkeypatch):
    s = sched.get_settings()
    monkeypatch.setattr(s, "heartbeat_url", f"http://127.0.0.1:{target.port}/hook")
    monkeypatch.setattr(s, "heartbeat_interval_seconds", 60)
    ok = sample("heartbeat_pings_total", outcome="success") or 0
    for _ in range(5):  # beat ticks every 5 s: five ticks must produce a single ping
        sched.enqueue_due_checks()
    assert [r[:2] for r in target.requests] == [("GET", "/hook")]
    assert sample("heartbeat_pings_total", outcome="success") == ok + 1
    watch.delete(sched.HEARTBEAT_LOCK_KEY)  # the interval elapsing
    sched.enqueue_due_checks()
    assert len(target.requests) == 2


def test_a_failing_heartbeat_endpoint_never_breaks_scheduling(db, watch, target, monkeypatch, caplog):
    s = sched.get_settings()
    monkeypatch.setattr(s, "heartbeat_url", f"http://127.0.0.1:{target.port}/hook?token=very-secret")
    target.webhook_status = 500
    failed = sample("heartbeat_pings_total", outcome="failure") or 0
    u = make_user(db)
    m = make_monitor(db, u, interval_seconds=30, next_check_at=datetime.now(UTC) - timedelta(seconds=1))
    assert sched.enqueue_due_checks() == 1  # still scheduled the due monitor
    assert sample("heartbeat_pings_total", outcome="failure") == failed + 1
    assert sample("scheduler_last_tick_timestamp_seconds") > 0
    assert "very-secret" not in caplog.text  # the URL's token is a credential; never logged
    _ = m


def test_unreachable_heartbeat_endpoint_is_survived(db, watch, monkeypatch):
    monkeypatch.setattr(sched.get_settings(), "heartbeat_url", "http://127.0.0.1:9/never")
    failed = sample("heartbeat_pings_total", outcome="failure") or 0
    sched.enqueue_due_checks()
    assert sample("heartbeat_pings_total", outcome="failure") == failed + 1


def test_no_heartbeat_when_the_tick_itself_fails(db, watch, target, monkeypatch):
    """The point of a dead-man's switch: a broken scheduler must go quiet, not keep reporting 'alive'."""
    monkeypatch.setattr(sched.get_settings(), "heartbeat_url", f"http://127.0.0.1:{target.port}/hook")

    def broken(*a, **kw):
        raise ConnectionError("redis down")

    monkeypatch.setattr(sched.run_monitor_check, "apply_async", broken)
    make_monitor(db, make_user(db), next_check_at=datetime.now(UTC) - timedelta(seconds=1))
    with pytest.raises(ConnectionError):
        sched.enqueue_due_checks()
    assert target.requests == []
