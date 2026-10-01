from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import ApiKey, CheckResult, Incident, Monitor, NotificationChannel, User
from tests.api.test_monitors import VALID
from tests.conftest import register

PW = "correct-horse-battery"
NEW_PW = "another-long-passphrase"


def login(email="a@example.com", password=PW) -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


# ---- change email ----------------------------------------------------------------------------
def test_change_email(auth_client):
    r = auth_client.post("/api/account/email", json={"new_email": "New@Example.com", "current_password": PW})
    assert r.status_code == 200 and r.json()["email"] == "new@example.com"
    assert auth_client.get("/api/auth/me").json()["email"] == "new@example.com"
    login("new@example.com")  # can log in with the new address
    assert TestClient(app).post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 401


def test_change_email_requires_correct_password(auth_client):
    r = auth_client.post(
        "/api/account/email", json={"new_email": "x@example.com", "current_password": "wrong-password"}
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "incorrect_password"
    assert auth_client.get("/api/auth/me").json()["email"] == "a@example.com"  # session still valid, email unchanged


def test_change_email_conflicts_and_noop(auth_client, other_client):
    r = auth_client.post("/api/account/email", json={"new_email": "b@example.com", "current_password": PW})
    assert r.status_code == 409
    r = auth_client.post("/api/account/email", json={"new_email": "a@example.com", "current_password": PW})
    assert r.status_code == 422
    assert auth_client.post("/api/account/email", json={"new_email": "nope", "current_password": PW}).status_code == 422


# ---- change password -------------------------------------------------------------------------
def test_change_password_rotates_credentials(auth_client):
    r = auth_client.post("/api/account/password", json={"current_password": PW, "new_password": NEW_PW})
    assert r.status_code == 204
    assert auth_client.get("/api/auth/me").status_code == 200  # this session got a fresh cookie
    assert TestClient(app).post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 401
    login(password=NEW_PW)


def test_change_password_signs_out_other_sessions(auth_client):
    other_session = login()
    assert other_session.get("/api/auth/me").status_code == 200
    auth_client.post("/api/account/password", json={"current_password": PW, "new_password": NEW_PW})
    assert other_session.get("/api/auth/me").status_code == 401  # old credential version
    assert auth_client.get("/api/auth/me").status_code == 200


def test_password_change_keeps_api_keys_working(auth_client):
    raw = auth_client.post("/api/api-keys", json={"name": "ci"}).json()["key"]
    auth_client.post("/api/account/password", json={"current_password": PW, "new_password": NEW_PW})
    r = TestClient(app).get("/api/monitors", headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200


@pytest.mark.parametrize(
    ("current", "new", "status"),
    [("wrong-password!", NEW_PW, 403), (PW, "short", 422), (PW, PW, 422), (PW, "x" * 200, 422)],
)
def test_change_password_rejections(auth_client, current, new, status):
    r = auth_client.post("/api/account/password", json={"current_password": current, "new_password": new})
    assert r.status_code == status
    login()  # password unchanged


def test_password_hash_is_new_argon2(auth_client, db):
    auth_client.post("/api/account/password", json={"current_password": PW, "new_password": NEW_PW})
    user = db.scalars(select(User)).one()
    assert user.password_hash.startswith("$argon2") and NEW_PW not in user.password_hash
    assert user.password_changed_at is not None


# ---- delete account --------------------------------------------------------------------------
def test_delete_account_removes_everything_and_only_that_user(auth_client, other_client, db):
    m = auth_client.post("/api/monitors", json=VALID).json()
    db.add(CheckResult(monitor_id=m["id"], checked_at=datetime.now(UTC), success=True))
    db.add(Incident(monitor_id=m["id"], started_at=datetime.now(UTC), reason="x"))
    db.commit()
    auth_client.post("/api/channels", json={"type": "email", "name": "me", "address": "a@example.com"})
    auth_client.post("/api/api-keys", json={"name": "k"})
    other_client.post("/api/monitors", json=VALID | {"name": "keep me"})

    assert auth_client.post("/api/account/delete", json={"current_password": PW}).status_code == 204
    assert auth_client.get("/api/auth/me").status_code == 401  # cookie cleared / user gone
    db.expire_all()
    for model in (CheckResult, Incident, NotificationChannel, ApiKey):
        assert db.scalar(select(func.count()).select_from(model)) == 0, model.__name__
    assert [u.email for u in db.scalars(select(User))] == ["b@example.com"]
    assert [x.name for x in db.scalars(select(Monitor))] == ["keep me"]
    assert TestClient(app).post("/api/auth/login", json={"email": "a@example.com", "password": PW}).status_code == 401


def test_delete_account_requires_password(auth_client, db):
    r = auth_client.post("/api/account/delete", json={"current_password": "wrong-password!"})
    assert r.status_code == 403
    assert auth_client.get("/api/auth/me").status_code == 200
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_deleted_users_api_key_stops_working(auth_client):
    raw = auth_client.post("/api/api-keys", json={"name": "k"}).json()["key"]
    auth_client.post("/api/account/delete", json={"current_password": PW})
    assert TestClient(app).get("/api/monitors", headers={"Authorization": f"Bearer {raw}"}).status_code == 401


# ---- access control ----------------------------------------------------------------------------
@pytest.mark.parametrize("path", ["email", "password", "delete"])
def test_account_endpoints_require_authentication(client, path):
    assert client.post(f"/api/account/{path}", json={}).status_code == 401


def test_account_endpoints_use_strict_rate_limit(auth_client, monkeypatch):
    from app.core import ratelimit
    from app.core.config import get_settings

    # the fixture's register call already used 1 of the 3 strict-bucket requests
    monkeypatch.setattr(get_settings(), "auth_rate_limit_per_minute", 3)
    ratelimit._client = None
    codes = [
        auth_client.post("/api/account/delete", json={"current_password": "wrong-password!"}).status_code
        for _ in range(4)
    ]
    assert codes == [403, 403, 429, 429]  # password guessing against a session is throttled
    ratelimit._client = None


def test_register_helper_still_works(client):
    assert register(client, "c@example.com")["email"] == "c@example.com"
