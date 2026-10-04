import pytest
from pydantic import ValidationError

from app.core.config import Settings


def make(**kw):
    return Settings(_env_file=None, **kw)


@pytest.mark.parametrize("url", ["ftp://x", "hc-ping.com/abc", "file:///etc/passwd"])
def test_heartbeat_url_must_be_http(url):
    with pytest.raises(ValidationError, match="http"):
        make(heartbeat_url=url)


def test_heartbeat_defaults_to_off_and_interval_has_a_floor():
    assert make().heartbeat_url == ""
    with pytest.raises(ValidationError):
        make(heartbeat_interval_seconds=1)
