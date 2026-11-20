"""Per-user quotas on things a user can make Pulse send on demand (confirmation emails, test notifications).

These protect third parties, not the API, so they count per account and over an hour rather than per IP per minute
like `ratelimit`. A fixed window is enough here: at a boundary it allows at most twice the hourly cap.
If Redis is unavailable we fall back to a per-process counter instead of failing open.
"""

import threading
import time
from typing import cast

import redis

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

log = get_logger("app.quota")
PREFIX = "rl:quota:"  # under rl:* so it lives (and is cleared in tests) alongside the rate limiter's keys

# KEYS: counter. ARGV: window seconds. Returns {count, ttl}; INCR and EXPIRE are atomic so no key lives forever.
_SCRIPT = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return {n, redis.call('TTL', KEYS[1])}
"""

_client: redis.Redis | None = None
_local: dict[str, tuple[int, int]] = {}  # fallback: key -> (window index, count)
_local_guard = threading.Lock()


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(get_settings().redis_url, socket_timeout=0.5, socket_connect_timeout=0.5)
    return _client


def _consume_local(key: str, limit: int, window_seconds: int, now: float) -> int | None:
    window = int(now // window_seconds)
    with _local_guard:
        if len(_local) > 10_000:
            for k in [k for k, (w, _) in _local.items() if w != window]:
                del _local[k]
        w, count = _local.get(key, (window, 0))
        count = count + 1 if w == window else 1
        _local[key] = (window, count)
    if count > limit:
        return max(int((window + 1) * window_seconds - now) + 1, 1)
    return None


def consume(key: str, limit: int, window_seconds: int = 3600) -> int | None:
    """Count one use of `key`. Returns None if it is within `limit`, else the seconds until the window resets."""
    try:
        count, ttl = cast(list[int], _redis().eval(_SCRIPT, 1, PREFIX + key, str(window_seconds)))
        if int(count) > limit:
            return max(int(ttl), 1)
        return None
    except redis.RedisError as exc:
        log.warning("quota_store_unavailable", extra={"error": type(exc).__name__})
        return _consume_local(key, limit, window_seconds, time.time())


def enforce(key: str, limit: int, what: str, window_seconds: int = 3600) -> None:
    """Raise 429 with a Retry-After once `key` is over its quota."""
    retry_after = consume(key, limit, window_seconds)
    if retry_after is not None:
        minutes = max(round(retry_after / 60), 1)
        raise AppError(
            429,
            f"Too many {what}. Try again in about {minutes} minute{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": str(retry_after)},
        )
