"""Multi-tenancy: user B must be unable to see or touch anything user A owns."""

from datetime import UTC, datetime

from app.models import CheckResult, Incident
from tests.api.test_monitors import VALID


def _setup(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    db.add(CheckResult(monitor_id=m["id"], checked_at=datetime.now(UTC), success=True, response_time_ms=10))
    inc = Incident(monitor_id=m["id"], started_at=datetime.now(UTC), reason="x")
    db.add(inc)
    db.commit()
    ch = auth_client.post("/api/channels", json={"type": "email", "name": "me", "address": "a@example.com"}).json()
    key = auth_client.post("/api/api-keys", json={"name": "k"}).json()
    return m, inc.id, ch, key


def test_other_user_cannot_access_resources(auth_client, other_client, db):
    m, incident_id, ch, key = _setup(auth_client, db)
    mid = m["id"]
    for method, path, body in [
        ("get", f"/api/monitors/{mid}", None),
        ("patch", f"/api/monitors/{mid}", {"name": "pwned"}),
        ("delete", f"/api/monitors/{mid}", None),
        ("get", f"/api/monitors/{mid}/checks", None),
        ("get", f"/api/monitors/{mid}/stats", None),
        ("get", f"/api/incidents/{incident_id}", None),
        ("patch", f"/api/channels/{ch['id']}", {"enabled": False}),
        ("delete", f"/api/channels/{ch['id']}", None),
        ("post", f"/api/channels/{ch['id']}/test", None),
        ("delete", f"/api/api-keys/{key['id']}", None),
    ]:
        r = getattr(other_client, method)(path, **({"json": body} if body else {}))
        assert r.status_code == 404, f"{method} {path} -> {r.status_code}"
    assert other_client.get("/api/monitors").json() == []
    assert other_client.get("/api/incidents").json() == []
    assert other_client.get("/api/channels").json() == []
    assert other_client.get("/api/api-keys").json() == []
    assert other_client.get("/api/dashboard/summary").json()["total_monitors"] == 0
    # untouched
    assert auth_client.get(f"/api/monitors/{mid}").json()["name"] == "Production API"


def test_slug_collision_across_users(auth_client, other_client):
    assert auth_client.put("/api/status-page", json={"enabled": True, "slug": "acme"}).status_code == 200
    assert other_client.put("/api/status-page", json={"enabled": True, "slug": "acme"}).status_code == 409
