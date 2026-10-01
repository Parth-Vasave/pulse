from tests.conftest import register


def test_register_login_logout_flow(client):
    user = register(client)
    assert user["email"] == "a@example.com" and "password" not in user
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "correct-horse-battery"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_cookie_is_httponly(client):
    r = client.post("/api/auth/register", json={"email": "c@example.com", "password": "correct-horse-battery"})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_password_is_hashed(client, db):
    from sqlalchemy import select

    from app.models import User

    register(client)
    h = db.scalars(select(User)).one().password_hash
    assert h.startswith("$argon2") and "correct-horse" not in h


def test_duplicate_email_conflict(client):
    register(client)
    r = client.post("/api/auth/register", json={"email": "A@Example.com", "password": "correct-horse-battery"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"


def test_wrong_password_and_unknown_user_same_response(client):
    register(client)
    a = client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password-1"})
    b = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-1"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_validation_error_envelope(client):
    r = client.post("/api/auth/register", json={"email": "not-an-email", "password": "short"})
    assert r.status_code == 422
    body = r.json()["error"]
    assert body["code"] == "validation_error" and {d["field"] for d in body["details"]} == {"email", "password"}


def test_unauthenticated_requests_rejected(client):
    for path in ("/api/monitors", "/api/incidents", "/api/channels", "/api/api-keys", "/api/dashboard/summary"):
        assert client.get(path).status_code == 401


def test_tampered_token_rejected(client):
    register(client)
    client.cookies.set("access_token", client.cookies.get("access_token")[:-3] + "abc")
    assert client.get("/api/auth/me").status_code == 401
