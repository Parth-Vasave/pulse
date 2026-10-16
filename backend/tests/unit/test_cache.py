import json
import threading
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


@pytest.fixture
def redis_down(monkeypatch):
    calls = []

    def down(*args, **kwargs):
        calls.append(args)
        raise redis.ConnectionError("down")

    for method in ("get", "set", "eval"):
        monkeypatch.setattr(cache._redis(), method, down)
    return calls


class Counter:
    def __init__(self, value, delay=0.0):
        self.value, self.delay, self.calls = value, delay, 0

    def __call__(self):
        self.calls += 1
        time.sleep(self.delay)
        return self.value


def store(key, value, age):
    cache._redis().set(cache.PREFIX + key, json.dumps({"at": time.time() - age, "v": value}))


def all_at_once(n, fn):
    barrier, results = threading.Barrier(n), []

    def run():
        barrier.wait()
        results.append(fn())

    threads = [threading.Thread(target=run) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_outage_costs_no_retries_or_backoff(unreachable):
    assert cache._redis().get_retry().get_retries() == 0
    started = time.monotonic()
    assert cache.get_or_compute("k", lambda: 1, 60) == 1
    # redis-py's default policy retries 3 times with up to 1 + 2 + 4 s of backoff per call.
    assert time.monotonic() - started < 0.5


def test_breaker_skips_redis_after_a_failure_then_tries_again(redis_down):
    assert cache.get_or_compute("k", lambda: 1, 60) == 1 and len(redis_down) == 1
    assert cache.get_or_compute("k", lambda: 2, 60) == 1  # served from the local copy
    assert len(redis_down) == 1  # Redis skipped while the breaker is open
    assert cache._skip_until - time.monotonic() == pytest.approx(cache.BREAKER_SECONDS, abs=1)

    cache._skip_until = time.monotonic() - 1  # the breaker period has passed
    cache.get_or_compute("k", lambda: 3, 60)
    assert len(redis_down) == 2


def test_corrupt_value_is_a_miss_and_gets_replaced():
    cache._redis().set(cache.PREFIX + "k", b"\xff{not json")
    assert cache.get_or_compute("k", lambda: {"1": 99.5}, 60) == {"1": 99.5}
    assert cache._skip_until == 0.0  # bad data is not an outage
    assert cache.get_or_compute("k", lambda: "recomputed", 60) == {"1": 99.5}


def test_fresh_value_is_served_and_values_round_trip_through_json():
    compute = Counter({1: 99.5})
    assert cache.get_or_compute("k", compute, 60) == {"1": 99.5}  # same shape on a miss as on a hit
    assert cache.get_or_compute("k", compute, 60) == {"1": 99.5} and compute.calls == 1


def test_unusable_value_is_recomputed():
    store("k", {"1": 1.0}, age=0)
    assert cache.get_or_compute("k", lambda: {"1": 1.0, "2": 2.0}, 60, usable=lambda v: "2" in v) == {
        "1": 1.0,
        "2": 2.0,
    }


def test_stale_value_is_refreshed_by_one_caller_while_the_others_get_it():
    store("k", "old", age=61)
    compute = Counter("new", delay=0.3)
    results = all_at_once(8, lambda: cache.get_or_compute("k", compute, 60))
    assert compute.calls == 1
    assert sorted(results) == ["new"] + ["old"] * 7
    assert cache.get_or_compute("k", compute, 60) == "new" and compute.calls == 1


def test_stale_value_is_served_while_another_process_holds_the_lock():
    store("k", "old", age=61)
    cache._redis().set(cache.PREFIX + "lock:k", "other-process", ex=30)
    assert cache.get_or_compute("k", lambda: pytest.fail("not the leader"), 60) == "old"


def test_cold_miss_computes_once_and_followers_wait_for_it():
    compute = Counter("v", delay=0.3)
    assert all_at_once(8, lambda: cache.get_or_compute("k", compute, 60)) == ["v"] * 8
    assert compute.calls == 1
    assert not cache._redis().exists(cache.PREFIX + "lock:k")  # released


def test_follower_computes_itself_if_the_leader_never_delivers(monkeypatch):
    monkeypatch.setattr(cache, "WAIT_SECONDS", 0.2)
    cache._redis().set(cache.PREFIX + "lock:k", "crashed-process", ex=30)
    assert cache.get_or_compute("k", lambda: "v", 60) == "v"


def test_without_redis_one_caller_per_process_computes(redis_down):
    compute = Counter("v", delay=0.3)
    assert all_at_once(8, lambda: cache.get_or_compute("k", compute, 60)) == ["v"] * 8
    assert compute.calls == 1


def test_leader_releases_the_lock_when_compute_fails():
    def boom():
        raise RuntimeError("db error")

    with pytest.raises(RuntimeError):
        cache.get_or_compute("k", boom, 60)
    assert not cache._redis().exists(cache.PREFIX + "lock:k")
    assert cache.get_or_compute("k", lambda: "v", 60) == "v"
