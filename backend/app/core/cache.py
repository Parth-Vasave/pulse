"""Short-lived JSON cache in Redis for expensive read-side aggregates.

Fail-open: if Redis is unavailable, reads miss and writes are dropped, so the caller computes the value
directly. The cache can make a request faster, never make it fail - or make it slow: the client never
retries (redis-py's default backs off for seconds), and after a failure Redis is skipped for
BREAKER_SECONDS, so an outage costs one short timeout per process instead of two per request.
"""

import json
import time
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
_skip_until = 0.0  # time.monotonic() before which Redis is presumed down


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


def get_json(key: str) -> Any | None:
    if not _available():
        return None
    try:
        raw = cast(bytes | None, _redis().get(PREFIX + key))  # sync client: never awaitable
    except redis.RedisError as exc:
        _trip(exc)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:  # not JSON, or not UTF-8: treat as a miss, and the caller's write replaces it
        log.warning("cache_corrupt", extra={"key": key})
        return None


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if not _available():
        return
    try:
        _redis().set(PREFIX + key, json.dumps(value), ex=ttl_seconds)
    except redis.RedisError as exc:
        _trip(exc)
