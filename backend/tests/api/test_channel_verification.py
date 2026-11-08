"""Email channels must be confirmed by the recipient before Pulse sends them anything, and the mail a user can
trigger on demand is capped. Otherwise any account could use Pulse to send its own text to arbitrary inboxes."""

import re
import smtplib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import quota
from app.core.config import get_settings
from app.core.security import create_access_token
from app.models import Incident, Notification, NotificationChannel
from app.services import channel_verification, notification_service
from tests.conftest import register
from tests.integration.helpers import make_channel, make_monitor, make_user, outcome

PHISH = "Your account is locked - sign in at evil.example"


@pytest.fixture
def outbox(monkeypatch):
    sent: list = []

    class FakeSMTP:
        def __init__(self, *a, **k): ...
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def send_message(self, msg):
            sent.append(msg)

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return sent


def _add_email(client, name="On-call", address="victim@example.com"):
    return client.post("/api/channels", json={"type": "email", "name": name, "address": address})


def _token_from(mail) -> str:
    match = re.search(r"/verify-channel#token=(\S+)", mail.get_content())
    assert match, mail.get_content()
    return match.group(1)


def test_new_email_channel_is_unverified_and_gets_only_a_confirmation_mail(auth_client, outbox):
    r = _add_email(auth_client, name=PHISH)
    assert r.status_code == 201 and r.json()["verified"] is False
    assert len(outbox) == 1 and outbox[0]["To"] == "victim@example.com"
    # Nothing the account controls appears in the mail: not the channel name, not the account's email.
    text = outbox[0]["Subject"] + outbox[0].get_content()
    assert "evil.example" not in text and "a@example.com" not in text
    assert "?token=" not in text  # fragment only, so the token stays out of server logs


def test_webhook_channels_are_verified_on_creation(auth_client, outbox):
    r = auth_client.post("/api/channels", json={"type": "webhook", "name": "w", "url": "https://hooks.example.com/x"})
    assert r.json()["verified"] is True and outbox == []


def test_unverified_channel_cannot_be_sent_a_test(auth_client, outbox):
    cid = _add_email(auth_client).json()["id"]
    r = auth_client.post(f"/api/channels/{cid}/test")
    assert r.status_code == 409 and r.json()["error"]["code"] == "channel_unverified"
    assert len(outbox) == 1  # only the confirmation


def test_following_the_link_verifies_the_channel_without_signing_in(auth_client, client, outbox):
    from fastapi.testclient import TestClient

    from app.main import app

    cid = _add_email(auth_client).json()["id"]
    token = _token_from(outbox[0])
    with TestClient(app) as anonymous:  # the recipient need not have an account
        r = anonymous.post("/api/public/verify-channel", json={"token": token})
        assert r.status_code == 200 and r.json() == {"status": "verified"}
        assert anonymous.post("/api/public/verify-channel", json={"token": token}).status_code == 200  # idempotent
    assert auth_client.get("/api/channels").json()[0]["verified"] is True
    assert auth_client.post(f"/api/channels/{cid}/test").status_code == 200
    assert len(outbox) == 2


@pytest.mark.parametrize("bad", ["garbage", "", "x" * 3000])
def test_malformed_tokens_are_rejected(client, bad):
    r = client.post("/api/public/verify-channel", json={"token": bad})
    assert r.status_code in (400, 422)


def test_session_tokens_and_verification_tokens_are_not_interchangeable(auth_client, client, outbox, db):
    _add_email(auth_client)
    session_token = create_access_token(1)
    assert client.post("/api/public/verify-channel", json={"token": session_token}).status_code == 400
    verify_token = _token_from(outbox[0])
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {verify_token}"})
    assert r.status_code == 401


def test_token_is_bound_to_the_channel_address_and_expires(auth_client, client, outbox, db):
    cid = _add_email(auth_client).json()["id"]
    token = _token_from(outbox[0])
    ch = db.get(NotificationChannel, cid)

    expired = channel_verification.make_token(ch, now=datetime.now(UTC) - timedelta(days=3))
    assert client.post("/api/public/verify-channel", json={"token": expired}).status_code == 400

    ch.configuration = {"address": "someone-else@example.com"}
    db.commit()
    assert client.post("/api/public/verify-channel", json={"token": token}).status_code == 400
    db.refresh(ch)
    assert ch.verified_at is None


