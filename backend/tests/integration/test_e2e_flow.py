"""End-to-end: register -> login -> create monitor -> failure -> incident -> recovery -> resolved.

Drives the public REST API, runs the worker task body against a real local HTTP target, and
checks notifications, timeline and stats through the API.
"""

from sqlalchemy import select

from app.models import Notification
from worker.tasks import check as check_task


def test_full_incident_lifecycle(client, db, target):
    r = client.post("/api/auth/register", json={"email": "e2e@example.com", "password": "correct-horse-battery"})
    assert r.status_code == 201
    client.cookies.clear()
    assert (
        client.post(
            "/api/auth/login", json={"email": "e2e@example.com", "password": "correct-horse-battery"}
        ).status_code
        == 200
    )

    ch = client.post("/api/channels", json={"type": "webhook", "name": "hook", "url": f"{target.base}/hook"})
    assert ch.status_code == 201 and "hook" not in ch.json()["target"].split("/")[0]

    monitor = client.post(
        "/api/monitors",
        json={
            "name": "Demo",
            "url": f"{target.base}/health",
            "failure_threshold": 3,
            "recovery_threshold": 2,
            "assertions": [{"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"}],
        },
    ).json()
    mid = monitor["id"]

    def run_check():
        check_task._execute(mid)

    for _ in range(2):
        run_check()
    assert client.get(f"/api/monitors/{mid}").json()["display_status"] == "up"
    assert client.get("/api/dashboard/summary").json()["healthy_monitors"] == 1

    target.healthy = False
    run_check()
    run_check()  # noqa: E702
    assert client.get("/api/incidents").json() == []  # 2 failures: below threshold
    run_check()
    incidents = client.get("/api/incidents", params={"status": "open"}).json()
    assert len(incidents) == 1 and incidents[0]["monitor_name"] == "Demo"
    assert client.get(f"/api/monitors/{mid}").json()["display_status"] == "down"
    assert client.get("/api/dashboard/summary").json()["active_incidents"] == 1

    notes = db.scalars(select(Notification)).all()
    assert len(notes) == 1 and notes[0].event_type == "created"
    from app.core.database import session_scope
    from app.services import notification_service

    with session_scope() as s:
        notification_service.deliver(s, notes[0].id)
    assert any(b"incident.created" in body for _, p, body in target.requests if p == "/hook")

    target.healthy = True
    run_check()
    assert client.get("/api/incidents", params={"status": "open"}).json()[0]["status"] == "open"
    run_check()
    assert client.get("/api/incidents", params={"status": "open"}).json() == []
    resolved = client.get("/api/incidents", params={"status": "resolved"}).json()
    assert len(resolved) == 1 and resolved[0]["recovery_count"] == 2

    detail = client.get(f"/api/incidents/{resolved[0]['id']}").json()
    kinds = [e["event_type"] for e in detail["events"]]
    assert kinds[0] == "first_failure" and "incident_created" in kinds and kinds[-1] == "incident_resolved"
    assert "notification_sent" in kinds
    assert client.get(f"/api/monitors/{mid}").json()["display_status"] == "up"

    stats = client.get(f"/api/monitors/{mid}/stats", params={"range": "1h"}).json()
    assert stats["summary"]["total_checks"] == 7 and stats["summary"]["successful_checks"] == 4
    assert stats["summary"]["uptime_percentage"] == round(4 / 7 * 100, 3)
    assert stats["summary"]["p95_response_time_ms"] is not None and stats["uptime"]["24h"] is not None
    assert len(client.get(f"/api/monitors/{mid}/checks").json()) == 7
    assert len(client.get(f"/api/monitors/{mid}/checks", params={"failures_only": True}).json()) == 3
