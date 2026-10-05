from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def backoff_delay(attempt: int, base: float = 1.0, cap: float = 60.0) -> float:
    """Exponential backoff: attempt 0 -> base, 1 -> 2*base, 2 -> 4*base ... capped."""
    return float(min(cap, base * (2**attempt)))


def retry_call(
    fn: Callable[[], T],
    *,
    max_retries: int,
    retry_on: tuple[type[BaseException], ...],
    sleep: Callable[[float], None],
    base: float = 1.0,
    cap: float = 60.0,
) -> T:
    """Call `fn`, retrying only the listed exception types, up to `max_retries` times."""
    attempt = 0
    while True:
        try:
            return fn()
        except retry_on:
            if attempt >= max_retries:
                raise
            sleep(backoff_delay(attempt, base, cap))
            attempt += 1


# Backoff between a monitor's immediate retries (check_retries): 1 s, 2 s, 4 s.
CHECK_RETRY_BASE = 1.0
CHECK_RETRY_CAP = 5.0


def max_check_seconds(timeout_seconds: float, retries: int) -> float:
    """Worst-case wall time of one check: every attempt runs to its timeout, plus the backoff between them."""
    backoff = sum(backoff_delay(i, CHECK_RETRY_BASE, CHECK_RETRY_CAP) for i in range(retries))
    return timeout_seconds * (retries + 1) + backoff
