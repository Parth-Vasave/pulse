import pytest

from app.services import ssrf
from app.services.ssrf import SSRFError, is_blocked_ip, validate_url


def fake_resolver(mapping):
    return lambda host, port: mapping[host]


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",
        "100.64.0.1",
        "::1",
        "fe80::1",
        "fd00:ec2::254",
        "::ffff:127.0.0.1",
        "224.0.0.1",
    ],
)
def test_blocked_ips(ip):
    assert is_blocked_ip(ip)


@pytest.mark.parametrize("ip", ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])
def test_public_ips_allowed(ip):
    assert not is_blocked_ip(ip)


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/x",
        "http://127.0.0.1:8080",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data",
        "http://metadata.google.internal/",
        "http://foo.localhost/",
        "http://10.1.2.3/",
        "http://0x7f000001/",
    ],
)
def test_blocked_urls(url):
    with pytest.raises(SSRFError):
        validate_url(url, resolver=fake_resolver({"0x7f000001": ["127.0.0.1"]}))


@pytest.mark.parametrize("url", ["ftp://example.com", "file:///etc/passwd", "gopher://x", "http://user:pw@example.com"])
def test_bad_scheme_or_credentials(url):
    with pytest.raises(SSRFError):
        validate_url(url, resolver=fake_resolver({"example.com": ["93.184.216.34"]}))


def test_public_host_ok():
    assert validate_url("https://example.com/h", resolver=fake_resolver({"example.com": ["93.184.216.34"]}))


def test_dns_pointing_to_private_is_blocked():
    with pytest.raises(SSRFError):
        validate_url("http://evil.test/", resolver=fake_resolver({"evil.test": ["10.0.0.9"]}))


def test_any_bad_address_in_multi_record_blocks():
    with pytest.raises(SSRFError):
        validate_url("http://mixed.test/", resolver=fake_resolver({"mixed.test": ["93.184.216.34", "127.0.0.1"]}))


def test_allowlisted_host_bypasses(monkeypatch):
    monkeypatch.setenv("SSRF_ALLOWED_HOSTS", "demo-service")
    from app.core.config import get_settings

    get_settings.cache_clear()
    try:
        assert validate_url(
            "http://demo-service:9000/healthy", resolver=fake_resolver({"demo-service": ["172.18.0.5"]})
        )
    finally:
        monkeypatch.delenv("SSRF_ALLOWED_HOSTS")
        get_settings.cache_clear()


def test_unresolvable_host_is_accepted_at_creation():
    import socket

    def boom(host, port):
        raise socket.gaierror("nope")

    assert validate_url("http://not-yet-dns.example/", resolver=boom)
    assert {"http", "https"} == ssrf.ALLOWED_SCHEMES
