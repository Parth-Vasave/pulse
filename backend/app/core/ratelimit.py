"""Redis sliding-window-counter rate limiter.

The count is atomic (one Lua script, so a crash can't leave a key without a TTL) and weights the
previous window by how much of it still overlaps the last 60 s, which removes the 2x burst a plain
fixed window allows at a boundary. If Redis is unavailable we fall back to a per-process limiter
instead of failing open, so brute-force protection on login survives a Redis outage.
"""

import math
import time

import redis.asyncio as aioredis
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings
from app.core.errors import error_response
from app.core.logging import get_logger

log = get_logger("app.ratelimit")
WINDOW_SECONDS = 60
_EXEMPT = ("/health", "/ready", "/metrics")
# Endpoints that verify a password get the strict bucket (brute-force protection, also for stolen sessions).
_AUTH_PATHS = (
    "/api/auth/login",
    "/api/auth/register",
    "/api/account/email",
    "/api/account/password",
    "/api/account/delete",
)

# KEYS: current window counter, previous window counter. ARGV: window seconds, elapsed fraction of the window.
# INCR and EXPIRE run atomically; returns the weighted estimate of requests in the trailing window.
_SCRIPT = """
local cur = redis.call('INCR', KEYS[1])
if cur == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]) * 2) end
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')
return math.floor(prev * (1 - tonumber(ARGV[2])) + cur)
"""

_client: aioredis.Redis | None = None
_local: dict[str, tuple[int, int]] = {}  # fallback: key -> (window index, count)


def _redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(get_settings().redis_url, socket_timeout=0.5, socket_connect_timeout=0.5)
    return _client


def client_ip(request: Request) -> str:
    """Peer address, or with TRUST_PROXY_HEADERS the address our own proxy saw.

    Each trusted proxy appends the address it received the request from, so the client is the Nth entry
    from the RIGHT (N = TRUSTED_PROXY_COUNT). Entries further left are client-supplied and spoofable.
    """
    s = get_settings()
    if s.trust_proxy_headers:
        hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        if len(hops) >= s.trusted_proxy_count:
            return hops[-s.trusted_proxy_count]
    return request.client.host if request.client else "unknown"


def _check_local(key: str, limit: int, now: float) -> tuple[bool, int]:
    window = int(now // WINDOW_SECONDS)
    if len(_local) > 10_000:
        for k in [k for k, (w, _) in _local.items() if w != window]:
            del _local[k]
    w, count = _local.get(key, (window, 0))
    count = count + 1 if w == window else 1
    _local[key] = (window, count)
    if count > limit:
        return False, max(math.ceil((window + 1) * WINDOW_SECONDS - now), 1)
    return True, 0


async def check_limit(key: str, limit: int) -> tuple[bool, int]:
    """Return (allowed, retry_after_seconds)."""
    now = time.time()
    window, elapsed = divmod(now, WINDOW_SECONDS)
    retry_after = max(math.ceil(WINDOW_SECONDS - elapsed), 1)
    try:
        estimate = await _redis().eval(  # type: ignore[misc]
            _SCRIPT,
            2,
            f"{key}:{int(window)}",
            f"{key}:{int(window) - 1}",
            str(WINDOW_SECONDS),
            str(elapsed / WINDOW_SECONDS),
        )
        return (False, retry_after) if int(estimate) > limit else (True, 0)
    except Exception as exc:  # noqa: BLE001 - limiter must never break requests
        log.warning("rate_limiter_unavailable", extra={"error": type(exc).__name__})
        return _check_local(key, limit, now)


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"].startswith(_EXEMPT):
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        s = get_settings()
        is_auth = scope["path"] in _AUTH_PATHS and scope["method"] == "POST"
        limit = s.auth_rate_limit_per_minute if is_auth else s.rate_limit_per_minute
        bucket = "auth" if is_auth else "api"
        allowed, retry_after = await check_limit(f"rl:{bucket}:{client_ip(request)}", limit)
        if not allowed:
            response: Response = error_response(
                429, "rate_limited", "Too many requests", headers={"Retry-After": str(retry_after)}
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
