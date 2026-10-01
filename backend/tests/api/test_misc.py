import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.core import ratelimit
from app.models import CheckResult, Incident, Monitor
from tests.api.test_monitors import VALID


def add_checks(db, monitor_id, rts, success=True, age=timedelta(minutes=5)):
    now = datetime.now(UTC)
    db.add_all(
        CheckResult(
            monitor_id=monitor_id, checked_at=now - age + timedelta(seconds=i), success=success, response_time_ms=rt
        )
        for i, rt in enumerate(rts)
    )
    db.commit()


def test_latency_percentiles_and_uptime(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    add_checks(db, m["id"], list(range(1, 101)))
    add_checks(db, m["id"], [None] * 25, success=False)  # timeouts: no latency, but count against uptime
    s = auth_client.get(f"/api/monitors/{m['id']}/stats", params={"range": "1h"}).json()["summary"]
    assert s["total_checks"] == 125 and s["successful_checks"] == 100 and s["uptime_percentage"] == 80.0
    assert s["avg_response_time_ms"] == 50.5 and s["p50_response_time_ms"] == 50.5
    assert s["p95_response_time_ms"] == pytest.approx(95.05, abs=0.06)
    assert s["p99_response_time_ms"] == pytest.approx(99.01, abs=0.06)


def test_stats_with_no_data_are_null_not_zero(auth_client):
    m = auth_client.post("/api/monitors", json=VALID).json()
    body = auth_client.get(f"/api/monitors/{m['id']}/stats").json()
    assert body["summary"]["uptime_percentage"] is None and body["summary"]["p95_response_time_ms"] is None
    assert body["series"] == [] and body["uptime"] == {"24h": None, "7d": None, "30d": None}


def test_uptime_windows_exclude_older_data(auth_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    add_checks(db, m["id"], [10] * 10, age=timedelta(hours=1))
    add_checks(db, m["id"], [None] * 10, success=False, age=timedelta(days=3))
    add_checks(db, m["id"], [None] * 20, success=False, age=timedelta(days=20))
    u = auth_client.get(f"/api/monitors/{m['id']}/stats").json()["uptime"]
    assert u == {"24h": 100.0, "7d": 50.0, "30d": 25.0}


@pytest.mark.parametrize("rng", ["1h", "24h", "7d", "30d"])
def test_series_ranges(auth_client, db, rng):
    m = auth_client.post("/api/monitors", json=VALID).json()
    add_checks(db, m["id"], [100, 200])
    add_checks(db, m["id"], [None], success=False)
    series = auth_client.get(f"/api/monitors/{m['id']}/stats", params={"range": rng}).json()["series"]
    assert sum(p["checks"] for p in series) == 3
    assert all(p["availability"] + p["error_rate"] == 100 for p in series)


def test_invalid_range_rejected(auth_client):
    m = auth_client.post("/api/monitors", json=VALID).json()
    assert auth_client.get(f"/api/monitors/{m['id']}/stats", params={"range": "5y"}).status_code == 422


def test_dashboard_summary(auth_client, db):
    for i, status in enumerate(["up", "up", "down"]):
        m = auth_client.post("/api/monitors", json=VALID | {"name": f"m{i}"}).json()
        mon = db.get(Monitor, m["id"])
        mon.status = status
        db.add(Incident(monitor_id=m["id"], started_at=datetime.now(UTC), reason="x")) if status == "down" else None
        db.commit()
    paused = auth_client.post("/api/monitors", json=VALID | {"name": "p", "enabled": False}).json()
    s = auth_client.get("/api/dashboard/summary").json()
    assert (
        s["total_monitors"],
        s["healthy_monitors"],
        s["down_monitors"],
        s["paused_monitors"],
        s["active_incidents"],
    ) == (4, 2, 1, 1, 1)
    assert s["overall_uptime_24h"] is None
    _ = paused


def test_api_key_lifecycle(auth_client, client):
    created = auth_client.post("/api/api-keys", json={"name": "ci"}).json()
    raw = created["key"]
    assert raw.startswith("apm_") and created["prefix"] == raw[:12]
    listed = auth_client.get("/api/api-keys").json()
    assert "key" not in listed[0] and "key_hash" not in listed[0]
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anon:
        assert anon.get("/api/monitors", headers={"Authorization": f"Bearer {raw}"}).status_code == 200
        assert anon.get("/api/monitors", headers={"Authorization": "Bearer apm_wrong"}).status_code == 401
        assert auth_client.delete(f"/api/api-keys/{created['id']}").status_code == 204
        assert anon.get("/api/monitors", headers={"Authorization": f"Bearer {raw}"}).status_code == 401
    assert auth_client.get("/api/api-keys").json()[0]["revoked_at"] is not None


def test_api_key_stored_hashed(auth_client, db):
    from sqlalchemy import select

    from app.models import ApiKey

    raw = auth_client.post("/api/api-keys", json={"name": "k"}).json()["key"]
    row = db.scalars(select(ApiKey)).one()
    assert raw not in (row.key_hash, row.prefix) and len(row.key_hash) == 64


def test_channels_mask_secrets_and_validate(auth_client):
    r = auth_client.post(
        "/api/channels",
        json={"type": "discord", "name": "d", "url": "https://discord.com/api/webhooks/123/SECRETTOKEN"},
    )
    assert r.status_code == 201 and "SECRETTOKEN" not in r.text
    assert auth_client.post("/api/channels", json={"type": "email", "name": "e"}).status_code == 422
    assert (
        auth_client.post("/api/channels", json={"type": "webhook", "name": "w", "url": "http://127.0.0.1/x"}).json()[
            "error"
        ]["code"]
        == "invalid_target"
    )


def test_public_status_page_hides_private_details(auth_client, client, db):
    pub = auth_client.post(
        "/api/monitors",
        json=VALID | {"name": "Payments API", "show_on_status_page": True, "headers": {"X-Secret": "hunter2"}},
    ).json()
    auth_client.post("/api/monitors", json=VALID | {"name": "Hidden internal"})
    db.add(Incident(monitor_id=pub["id"], started_at=datetime.now(UTC), reason="secret internal stacktrace"))
    db.commit()
    mon = db.get(Monitor, pub["id"])
    mon.status = "up"
    db.commit()

    assert client.get("/api/public/status/acme").status_code == 404  # not enabled
    assert auth_client.put("/api/status-page", json={"enabled": True, "slug": "acme"}).status_code == 200
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anon:
        r = anon.get("/api/public/status/acme")
        assert r.status_code == 200
        text = r.text
        assert "Payments API" in text and "Hidden internal" not in text
        for leaked in ("hunter2", "api.example.com", "secret internal", "X-Secret"):
            assert leaked not in text
        assert r.json()["components"][0]["status"] == "operational" and len(r.json()["incidents"]) == 1
        auth_client.put("/api/status-page", json={"enabled": False, "slug": "acme"})
        assert anon.get("/api/public/status/acme").status_code == 404


def test_status_page_slug_validation(auth_client):
    for bad in ("A", "ab", "Has Space", "-lead", "x" * 70):
        assert auth_client.put("/api/status-page", json={"enabled": True, "slug": bad}).status_code == 422
    assert auth_client.put("/api/status-page", json={"enabled": True}).status_code == 422


def test_security_headers(client):
    h = client.get("/health").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
    assert "default-src 'none'" in h["content-security-policy"]


def test_docs_and_openapi_available(client):
    assert client.get("/docs").status_code == 200
    spec = client.get("/openapi.json").json()
    assert "/api/monitors" in spec["paths"] and "/health" in spec["paths"]


def test_cors_only_allows_configured_origin(client):
    ok = client.options(
        "/api/monitors", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    bad = client.options(
        "/api/monitors", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in bad.headers


def test_request_size_limit(auth_client):
    big = {"name": "x", "url": "https://example.com", "body": "a" * 300_000, "method": "POST"}
    r = auth_client.post("/api/monitors", json=big)
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload_too_large"


def test_health_ready_and_metrics(client):
    assert client.get("/health").json() == {"status": "ok"}
    r = client.get("/ready")
    assert r.status_code == 200 and r.json()["checks"] == {"postgres": True, "redis": True}
    m = client.get("/metrics")
    assert m.status_code == 200 and "monitor_checks_total" in m.text and "incidents_created_total" in m.text


def test_ready_reports_unavailable_without_leaking(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    r = client.get("/ready")
    assert r.status_code == 503 and r.json()["error"]["details"]["redis"] is False
    assert "127.0.0.1" not in r.text


def test_rate_limit_returns_429_with_retry_after(client, monkeypatch):
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "auth_rate_limit_per_minute", 3)
    ratelimit._client = None
    codes = [
        client.post("/api/auth/login", json={"email": "a@example.com", "password": "x"}).status_code for _ in range(5)
    ]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x"})
    assert int(r.headers["retry-after"]) >= 1 and r.json()["error"]["code"] == "rate_limited"
    ratelimit._client = None


def test_rate_limiter_fails_open_when_redis_down(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    ratelimit._client = None
    assert asyncio.run(ratelimit.check_limit("k", 1)) == (True, 0)
    ratelimit._client = None


def test_unhandled_errors_use_envelope_and_hide_details():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.errors import register_error_handlers

    mini = FastAPI()
    register_error_handlers(mini)

    @mini.get("/boom")
    def boom():
        raise RuntimeError("secret internals")

    r = TestClient(mini, raise_server_exceptions=False).get("/boom")
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    assert "secret" not in r.text


def test_heartbeats_scoped_and_ordered(auth_client, other_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    add_checks(db, m["id"], [10, 10], success=True, age=timedelta(minutes=10))
    add_checks(db, m["id"], [None], success=False, age=timedelta(minutes=1))
    assert auth_client.get("/api/monitors/heartbeats").json() == {str(m["id"]): [True, True, False]}
    assert other_client.get("/api/monitors/heartbeats").json() == {}
