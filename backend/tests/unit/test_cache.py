import time
from types import SimpleNamespace

import pytest
import redis

from app.core import cache


@pytest.fixture
def unreachable(monkeypatch):
    """The real client, pointed at a port nothing listens on (connection refused)."""
    cache._redis.cache_clear()
    monkeypatch.setattr(cache, "get_settings", lambda: SimpleNamespace(redis_url="redis://127.0.0.1:1/0"))
    yield
    cache._redis.cache_clear()


def test_outage_costs_no_retries_or_backoff(unreachable):
    assert cache._redis().get_retry().get_retries() == 0
    started = time.monotonic()
    assert cache.get_json("k") is None
    cache.set_json("k", 1, 60)
    # redis-py's default policy retries 3 times with up to 1 + 2 + 4 s of backoff per call.
    assert time.monotonic() - started < 0.5


def test_breaker_skips_redis_after_a_failure_then_tries_again(monkeypatch):
    calls = []

    def down(*args, **kwargs):
        calls.append(args)
        raise redis.ConnectionError("down")

    monkeypatch.setattr(cache._redis(), "get", down)
    monkeypatch.setattr(cache._redis(), "set", down)
    assert cache.get_json("k") is None and len(calls) == 1
    assert cache.get_json("k") is None
    cache.set_json("k", 1, 60)
    assert len(calls) == 1  # both skipped while the breaker is open
    assert cache._skip_until - time.monotonic() == pytest.approx(cache.BREAKER_SECONDS, abs=1)

    cache._skip_until = time.monotonic() - 1  # the breaker period has passed
    assert cache.get_json("k") is None and len(calls) == 2


def test_corrupt_value_is_a_miss_and_gets_replaced():
    cache._redis().set(cache.PREFIX + "k", b"\xff{not json")
    assert cache.get_json("k") is None
    assert cache._skip_until == 0.0  # bad data is not an outage
    cache.set_json("k", {"1": 99.5}, 60)
    assert cache.get_json("k") == {"1": 99.5}
