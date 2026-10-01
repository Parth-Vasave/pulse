import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG = "x7Qm2Vb9Lk4Rt8Yw1Zc5Nd3Hf6Jg0Ps-aBcDeFgHiJkLmNoPq"


def make(**kw):
    return Settings(_env_file=None, **kw)


def test_placeholder_secret_is_allowed_in_development_and_test():
    assert make(environment="development")
    assert make(environment="test")


@pytest.mark.parametrize("env", ["production", "staging", "Production"])
def test_placeholder_secret_is_refused_outside_development(env):
    with pytest.raises(ValidationError, match="SECRET_KEY is a placeholder"):
        make(environment=env)


@pytest.mark.parametrize("weak", ["change-me-dev-only-not-a-secret-change-me-please", "please-changeme-" + "a" * 20])
def test_the_shipped_example_secret_is_refused_in_production(weak):
    with pytest.raises(ValidationError):
        make(environment="production", secret_key=weak)


def test_strong_secret_is_accepted_in_production():
    assert make(environment="production", secret_key=STRONG).secret_key == STRONG


def test_short_secret_is_still_rejected_everywhere():
    with pytest.raises(ValidationError):
        make(environment="development", secret_key="short")
