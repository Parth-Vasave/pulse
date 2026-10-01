import pytest

VALID = {
    "name": "Production API", "url": "https://api.example.com/health", "method": "GET", "headers": {},
    "timeout_seconds": 5, "interval_seconds": 60, "expected_status_code": 200,
    "failure_threshold": 3, "recovery_threshold": 2,
}


def test_create_and_get(auth_client):
    r = auth_client.post("/api/monitors", json=VALID)
    assert r.status_code == 201
    m = r.json()
    assert m["status"] == "unknown" and m["display_status"] == "unknown"
    assert auth_client.get(f"/api/monitors/{m['id']}").json()["name"] == "Production API"
    assert len(auth_client.get("/api/monitors").json()) == 1


@pytest.mark.parametrize("override", [
    {"url": "ftp://example.com"}, {"url": "not a url"}, {"method": "TRACE"}, {"timeout_seconds": 0},
    {"timeout_seconds": 3600}, {"interval_seconds": 5}, {"expected_status_code": 99},
    {"expected_status_code": 700}, {"failure_threshold": 0}, {"recovery_threshold": 99},
    {"headers": {"Host": "evil"}}, {"headers": {"X-A": "a\r\nInjected: 1"}},
    {"body": "x", "method": "GET"}, {"assertions": [{"type": "nope"}]},
    {"assertions": [{"type": "json_field", "path": "a"}]},
])
def test_invalid_configs_rejected(auth_client, override):
    assert auth_client.post("/api/monitors", json=VALID | override).status_code == 422


@pytest.mark.parametrize("url", [
    "http://localhost:8080", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/", "http://[::1]/", "http://metadata.google.internal/",
])
def test_ssrf_targets_rejected(auth_client, url):
    r = auth_client.post("/api/monitors", json=VALID | {"url": url})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_target"


def test_patch_revalidates_merged_config(auth_client):
    m = auth_client.post("/api/monitors", json=VALID).json()
    assert auth_client.patch(f"/api/monitors/{m['id']}", json={"interval_seconds": 120}).json()["interval_seconds"] == 120
    assert auth_client.patch(f"/api/monitors/{m['id']}", json={"method": "GET", "body": "x"}).status_code == 422
    assert auth_client.patch(f"/api/monitors/{m['id']}", json={"url": "http://127.0.0.1"}).status_code == 422
    assert auth_client.patch(f"/api/monitors/{m['id']}", json={"bogus": 1}).status_code == 422


def test_pause_resume(auth_client):
    m = auth_client.post("/api/monitors", json=VALID).json()
    paused = auth_client.patch(f"/api/monitors/{m['id']}", json={"enabled": False}).json()
    assert paused["display_status"] == "paused"
    assert auth_client.patch(f"/api/monitors/{m['id']}", json={"enabled": True}).json()["enabled"] is True


def test_delete_and_404(auth_client):
    m = auth_client.post("/api/monitors", json=VALID).json()
    assert auth_client.delete(f"/api/monitors/{m['id']}").status_code == 204
    r = auth_client.get(f"/api/monitors/{m['id']}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_monitor_limit(auth_client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_monitors_per_user", 1)
    assert auth_client.post("/api/monitors", json=VALID).status_code == 201
    assert auth_client.post("/api/monitors", json=VALID).status_code == 409


def test_assertions_roundtrip(auth_client):
    a = [{"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"},
         {"type": "body_contains", "value": "connected"}]
    m = auth_client.post("/api/monitors", json=VALID | {"assertions": a}).json()
    assert [x["type"] for x in m["assertions"]] == ["json_field", "body_contains"]
