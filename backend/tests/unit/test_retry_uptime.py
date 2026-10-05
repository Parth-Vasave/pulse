import pytest

from app.services.retry import backoff_delay, max_check_seconds, retry_call
from app.services.uptime import uptime_percentage


def test_backoff_sequence_and_cap():
    assert [backoff_delay(i) for i in range(4)] == [1, 2, 4, 8]
    assert backoff_delay(20, cap=60) == 60


def test_max_check_seconds_counts_every_attempt_and_the_backoff_between():
    assert max_check_seconds(30, 0) == 30
    assert max_check_seconds(10, 2) == 10 * 3 + 1 + 2
    assert max_check_seconds(30, 3) == 30 * 4 + 1 + 2 + 4


def test_retry_succeeds_after_transient_failures():
    calls, sleeps = [], []

    def fn():
        calls.append(1)
        if len(calls) < 3:
            raise ConnectionError
        return "ok"

    assert retry_call(fn, max_retries=3, retry_on=(ConnectionError,), sleep=sleeps.append) == "ok"
    assert sleeps == [1, 2]


def test_retry_gives_up_after_max():
    sleeps = []
    with pytest.raises(ConnectionError):
        retry_call(
            lambda: (_ for _ in ()).throw(ConnectionError()),
            max_retries=2,
            retry_on=(ConnectionError,),
            sleep=sleeps.append,
        )
    assert sleeps == [1, 2]


def test_retry_does_not_retry_other_exceptions():
    calls = []

    def fn():
        calls.append(1)
        raise ValueError

    with pytest.raises(ValueError):
        retry_call(fn, max_retries=5, retry_on=(ConnectionError,), sleep=lambda s: None)
    assert len(calls) == 1


def test_uptime():
    assert uptime_percentage(99, 100) == 99.0
    assert uptime_percentage(1, 3) == 33.333
    assert uptime_percentage(0, 0) is None
    assert uptime_percentage(0, 5) == 0.0
