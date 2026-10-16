"""Short-lived JSON cache in Redis for expensive read-side aggregates.

Fail-open: if Redis is unavailable, reads miss and writes are dropped, so the caller computes the value
directly. The cache can make a request faster, never make it fail - or make it slow: the client never
retries (redis-py's default backs off for seconds), and after a failure Redis is skipped for
BREAKER_SECONDS, so an outage costs one short timeout per process instead of two per request.

Single-flight: when an entry goes stale, one caller recomputes it while concurrent callers keep getting
the old value, so an expiry costs one computation instead of one per request in flight. A process-local
copy and lock take over while Redis is down, so the protection holds (per process) during an outage.
"""

import json
import secrets
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any, cast

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("app.cache")
PREFIX = "pulse:cache:"
BREAKER_SECONDS = 10.0
STALE_FACTOR = 10  # entries outlive their freshness so there is an old value to serve during a recompute
LOCK_SECONDS = 30  # a crashed leader's lock expires; longer than any computation we cache
WAIT_SECONDS = 2.0  # how long a cold-miss follower waits for the leader before computing itself
_POLL_SECONDS = 0.05
_LOCAL_MAX = 1024
_RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"

_skip_until = 0.0  # time.monotonic() before which Redis is presumed down
_local: dict[str, str] = {}  # key -> serialised entry, read only while Redis is unavailable
_local_locks: dict[str, threading.Lock] = {}
_local_locks_guard = threading.Lock()
_MISSING = object()


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(
        get_settings().redis_url, socket_timeout=0.5, socket_connect_timeout=0.5, retry=Retry(NoBackoff(), 0)
    )


def _available() -> bool:
    return time.monotonic() >= _skip_until


def _trip(exc: redis.RedisError) -> None:
    global _skip_until
    _skip_until = time.monotonic() + BREAKER_SECONDS
    log.warning("cache_unavailable", extra={"error": type(exc).__name__, "skip_seconds": BREAKER_SECONDS})


def _read(key: str) -> tuple[float, Any] | None:
    """(stored at, value) from Redis, or from the local copy while Redis is unavailable."""
    raw: str | bytes | None = None
    if _available():
        try:
            raw = cast(bytes | None, _redis().get(PREFIX + key))  # sync client: never awaitable
        except redis.RedisError as exc:
            _trip(exc)
    if not _available():
        raw = _local.get(key)
    if raw is None:
        return None
    try:
        entry = json.loads(raw)
        return float(entry["at"]), entry["v"]
    except (ValueError, TypeError, KeyError):  # not JSON, not UTF-8, or not an entry: a miss we overwrite
        log.warning("cache_corrupt", extra={"key": key})
        return None


def _write(key: str, value: Any, ttl_seconds: int) -> None:
    raw = json.dumps({"at": time.time(), "v": value})
    if len(_local) >= _LOCAL_MAX:
        _local.clear()
    _local[key] = raw
    if not _available():
        return
    try:
        _redis().set(PREFIX + key, raw, ex=ttl_seconds)
    except redis.RedisError as exc:
        _trip(exc)


@contextmanager
def _leader(key: str) -> Iterator[bool]:
    """Yields True to the one caller (across processes, or within this one without Redis) that should compute."""
    if _available():
        lock, token = f"{PREFIX}lock:{key}", secrets.token_hex(8)
        try:
            won = bool(_redis().set(lock, token, nx=True, ex=LOCK_SECONDS))
        except redis.RedisError as exc:
            _trip(exc)
        else:
            try:
                yield won
            finally:
                if won:
                    try:
                        _redis().eval(_RELEASE, 1, lock, token)
                    except redis.RedisError as exc:
                        _trip(exc)  # the lock expires on its own
            return
    with _local_locks_guard:
        local = _local_locks.setdefault(key, threading.Lock())
    won = local.acquire(blocking=False)
    try:
        yield won
    finally:
        if won:
            local.release()


def get_or_compute(
    key: str,
    compute: Callable[[], Any],
    fresh_seconds: int,
    usable: Callable[[Any], bool] = lambda _: True,
) -> Any:
    """The cached value if it is fresh and `usable`, else `compute()`'s, computed by one caller at a time.

    The value goes through JSON, so the caller gets what JSON gives back (e.g. object keys are strings).
    """

    def lookup() -> tuple[bool, Any]:
        """(is fresh, value), with value _MISSING when there is nothing usable."""
        entry = _read(key)
        if entry is None or not usable(entry[1]):
            return False, _MISSING
        return time.time() - entry[0] < fresh_seconds, entry[1]

    is_fresh, value = lookup()
    if is_fresh:
        return value
    with _leader(key) as won:
        if won:
            is_fresh, latest = lookup()  # the previous leader may have finished since we looked
            if is_fresh:
                return latest
            value = json.loads(json.dumps(compute()))
            _write(key, value, fresh_seconds * STALE_FACTOR)
            return value
    if value is not _MISSING:
        return value  # stale, and another caller is refreshing it
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        time.sleep(_POLL_SECONDS)
        is_fresh, value = lookup()
        if is_fresh:
            return value
    return json.loads(json.dumps(compute()))  # the leader is slow or gone: don't make this request wait longer