def test_resend_confirmation(auth_client, outbox):
    cid = _add_email(auth_client).json()["id"]
    assert auth_client.post(f"/api/channels/{cid}/resend-confirmation").status_code == 202
    assert len(outbox) == 2
    auth_client.post("/api/public/verify-channel", json={"token": _token_from(outbox[1])})
    r = auth_client.post(f"/api/channels/{cid}/resend-confirmation")
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_verified"


def test_resend_is_owner_only(auth_client, other_client, outbox):
    cid = _add_email(auth_client).json()["id"]
    assert other_client.post(f"/api/channels/{cid}/resend-confirmation").status_code == 404


def test_smtp_failure_still_creates_the_channel_and_resend_reports_it(auth_client, monkeypatch):
    def boom(*a, **k):
        raise ConnectionRefusedError

    monkeypatch.setattr(smtplib, "SMTP", boom)
    r = _add_email(auth_client)
    assert r.status_code == 201 and r.json()["verified"] is False
    r = auth_client.post(f"/api/channels/{r.json()['id']}/resend-confirmation")
    assert r.status_code == 502 and r.json()["error"]["code"] == "delivery_failed"


def test_confirmation_emails_are_capped_per_account(auth_client, client, outbox, monkeypatch):
    monkeypatch.setattr(get_settings(), "channel_verification_emails_per_hour", 2)
    monkeypatch.setattr(get_settings(), "max_channels_per_user", 50)
    assert _add_email(auth_client, address="one@example.com").status_code == 201
    cid = _add_email(auth_client, address="two@example.com").json()["id"]
    r = _add_email(auth_client, address="three@example.com")
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert auth_client.post(f"/api/channels/{cid}/resend-confirmation").status_code == 429
    assert len(outbox) == 2
    assert len(auth_client.get("/api/channels").json()) == 2  # the refused one was not created
    # Deleting and re-adding doesn't reset it.
    auth_client.delete(f"/api/channels/{cid}")
    assert _add_email(auth_client, address="two@example.com").status_code == 429
    # Another account has its own allowance.
    register(client, "c@example.com")
    assert _add_email(client, address="four@example.com").status_code == 201


def test_test_notifications_are_capped_per_account(auth_client, monkeypatch, target):
    monkeypatch.setattr(get_settings(), "channel_tests_per_hour", 2)
    cid = auth_client.post("/api/channels", json={"type": "webhook", "name": "w", "url": f"{target.base}/hook"}).json()[
        "id"
    ]
    codes = [auth_client.post(f"/api/channels/{cid}/test").status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_quota_falls_back_to_a_local_counter_when_redis_is_down(monkeypatch):
    monkeypatch.setattr(get_settings(), "redis_url", "redis://127.0.0.1:1/0")
    monkeypatch.setattr(quota, "_client", None)
    quota._local.clear()
    assert [quota.consume("k", 2) is None for _ in range(3)] == [True, True, False]
    quota._local.clear()


def test_incidents_never_notify_unverified_channels(db):
    from app.services.incident_service import record_check

    u = make_user(db)
    m = make_monitor(db, u)
    verified = make_channel(db, u, "email")
    make_channel(db, u, "email", verified=False)
    for _ in range(3):
        record_check(db, m.id, outcome(False))
        db.commit()
    notes = db.scalars(select(Notification)).all()
    assert [n.channel_id for n in notes] == [verified.id]


def test_delivery_refuses_an_unverified_channel(db, outbox):
    u = make_user(db)
    m = make_monitor(db, u)
    ch = make_channel(db, u, "email", verified=False)
    inc = Incident(monitor_id=m.id, started_at=datetime.now(UTC), reason=PHISH)
    db.add(inc)
    db.commit()
    n = Notification(incident_id=inc.id, channel_id=ch.id, event_type="created")
    db.add(n)
    db.commit()
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    db.refresh(n)
    assert n.status == "failed" and outbox == []
