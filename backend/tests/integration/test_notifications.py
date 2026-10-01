import smtplib
from datetime import UTC, datetime

from sqlalchemy import select

from app.models import Incident, IncidentEvent, Notification
from app.services import notification_service
from app.services.notifications.base import IncidentMessage, format_duration
from tests.integration.helpers import make_channel, make_monitor, make_user


def setup_notification(db, channel_type="webhook", event="created"):
    u = make_user(db)
    m = make_monitor(db, u, name="Production API")
    ch = make_channel(db, u, channel_type)
    inc = Incident(
        monitor_id=m.id, started_at=datetime(2026, 1, 1, 12, 31, tzinfo=UTC), reason="3 consecutive failures"
    )
    db.add(inc)
    db.commit()
    n = Notification(incident_id=inc.id, channel_id=ch.id, event_type=event)
    db.add(n)
    db.commit()
    return u, m, ch, inc, n


def test_message_formats():
    start = datetime(2026, 1, 1, 12, 31, tzinfo=UTC)
    created = IncidentMessage("created", 1, "Production API", "https://example.com", "3 consecutive failures", start)
    assert "🚨 API INCIDENT" in created.body() and "Started: 12:31 UTC" in created.body()
    resolved = IncidentMessage(
        "resolved", 1, "Production API", "https://example.com", "x", start, datetime(2026, 1, 1, 12, 35, 21, tzinfo=UTC)
    )
    assert "✅ API RECOVERED" in resolved.body() and "Downtime: 4m 21s" in resolved.body()
    assert format_duration(3725) == "1h 2m 5s" and format_duration(7) == "7s"


def _point_at(db, target, path="/hook"):
    from app.models import NotificationChannel

    ch = db.scalars(select(NotificationChannel)).one()
    ch.configuration = {"url": f"{target.base}{path}"}
    db.commit()


def test_webhook_success_marks_sent_and_logs_timeline(db, target):
    *_, inc, n = setup_notification(db)
    _point_at(db, target)
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    db.refresh(n)
    assert n.status == "sent" and n.sent_at and n.attempts == 1
    assert target.requests[-1][0] == "POST" and b"incident.created" in target.requests[-1][2]
    assert "notification_sent" in [e.event_type for e in db.scalars(select(IncidentEvent))]


def test_5xx_is_retryable_then_fails_permanently_after_max_attempts(db, target):
    *_, n = setup_notification(db)
    _point_at(db, target)
    target.webhook_status = 503
    for attempt in range(1, notification_service.MAX_ATTEMPTS):
        err = notification_service.deliver(db, n.id)
        db.commit()
        assert err is not None and err.retryable
        db.refresh(n)
        assert n.status == "pending" and n.attempts == attempt
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    db.refresh(n)
    assert n.status == "failed" and "503" in n.error_message
    assert "notification_failed" in [e.event_type for e in db.scalars(select(IncidentEvent))]


def test_4xx_is_permanent_immediately(db, target):
    *_, n = setup_notification(db)
    _point_at(db, target)
    target.webhook_status = 400
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    db.refresh(n)
    assert n.status == "failed" and n.attempts == 1


def test_failed_notification_does_not_change_incident_state(db, target):
    *_, inc, n = setup_notification(db)
    _point_at(db, target)
    target.webhook_status = 500
    notification_service.deliver(db, n.id)
    db.commit()
    db.refresh(inc)
    assert inc.status == "open"


def test_ssrf_blocked_webhook_is_permanent(db):
    *_, n = setup_notification(db)
    from app.models import NotificationChannel

    ch = db.scalars(select(NotificationChannel)).one()
    ch.configuration = {"url": "http://169.254.169.254/latest/meta-data"}
    db.commit()
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    db.refresh(n)
    assert n.status == "failed" and "Blocked" in n.error_message


def test_sent_notifications_are_not_resent(db, target):
    *_, n = setup_notification(db)
    _point_at(db, target)
    notification_service.deliver(db, n.id)
    db.commit()
    count = len(target.requests)
    notification_service.deliver(db, n.id)
    assert len(target.requests) == count


def test_email_provider_uses_smtp(db, monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, *a, **k): ...
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def send_message(self, msg):
            sent.append(msg)

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    *_, n = setup_notification(db, "email")
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    assert sent[0]["To"] == "ops@example.com" and "INCIDENT" in sent[0]["Subject"]


def test_smtp_failure_is_retryable(db, monkeypatch):
    def boom(*a, **k):
        raise ConnectionRefusedError

    monkeypatch.setattr(smtplib, "SMTP", boom)
    *_, n = setup_notification(db, "email")
    err = notification_service.deliver(db, n.id)
    assert err is not None and err.retryable


def test_disabled_or_missing_channel_fails_without_sending(db):
    *_, ch, _, n = (*setup_notification(db),)
    ch.enabled = False
    db.commit()
    assert notification_service.deliver(db, n.id) is None
    db.commit()
    db.refresh(n)
    assert n.status == "failed"
