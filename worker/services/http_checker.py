"""Executes one HTTP check and classifies the result. Never raises for target misbehaviour."""

import socket
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.logging import get_logger
from app.services.assertions import MAX_BODY_BYTES, ResponseView, evaluate_all
from app.services.incident_service import CheckOutcome
from app.services.retry import CHECK_RETRY_BASE, CHECK_RETRY_CAP, retry_call
from app.services.safe_http import build_guarded_client
from app.services.ssrf import Resolver, SSRFError

log = get_logger("worker.checker")

# Error types recorded in check_results.error_type
TIMEOUT = "timeout"
DNS_FAILURE = "dns_failure"
CONNECT_FAILURE = "connect_failure"
INVALID_RESPONSE = "invalid_response"
UNEXPECTED_STATUS = "unexpected_status"
HTTP_ERROR = "http_error"
ASSERTION_FAILED = "assertion_failed"
SLOW_RESPONSE = "slow_response"
BLOCKED_TARGET = "blocked_target"

_RETRYABLE = (httpx.TimeoutException, httpx.ConnectError)


@dataclass(frozen=True)
class CheckSpec:
    url: str
    method: str = "GET"
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None
    expected_status_code: int = 200
    timeout_seconds: int = 10
    response_time_threshold_ms: int | None = None
    assertions: list[dict[str, Any]] = field(default_factory=list)
    retries: int = 0


def _truncate(message: str, limit: int = 300) -> str:
    return message if len(message) <= limit else message[: limit - 1] + "…"


def _classify_transport_error(exc: Exception) -> tuple[str, str]:
    cause: BaseException | None = exc
    while cause is not None:
        if isinstance(cause, socket.gaierror):
            return DNS_FAILURE, "DNS resolution failed"
        cause = cause.__cause__ or cause.__context__
    if isinstance(exc, httpx.TimeoutException):
        return TIMEOUT, f"Request timed out ({type(exc).__name__})"
    if isinstance(exc, httpx.ConnectError):
        return CONNECT_FAILURE, _truncate(f"Connection failed: {exc}")
    return INVALID_RESPONSE, _truncate(f"{type(exc).__name__}: {exc}")


def _once(spec: CheckSpec, resolver: Resolver | None) -> tuple[httpx.Response, int, str]:
    """One request. Returns (response, ttfb_ms, body_text). Body is read only if assertions need it.

    A fresh client per attempt, so each attempt gets the full `timeout_seconds` as its overall deadline.
    """
    started = time.monotonic()
    with (
        build_guarded_client(spec.timeout_seconds, resolver) as client,
        client.stream(
            spec.method, spec.url, headers=spec.headers, content=spec.body.encode() if spec.body else None
        ) as response,
    ):
        ttfb_ms = int((time.monotonic() - started) * 1000)
        text = ""
        if spec.assertions:
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size >= MAX_BODY_BYTES:
                    break
            text = b"".join(chunks)[:MAX_BODY_BYTES].decode(response.encoding or "utf-8", errors="replace")
        return response, ttfb_ms, text


def run_check(spec: CheckSpec, resolver: Resolver | None = None, sleep=time.sleep) -> CheckOutcome:  # type: ignore[no-untyped-def]
    started = time.monotonic()
    checked_at = datetime.now(UTC)

    def elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    def failure(kind: str, message: str, status: int | None = None, rt: int | None = None) -> CheckOutcome:
        return CheckOutcome(checked_at, False, status, rt, elapsed_ms(), kind, _truncate(message))

    try:
        response, rt_ms, body = retry_call(
            lambda: _once(spec, resolver),
            max_retries=spec.retries,
            retry_on=_RETRYABLE,
            sleep=sleep,
            base=CHECK_RETRY_BASE,
            cap=CHECK_RETRY_CAP,
        )
        status = response.status_code
        headers = dict(response.headers)
    except SSRFError as exc:
        return failure(BLOCKED_TARGET, f"Target blocked: {exc}")
    except httpx.HTTPError as exc:
        kind, message = _classify_transport_error(exc)
        return failure(kind, message)
    except OSError as exc:  # raw socket errors that httpx did not wrap
        kind, message = _classify_transport_error(exc)
        return failure(kind, message)

    if status != spec.expected_status_code:
        kind = HTTP_ERROR if status >= 400 else UNEXPECTED_STATUS
        return failure(kind, f"Expected HTTP {spec.expected_status_code}, got {status}", status, rt_ms)

    result = evaluate_all(spec.assertions, ResponseView(status, headers, body))
    if not result.passed:
        return failure(ASSERTION_FAILED, result.message, status, rt_ms)

    if spec.response_time_threshold_ms is not None and rt_ms > spec.response_time_threshold_ms:
        return failure(
            SLOW_RESPONSE, f"Response took {rt_ms}ms (threshold {spec.response_time_threshold_ms}ms)", status, rt_ms
        )

    return CheckOutcome(checked_at, True, status, rt_ms, elapsed_ms())
