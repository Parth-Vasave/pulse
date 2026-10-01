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
    assert db.get(Monitor, due.id).next_check_at == now + timedelta(seconds=30)
    assert db.get(Monitor, never.id).next_check_at == now + timedelta(seconds=300)
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
