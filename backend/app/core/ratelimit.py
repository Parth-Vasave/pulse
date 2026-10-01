"""Redis fixed-window rate limiter. Fails open: an outage of the limiter must not
take the API down (the failure is logged)."""

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
_AUTH_PATHS = ("/api/auth/login", "/api/auth/register")

_client: aioredis.Redis | None = None


def _redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(get_settings().redis_url, socket_timeout=0.5, socket_connect_timeout=0.5)
    return _client


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def check_limit(key: str, limit: int) -> tuple[bool, int]:
    """Return (allowed, retry_after_seconds)."""
    try:
        r = _redis()
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, WINDOW_SECONDS)
        if count > limit:
            ttl = await r.ttl(key)
            return False, max(ttl, 1)
    except Exception as exc:  # noqa: BLE001 - limiter must never break requests
        log.warning("rate_limiter_unavailable", extra={"error": type(exc).__name__})
    return True, 0


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
