import os

# Must be set before `app` is imported: engine is created at import time.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://parth@localhost:5432/monitor_test"
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ["SSRF_ALLOWED_HOSTS"] = ""
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["AUTH_RATE_LIMIT_PER_MINUTE"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    import app.models  # noqa: F401

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def _clean_db(_schema):
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE users, monitors, check_results, incidents, incident_events, "
                "notification_channels, notifications, api_keys RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def register(client: TestClient, email: str = "a@example.com", password: str = "correct-horse-battery"):
    r = client.post("/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def auth_client(client):
    register(client)
    return client


@pytest.fixture
def other_client():
    """A second, independent session (separate cookie jar)."""
    with TestClient(app) as c:
        register(c, "b@example.com")
        yield c


DNS_OVERRIDES: dict[str, list[str] | str] = {}


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    """Tests never touch real DNS: every host resolves to a public IP unless overridden."""
    import socket

    from app.services import ssrf

    DNS_OVERRIDES.clear()

    def fake(host: str, port: int) -> list[str]:
        result = DNS_OVERRIDES.get(host, ["93.184.216.34"])
        if result == "NXDOMAIN":
            raise socket.gaierror("no such host")
        return result  # type: ignore[return-value]

    monkeypatch.setattr(ssrf, "system_resolver", fake)
    return DNS_OVERRIDES


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Each test starts with empty counters and a fresh async client (TestClient loops are per-test)."""
    import redis

    from app.core import ratelimit
    from app.core.config import get_settings

    ratelimit._client = None
    r = redis.Redis.from_url(get_settings().redis_url)
    for key in r.scan_iter("rl:*"):
        r.delete(key)
    yield
    ratelimit._client = None


from tests.worker.conftest import target  # noqa: E402,F401  (shared fixture)
