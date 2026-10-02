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
