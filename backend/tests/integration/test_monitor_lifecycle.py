"""What happens to health state and incidents when a monitor is edited, paused or resumed."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import CheckResult, Incident, IncidentEvent, Monitor, Notification
from app.services.incident_service import record_check
from tests.api.test_monitors import VALID
from tests.integration.helpers import outcome
from tests.integration.test_incident_flow import feed
from worker.tasks import check as check_task


@pytest.fixture
def down(auth_client, db):
    """A monitor that is DOWN with one open incident and one queued 'created' notification."""
    auth_client.post("/api/channels", json={"type": "email", "name": "me", "address": "a@example.com"})
    m = auth_client.post("/api/monitors", json=VALID | {"failure_threshold": 2, "recovery_threshold": 2}).json()
    feed(db, m["id"], False, False)
    db.expire_all()
    assert db.get(Monitor, m["id"]).status == "down"
    assert db.scalars(select(Incident)).one().status == "open"
    return m


def state(db, monitor_id):
    db.expire_all()
    m = db.get(Monitor, monitor_id)
    return m.status, m.consecutive_failures, m.consecutive_successes


def only_incident(db):
    db.expire_all()
    return db.scalars(select(Incident)).one()


# ---- changing the target ---------------------------------------------------------------------
@pytest.mark.parametrize("patch", [{"url": "https://other.example.com/health"}, {"method": "POST"}])
def test_retargeting_resets_health_and_closes_the_incident_without_a_recovery_alert(auth_client, db, down, patch):
    notifications_before = db.scalar(select(func.count()).select_from(Notification))
    r = auth_client.patch(f"/api/monitors/{down['id']}", json=patch)
    assert r.status_code == 200
    assert state(db, down["id"]) == ("unknown", 0, 0)
    assert db.get(Monitor, down["id"]).last_checked_at is None
    inc = only_incident(db)
    assert inc.status == "resolved" and inc.resolved_at is not None
    events = [e.event_type for e in db.scalars(select(IncidentEvent).order_by(IncidentEvent.id))]
    assert events[-1] == "incident_closed"
    assert db.scalar(select(func.count()).select_from(Notification)) == notifications_before  # nothing "recovered"
    detail = auth_client.get(f"/api/incidents/{inc.id}").json()
    assert "URL or method was changed" in detail["events"][-1]["message"]
    assert auth_client.get(f"/api/monitors/{down['id']}").json()["display_status"] == "unknown"


def test_new_target_starts_from_scratch_and_can_open_a_fresh_incident(auth_client, db, down):
    auth_client.patch(f"/api/monitors/{down['id']}", json={"url": "https://other.example.com/health"})
    feed(db, down["id"], False)
    assert state(db, down["id"]) == ("unknown", 1, 0)  # one failure is not enough: streak restarted
    feed(db, down["id"], False)
    assert db.scalar(select(func.count()).select_from(Incident)) == 2


@pytest.mark.parametrize(
    "patch", [{"name": "Renamed"}, {"timeout_seconds": 3}, {"expected_status_code": 204}, {"headers": {"X-A": "b"}}]
)
def test_other_edits_keep_state_and_incident(auth_client, db, down, patch):
    assert auth_client.patch(f"/api/monitors/{down['id']}", json=patch).status_code == 200
    assert state(db, down["id"]) == ("down", 2, 0)
    assert only_incident(db).status == "open"


def test_editing_a_healthy_monitor_without_an_incident_is_harmless(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    feed(db, m["id"], True)
    assert auth_client.patch(f"/api/monitors/{m['id']}", json={"url": "https://other.example.com/"}).status_code == 200
    assert state(db, m["id"]) == ("unknown", 0, 0)
    assert db.scalar(select(func.count()).select_from(Incident)) == 0


# ---- pausing and resuming ------------------------------------------------------------------------
def test_pausing_closes_the_open_incident_and_resets_streaks(auth_client, db, down):
    r = auth_client.patch(f"/api/monitors/{down['id']}", json={"enabled": False})
    assert r.json()["display_status"] == "paused"
    assert state(db, down["id"]) == ("unknown", 0, 0)
    assert db.get(Monitor, down["id"]).last_checked_at is not None  # history of the last check is kept
    inc = only_incident(db)
    assert inc.status == "resolved"
    last = db.scalars(select(IncidentEvent).order_by(IncidentEvent.id.desc())).first()
    assert last.event_type == "incident_closed" and "paused" in last.message
    assert auth_client.get("/api/incidents", params={"status": "open"}).json() == []
    assert auth_client.get("/api/dashboard/summary").json()["active_incidents"] == 0


def test_resuming_starts_fresh_and_a_continuing_outage_opens_a_new_incident(auth_client, db, down):
    auth_client.patch(f"/api/monitors/{down['id']}", json={"enabled": False})
    auth_client.patch(f"/api/monitors/{down['id']}", json={"enabled": True})
    assert state(db, down["id"]) == ("unknown", 0, 0)
    assert db.get(Monitor, down["id"]).next_check_at is not None
    feed(db, down["id"], False, False)
    incidents = db.scalars(select(Incident).order_by(Incident.id)).all()
    assert [i.status for i in incidents] == ["resolved", "open"]  # honest: the outage is a new incident


def test_pausing_a_healthy_monitor_changes_nothing_else(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    auth_client.patch(f"/api/monitors/{m['id']}", json={"enabled": False})
    assert db.scalar(select(func.count()).select_from(Incident)) == 0


# ---- when the next check runs after an edit ----------------------------------------------------
def scheduled(db, monitor_id, next_check_at, last_checked_at=None):
    m = db.get(Monitor, monitor_id)
    m.next_check_at, m.last_checked_at = next_check_at, last_checked_at
    db.commit()


def next_check(db, monitor_id):
    db.expire_all()
    return db.get(Monitor, monitor_id).next_check_at


def test_shortening_the_interval_takes_effect_from_the_last_check(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID | {"interval_seconds": 86400}).json()
    now = datetime.now(UTC)
    scheduled(db, m["id"], now + timedelta(hours=23), last_checked_at=now - timedelta(seconds=10))
    auth_client.patch(f"/api/monitors/{m['id']}", json={"interval_seconds": 60})
    assert next_check(db, m["id"]) == now + timedelta(seconds=50)  # not 23 hours away


def test_lengthening_the_interval_keeps_the_next_check(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    at = datetime.now(UTC) + timedelta(seconds=40)
    scheduled(db, m["id"], at, last_checked_at=at - timedelta(seconds=60))
    auth_client.patch(f"/api/monitors/{m['id']}", json={"interval_seconds": 3600})
    assert next_check(db, m["id"]) == at


def test_retargeting_checks_the_new_target_right_away(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID | {"interval_seconds": 86400}).json()
    scheduled(db, m["id"], datetime.now(UTC) + timedelta(hours=23))
    auth_client.patch(f"/api/monitors/{m['id']}", json={"url": "https://other.example.com/health"})
    assert next_check(db, m["id"]) <= datetime.now(UTC)


# ---- results from checks that were already running ---------------------------------------------------
def test_result_arriving_after_pause_is_discarded(auth_client, db, down):
    auth_client.patch(f"/api/monitors/{down['id']}", json={"enabled": False})
    results_before = db.scalar(select(func.count()).select_from(CheckResult))
    assert record_check(db, down["id"], outcome(False)) == []
    db.commit()
    assert db.scalar(select(func.count()).select_from(CheckResult)) == results_before
    assert state(db, down["id"]) == ("unknown", 0, 0)  # a paused monitor can't flip to DOWN
    assert db.scalars(select(Incident)).one().status == "resolved"


def test_result_for_the_old_target_is_discarded_but_the_current_one_is_kept(auth_client, db, down):
    old = (down["url"], down["method"])
    auth_client.patch(f"/api/monitors/{down['id']}", json={"url": "https://other.example.com/health"})
    assert record_check(db, down["id"], outcome(False), target=old) == []
    db.commit()
    assert state(db, down["id"]) == ("unknown", 0, 0)
    record_check(db, down["id"], outcome(True), target=("https://other.example.com/health", "GET"))
    db.commit()
    assert state(db, down["id"]) == ("up", 0, 1)


def test_worker_discards_result_when_monitor_is_edited_mid_check(auth_client, db, monkeypatch):
    m = auth_client.post("/api/monitors", json=VALID).json()

    def edit_during_check(spec):
        with SessionLocal() as s:
            s.get(Monitor, m["id"]).url = "https://moved.example.com/"
            s.commit()
        return outcome(False)

    monkeypatch.setattr(check_task, "run_check", edit_during_check)
    check_task._execute(m["id"])  # must not raise
    assert db.scalar(select(func.count()).select_from(CheckResult)) == 0
    assert state(db, m["id"]) == ("unknown", 0, 0)
