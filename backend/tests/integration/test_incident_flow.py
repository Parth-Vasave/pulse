import threading

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import CheckResult, Incident, IncidentEvent, Monitor, Notification
from app.services.incident_service import record_check
from tests.integration.helpers import make_channel, make_monitor, make_user, outcome


def feed(db, monitor_id, *results):
    ids = []
    for ok in results:
        ids += record_check(db, monitor_id, outcome(ok))
        db.commit()
    return ids


def test_incident_created_only_at_threshold(db):
    u = make_user(db)
    m = make_monitor(db, u)
    feed(db, m.id, False, False)
    assert db.scalar(select(func.count()).select_from(Incident)) == 0
    assert db.get(Monitor, m.id).consecutive_failures == 2
    feed(db, m.id, False)
    inc = db.scalars(select(Incident)).one()
    assert inc.status == "open" and inc.failure_count == 3 and "3 consecutive failures" in inc.reason
    assert db.get(Monitor, m.id).status == "down"


def test_no_duplicate_incident_during_long_outage(db):
    u = make_user(db)
    m = make_monitor(db, u)
    feed(db, m.id, *[False] * 10)
    inc = db.scalars(select(Incident)).one()
    db.refresh(inc)
    assert inc.failure_count == 10


def test_resolution_after_recovery_threshold(db):
    u = make_user(db)
    m = make_monitor(db, u)
    feed(db, m.id, False, False, False, True)
    assert db.scalars(select(Incident)).one().status == "open"  # 1 success is not enough
    feed(db, m.id, True)
    inc = db.scalars(select(Incident)).one()
    assert inc.status == "resolved" and inc.resolved_at is not None and inc.recovery_count == 2
    assert db.get(Monitor, m.id).status == "up"


def test_timeline_events_are_complete_and_ordered(db):
    u = make_user(db)
    m = make_monitor(db, u)
    feed(db, m.id, False, False, False, True, True)
    events = db.scalars(select(IncidentEvent).order_by(IncidentEvent.occurred_at, IncidentEvent.id)).all()
    kinds = [e.event_type for e in events]
    assert kinds == [
        "first_failure",
        "failure",
        "failure",
        "incident_created",
        "recovery_check",
        "recovered",
        "incident_resolved",
    ]
    assert [e.occurred_at for e in events] == sorted(e.occurred_at for e in events)


def test_second_outage_creates_second_incident(db):
    u = make_user(db)
    m = make_monitor(db, u)
    feed(db, m.id, False, False, False, True, True, False, False, False)
    incidents = db.scalars(select(Incident).order_by(Incident.id)).all()
    assert [i.status for i in incidents] == ["resolved", "open"]


def test_results_are_persisted_with_every_check(db):
    u = make_user(db)
    m = make_monitor(db, u)
    feed(db, m.id, True, False, True)
    rows = db.scalars(select(CheckResult).order_by(CheckResult.id)).all()
    assert [r.success for r in rows] == [True, False, True] and rows[1].error_type == "timeout"
    assert db.get(Monitor, m.id).last_checked_at is not None


def test_notifications_queued_only_for_enabled_channels_of_owner(db):
    u, other = make_user(db), make_user(db, "o@example.com")
    m = make_monitor(db, u)
    on = make_channel(db, u)
    make_channel(db, u, enabled=False)
    make_channel(db, other)
    ids = feed(db, m.id, False, False, False)
    notes = db.scalars(select(Notification)).all()
    assert [n.id for n in notes] == ids and len(notes) == 1
    assert notes[0].channel_id == on.id and notes[0].event_type == "created" and notes[0].status == "pending"
    ids2 = feed(db, m.id, True, True)
    assert db.get(Notification, ids2[0]).event_type == "resolved"


def test_deleted_monitor_is_ignored(db):
    assert record_check(db, 9999, outcome(False)) == []


def test_concurrent_checks_for_one_monitor_make_one_incident(db):
    """Two workers racing on the same monitor must serialise (row lock) - exactly one incident."""
    u = make_user(db)
    m = make_monitor(db, u, failure_threshold=2)
    mid = m.id
    barrier = threading.Barrier(4)
    errors = []

    def worker():
        s = SessionLocal()
        try:
            barrier.wait()
            record_check(s, mid, outcome(False))
            s.commit()
        except Exception as e:  # noqa: BLE001
            errors.append(e)
            s.rollback()
        finally:
            s.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert db.scalar(select(func.count()).select_from(Incident)) == 1
    assert db.scalar(select(func.count()).select_from(CheckResult)) == 4
