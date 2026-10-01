from datetime import UTC, datetime, timedelta

from app.models import Monitor, NotificationChannel, User
from app.services.incident_service import CheckOutcome


def make_user(db, email="u@example.com") -> User:
    u = User(email=email, password_hash="x")
    db.add(u)
    db.commit()
    return u


def make_monitor(db, user, **kw) -> Monitor:
    m = Monitor(
        user_id=user.id,
        name=kw.pop("name", "API"),
        url="https://api.example.com/h",
        failure_threshold=kw.pop("failure_threshold", 3),
        recovery_threshold=kw.pop("recovery_threshold", 2),
        **kw,
    )
    db.add(m)
    db.commit()
    return m


def make_channel(db, user, type_="webhook", url="http://target.test/hook", enabled=True) -> NotificationChannel:
    cfg = {"address": "ops@example.com"} if type_ == "email" else {"url": url}
    c = NotificationChannel(user_id=user.id, type=type_, name=f"{type_}-channel", configuration=cfg, enabled=enabled)
    db.add(c)
    db.commit()
    return c


_clock = {"t": datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)}


def outcome(success: bool, **kw) -> CheckOutcome:
    _clock["t"] += timedelta(seconds=10)
    if success:
        return CheckOutcome(_clock["t"], True, 200, kw.get("rt", 50), 60)
    return CheckOutcome(
        _clock["t"],
        False,
        kw.get("status"),
        None,
        5000,
        kw.get("error_type", "timeout"),
        kw.get("message", "Request timed out"),
    )
