"""Runs the real task body (DB + HTTP checker + incident engine) against a live local target."""

from sqlalchemy import select

from app.models import CheckResult, Incident, Monitor, Notification
from tests.integration.helpers import make_channel, make_monitor, make_user
from worker.tasks import check as check_task
from worker.tasks import notify as notify_task


def test_task_records_result_and_updates_monitor(db, target):
    u = make_user(db)
    m = make_monitor(db, u)
    m.url = f"{target.base}/"
    db.commit()
    check_task._execute(m.id)
    db.expire_all()
    r = db.scalars(select(CheckResult)).one()
    assert r.success and r.status_code == 200 and r.response_time_ms is not None
    assert db.get(Monitor, m.id).status == "up"


def test_bad_target_never_crashes_the_task(db):
    u = make_user(db)
    m = make_monitor(db, u)  # api.example.com resolves (fake DNS) to a public IP nobody listens on
    m.url = "http://127.0.0.1:9/"
    db.commit()
    check_task._execute(m.id)  # must not raise
    db.expire_all()
    assert db.scalars(select(CheckResult)).one().error_type == "blocked_target"


def test_disabled_or_deleted_monitor_is_skipped(db):
    u = make_user(db)
    m = make_monitor(db, u, enabled=False)
    check_task._execute(m.id)
    check_task._execute(424242)
    assert db.scalars(select(CheckResult)).all() == []


def test_redis_outage_leaves_notification_pending_for_sweeper(db, target, monkeypatch):
    u = make_user(db)
    make_channel(db, u, url=f"{target.base}/hook")
    m = make_monitor(db, u, failure_threshold=1)
    m.url = f"{target.base}/"
    db.commit()
    target.healthy = False

    def broker_down(*a, **k):
        raise ConnectionError("redis down")

    monkeypatch.setattr(notify_task.send_notification, "delay", broker_down)
    check_task._execute(m.id)  # incident + notification persisted even though enqueue failed
    db.expire_all()
    assert db.scalars(select(Incident)).one().status == "open"
    assert db.scalars(select(Notification)).one().status == "pending"

    enqueued = []
    monkeypatch.setattr(notify_task.send_notification, "delay", enqueued.append)
    from datetime import UTC, datetime, timedelta

    n = db.scalars(select(Notification)).one()
    n.created_at = datetime.now(UTC) - timedelta(minutes=10)
    db.commit()
    assert notify_task.sweep_pending_notifications() == 1 and enqueued == [n.id]
