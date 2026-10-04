"""Secrets must never sit readable in Postgres, yet behave exactly as before through the API and the checker."""

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from app.core.config import get_settings
from app.core.crypto import ENVELOPE_KEY, DecryptionError, is_envelope
from app.core.database import engine
from app.models import Monitor, NotificationChannel
from app.rotate_keys import rotate_all
from tests.api.test_monitors import VALID
from tests.integration.helpers import make_channel, make_monitor, make_user
from worker.tasks import check as check_task

HEADERS = {"Authorization": "Bearer top-secret-token", "X-Api-Key": "key-12345"}
WEBHOOK = "https://hooks.example.com/services/T000/B000/hunter2-webhook-secret"


def raw(table: str, column: str, row_id: int):
    with engine.connect() as conn:
        return conn.execute(text(f"SELECT {column} FROM {table} WHERE id = :i"), {"i": row_id}).scalar_one()  # noqa: S608


def test_monitor_headers_are_encrypted_in_the_database_but_plain_through_the_api(auth_client):
    created = auth_client.post("/api/monitors", json={**VALID, "headers": HEADERS})
    assert created.status_code == 201, created.text
    stored = raw("monitors", "headers", created.json()["id"])
    assert is_envelope(stored)
    assert "top-secret-token" not in str(stored) and "key-12345" not in str(stored)
    assert auth_client.get(f"/api/monitors/{created.json()['id']}").json()["headers"] == HEADERS


def test_updating_headers_re_encrypts_and_clearing_them_works(auth_client):
    mid = auth_client.post("/api/monitors", json={**VALID, "headers": HEADERS}).json()["id"]
    assert auth_client.patch(f"/api/monitors/{mid}", json={"headers": {"X-New": "rotated-value"}}).status_code == 200
    assert "rotated-value" not in str(raw("monitors", "headers", mid))
    assert auth_client.get(f"/api/monitors/{mid}").json()["headers"] == {"X-New": "rotated-value"}
    assert auth_client.patch(f"/api/monitors/{mid}", json={"headers": {}}).status_code == 200
    assert raw("monitors", "headers", mid) == {}
    assert auth_client.get(f"/api/monitors/{mid}").json()["headers"] == {}


def test_webhook_url_is_encrypted_in_the_database_and_masked_in_the_api(auth_client):
    r = auth_client.post("/api/channels", json={"type": "webhook", "name": "hook", "url": WEBHOOK})
    assert r.status_code == 201, r.text
    stored = raw("notification_channels", "configuration", r.json()["id"])
    assert is_envelope(stored) and "hunter2" not in str(stored) and "hooks.example.com" not in str(stored)
    assert r.json()["target"] == "hooks.example.com/…"


def test_the_checker_sends_the_decrypted_headers(db, target):
    m = make_monitor(db, make_user(db), headers=HEADERS)
    m.url = f"{target.base}/healthy"
    db.commit()
    assert is_envelope(raw("monitors", "headers", m.id))  # encrypted at rest...
    check_task._execute(m.id)
    sent = target.request_headers[-1]  # ...but the target receives the real values
    assert sent["Authorization"] == HEADERS["Authorization"] and sent["X-Api-Key"] == HEADERS["X-Api-Key"]


def test_wrong_key_makes_reads_fail_loudly(db, monkeypatch):
    user = make_user(db)
    m = make_monitor(db, user, headers=HEADERS)
    db.expire_all()
    monkeypatch.setattr(get_settings(), "encryption_key", Fernet.generate_key().decode())
    with pytest.raises(DecryptionError):
        db.get(Monitor, m.id)


def test_rotate_all_moves_every_secret_to_the_new_key(db, monkeypatch):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    settings = get_settings()
    monkeypatch.setattr(settings, "encryption_key", old)
    user = make_user(db)
    m = make_monitor(db, user, headers=HEADERS)
    plain = make_monitor(db, user, name="no-headers")  # empty headers are not encrypted and must be skipped
    ch = make_channel(db, user, url=WEBHOOK)
    before = raw("monitors", "headers", m.id)[ENVELOPE_KEY]

    monkeypatch.setattr(settings, "encryption_key", f"{new},{old}")
    with engine.begin() as conn:
        assert rotate_all(conn) == 2
    assert raw("monitors", "headers", m.id)[ENVELOPE_KEY] != before
    assert raw("monitors", "headers", plain.id) == {}

    monkeypatch.setattr(settings, "encryption_key", new)  # the old key can now be dropped
    db.expire_all()
    assert db.get(Monitor, m.id).headers == HEADERS
    assert db.get(NotificationChannel, ch.id).configuration == {"url": WEBHOOK}
