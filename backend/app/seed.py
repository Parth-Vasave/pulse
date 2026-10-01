"""Development seed data: `python -m app.seed`. Idempotent.

Creates a demo user with monitors pointed at the bundled demo service, ~24h of synthetic history so the
charts are populated immediately, one resolved incident and one open incident.
"""

import os
import random
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.core.database import session_scope
from app.core.logging import configure_logging, get_logger
from app.core.security import hash_password
from app.models import CheckResult, Incident, IncidentEvent, Monitor, NotificationChannel, User

log = get_logger("app.seed")
DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo-password-123"  # noqa: S105  (development only; printed on seed)

# (name, path, interval, extra) - the last two intentionally misbehave
MONITORS: list[tuple[str, str, int, dict[str, Any]]] = [
    (
        "Demo API",
        "/healthy",
        30,
        {"assertions": [{"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"}]},
    ),
    ("Authentication API", "/switch", 30, {"show_on_status_page": True}),
    ("Slow Search API", "/slow", 60, {"response_time_threshold_ms": 2000, "timeout_seconds": 10}),
    ("Flaky Payments API", "/flaky", 30, {"failure_threshold": 3, "show_on_status_page": True}),
    ("Example failing API", "/error", 30, {"failure_threshold": 2}),
]


def _history(db, monitor: Monitor, base_ms: int, fail_rate: float, always_fail: bool, now: datetime) -> None:
    rng = random.Random(monitor.id)  # noqa: S311  (deterministic fake data)
    step = timedelta(seconds=monitor.interval_seconds)  # history looks like what the worker would have recorded
    t = now - timedelta(hours=24)
    rows = []
    while t < now - timedelta(minutes=1):
        failed = always_fail or rng.random() < fail_rate
        rows.append(
            CheckResult(
                monitor_id=monitor.id,
                checked_at=t,
                success=not failed,
                status_code=500 if failed else 200,
                response_time_ms=max(5, int(rng.gauss(base_ms, base_ms * 0.25))),
                check_duration_ms=base_ms,
                error_type="http_error" if failed else None,
                error_message="Expected HTTP 200, got 500" if failed else None,
            )
        )
        t += step
    db.add_all(rows)


def _incident(db, monitor: Monitor, started: datetime, resolved: datetime | None, failures: int) -> None:
    inc = Incident(
        monitor_id=monitor.id,
        started_at=started,
        resolved_at=resolved,
        status="resolved" if resolved else "open",
        failure_count=failures,
        recovery_count=monitor.recovery_threshold if resolved else 0,
        reason=f"{failures} consecutive failures. Last error: Expected HTTP 200, got 500",
    )
    db.add(inc)
    db.flush()
    gap = timedelta(seconds=30)
    events = [
        (started - gap, "first_failure", "First failure: Expected HTTP 200, got 500"),
        (started, "incident_created", f"Incident created after {monitor.failure_threshold} consecutive failures"),
    ]
    if resolved:
        events += [(resolved, "recovered", "API recovered"), (resolved, "incident_resolved", "Incident resolved")]
    db.add_all(IncidentEvent(incident_id=inc.id, occurred_at=at, event_type=k, message=m) for at, k, m in events)


def seed() -> None:
    base = os.environ.get("DEMO_TARGET_URL", "http://demo-service:9000").rstrip("/")
    now = datetime.now(UTC)
    with session_scope() as db:
        if db.scalars(select(User).where(User.email == DEMO_EMAIL)).first():
            log.info("seed_skipped_already_present")
            return
        user = User(
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            status_page_enabled=True,
            status_page_slug="demo",
        )
        db.add(user)
        db.flush()
        db.add(
            NotificationChannel(
                user_id=user.id, type="email", name="On-call email", configuration={"address": "oncall@example.com"}
            )
        )
        for name, path, interval, extra in MONITORS:
            m = Monitor(
                user_id=user.id,
                name=name,
                url=f"{base}{path}",
                interval_seconds=interval,
                next_check_at=now + timedelta(seconds=10),
                **extra,
            )
            db.add(m)
            db.flush()
            failing = path == "/error"
            _history(db, m, {"/slow": 3000, "/switch": 40}.get(path, 25), {"/flaky": 0.4}.get(path, 0.0), failing, now)
            m.status = "down" if failing else "up"
            m.consecutive_failures = 12 if failing else 0
            m.last_checked_at = now - timedelta(minutes=1)
            m.last_response_time_ms = 25
            if failing:
                _incident(db, m, now - timedelta(hours=2), None, 12)
            if path == "/switch":
                _incident(db, m, now - timedelta(hours=7), now - timedelta(hours=6, minutes=48), 4)
    print(f"Seeded demo data. Login: {DEMO_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    configure_logging("seed")
    seed()
