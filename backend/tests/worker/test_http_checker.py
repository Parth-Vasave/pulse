import pytest

from worker.services import http_checker as hc
from worker.services.http_checker import CheckSpec, run_check


def spec(target, path="/", **kw):
    return CheckSpec(url=f"{target.base}{path}", timeout_seconds=kw.pop("timeout_seconds", 3), **kw)


def test_success(target):
    out = run_check(spec(target))
    assert out.success and out.status_code == 200 and out.error_type is None
    assert out.response_time_ms is not None and out.check_duration_ms >= out.response_time_ms


def test_http_error_500(target):
    target.healthy = False
    out = run_check(spec(target))
    assert not out.success and out.error_type == hc.HTTP_ERROR and out.status_code == 500


def test_unexpected_status_when_expecting_other(target):
    out = run_check(spec(target, expected_status_code=201))
    assert out.error_type == hc.UNEXPECTED_STATUS


def test_expected_error_status_is_success(target):
    target.healthy = False
    assert run_check(spec(target, expected_status_code=500)).success


def test_timeout_is_bounded_and_classified(target):
    out = run_check(spec(target, "/slow", timeout_seconds=1))
    assert out.error_type == hc.TIMEOUT and out.check_duration_ms < 1900


@pytest.mark.parametrize("path", ["/drip", "/drip-body"])
def test_timeout_bounds_the_whole_request_not_each_read(target, path):
    # A server trickling bytes never trips a per-read timeout; the overall deadline still ends the check.
    # Assertions make the checker read the body, so /drip-body is cut off mid-body.
    out = run_check(spec(target, path, timeout_seconds=1, assertions=[{"type": "body_contains", "value": "x"}]))
    assert out.error_type == hc.TIMEOUT and out.check_duration_ms < 1900


def test_each_retry_gets_its_own_full_timeout(target):
    sleeps = []
    out = run_check(spec(target, "/drip", timeout_seconds=1, retries=1), sleep=sleeps.append)
    assert out.error_type == hc.TIMEOUT and sleeps == [1] and 1900 < out.check_duration_ms < 3900


def test_loopback_literal_is_blocked():
    out = run_check(CheckSpec(url="http://127.0.0.1:9/", timeout_seconds=2))
    assert out.error_type == hc.BLOCKED_TARGET


def test_connect_failure_to_allowed_target(target, monkeypatch):
    target.close()
    out = run_check(spec(target, timeout_seconds=2))
    assert out.error_type == hc.CONNECT_FAILURE


def test_dns_failure(fake_dns):
    fake_dns["nope.test"] = "NXDOMAIN"
    out = run_check(CheckSpec(url="http://nope.test/", timeout_seconds=2))
    assert out.error_type == hc.DNS_FAILURE


def test_ssrf_blocked_at_connect_time(fake_dns):
    # DNS rebinding scenario: hostname passed creation-time checks, but now resolves to metadata IP.
    fake_dns["rebind.test"] = ["169.254.169.254"]
    out = run_check(CheckSpec(url="http://rebind.test/latest/meta-data", timeout_seconds=2))
    assert out.error_type == hc.BLOCKED_TARGET and out.status_code is None


def test_redirects_not_followed(target):
    out = run_check(spec(target, "/redirect"))
    assert out.status_code == 302 and out.error_type == hc.UNEXPECTED_STATUS
    assert not any(p == "/internal" for _, p, _ in target.requests)


def test_json_assertion_pass_and_fail(target):
    ok = [{"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"}]
    assert run_check(spec(target, assertions=ok)).success
    target.healthy = True
    bad = [{"type": "json_field", "path": "status", "operator": "eq", "value": "degraded"}]
    out = run_check(spec(target, assertions=bad))
    assert out.error_type == hc.ASSERTION_FAILED and "degraded" in out.error_message


def test_response_time_threshold(target):
    out = run_check(spec(target, "/slow", timeout_seconds=5, response_time_threshold_ms=500))
    assert out.error_type == hc.SLOW_RESPONSE and out.status_code == 200


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_methods_and_body_sent(target, method):
    out = run_check(spec(target, method=method, body='{"a": 1}', headers={"Content-Type": "application/json"}))
    assert out.success
    assert target.requests[-1][0] == method and target.requests[-1][2] == b'{"a": 1}'


def test_retries_only_on_transport_errors(target, monkeypatch):
    sleeps = []
    t0 = len(target.requests)
    target.healthy = False
    out = run_check(spec(target, retries=2), sleep=sleeps.append)
    assert out.error_type == hc.HTTP_ERROR and len(target.requests) - t0 == 1 and sleeps == []


def test_retry_on_connect_error_uses_backoff(target):
    target.close()
    sleeps = []
    out = run_check(spec(target, retries=2, timeout_seconds=1), sleep=sleeps.append)
    assert out.error_type == hc.CONNECT_FAILURE and sleeps == [1, 2]
