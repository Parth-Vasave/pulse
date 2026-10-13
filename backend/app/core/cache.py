"""Short-lived JSON cache in Redis for expensive read-side aggregates.

Fail-open: if Redis is unavailable, reads miss and writes are dropped, so the caller computes the value
directly. The cache can make a request faster, never make it fail.
"""

import json
from functools import lru_cache
from typing import Any, cast

import redis

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("app.cache")
PREFIX = "pulse:cache:"


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, socket_timeout=0.5, socket_connect_timeout=0.5)


def get_json(key: str) -> Any | None:
    try:
        raw = cast(bytes | None, _redis().get(PREFIX + key))  # sync client: never awaitable
    except redis.RedisError as exc:
        log.warning("cache_unavailable", extra={"error": type(exc).__name__})
        return None
    return None if raw is None else json.loads(raw)


def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    try:
        _redis().set(PREFIX + key, json.dumps(value), ex=ttl_seconds)
    except redis.RedisError as exc:
        log.warning("cache_unavailable", extra={"error": type(exc).__name__})
