import json

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from app.core import crypto
from app.core.config import Settings, get_settings
from app.core.crypto import ENVELOPE_KEY, DecryptionError, EncryptedJSON

STRONG = "x7Qm2Vb9Lk4Rt8Yw1Zc5Nd3Hf6Jg0Ps-aBcDeFgHiJkLmNoPq"
SECRET = {"Authorization": "Bearer super-secret-token", "X-Api-Key": "abc123"}


@pytest.fixture
def keys(monkeypatch):
    """Switch the configured ENCRYPTION_KEY(s) for one test."""

    def use(*ks: str) -> None:
        monkeypatch.setattr(get_settings(), "encryption_key", ",".join(ks))

    return use


def column():
    return EncryptedJSON()


def bind(value):
    return column().process_bind_param(value, postgresql.dialect())


def load(value):
    return column().process_result_value(value, postgresql.dialect())


def test_round_trip_and_nothing_readable_is_stored():
    stored = bind(SECRET)
    assert set(stored) == {ENVELOPE_KEY}
    blob = json.dumps(stored)
    assert "super-secret-token" not in blob and "Authorization" not in blob
    assert load(stored) == SECRET


def test_every_write_uses_a_fresh_nonce():
    assert bind(SECRET) != bind(SECRET)


@pytest.mark.parametrize("empty", [{}, [], None])
def test_empty_values_are_left_alone(empty):
    assert bind(empty) == empty and load(empty) == empty


def test_a_row_written_before_encryption_still_loads():
    assert load({"Authorization": "Bearer legacy"}) == {"Authorization": "Bearer legacy"}


def test_wrong_key_fails_loudly_instead_of_returning_garbage(keys):
    keys(Fernet.generate_key().decode())
    stored = bind(SECRET)
    keys(Fernet.generate_key().decode())
    with pytest.raises(DecryptionError, match="ENCRYPTION_KEY"):
        load(stored)


def test_tampered_ciphertext_is_rejected(keys):
    keys(Fernet.generate_key().decode())
    token = bind(SECRET)[ENVELOPE_KEY]
    forged = {ENVELOPE_KEY: token[:-4] + ("AAAA" if token[-4:] != "AAAA" else "BBBB")}
    with pytest.raises(DecryptionError):
        load(forged)


def test_rotation_moves_data_to_the_new_key_and_old_key_can_then_be_dropped(keys):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    keys(old)
    token = bind(SECRET)[ENVELOPE_KEY]
    keys(new, old)  # new encrypts, both decrypt
    assert load({ENVELOPE_KEY: token}) == SECRET
    rotated = crypto.rotate_token(token)
    keys(new)  # old key dropped
    assert load({ENVELOPE_KEY: rotated}) == SECRET
    with pytest.raises(DecryptionError):
        load({ENVELOPE_KEY: token})


def test_rotating_a_token_no_key_can_read_is_an_error(keys):
    keys(Fernet.generate_key().decode())
    token = bind(SECRET)[ENVELOPE_KEY]
    keys(Fernet.generate_key().decode())
    with pytest.raises(DecryptionError):
        crypto.rotate_token(token)


# --- settings -------------------------------------------------------------------------------------------------


def make(**kw):
    return Settings(_env_file=None, **kw)


def test_encryption_key_is_optional_in_development_and_test():
    assert make(environment="development").encryption_key_list == []
    assert make(environment="test")


@pytest.mark.parametrize("env", ["production", "staging"])
def test_encryption_key_is_required_outside_development(env):
    with pytest.raises(ValidationError, match="ENCRYPTION_KEY is required"):
        make(environment=env, secret_key=STRONG)


def test_malformed_encryption_key_is_refused_at_startup():
    with pytest.raises(ValidationError, match="Fernet"):
        make(environment="production", secret_key=STRONG, encryption_key="not-a-fernet-key")
    with pytest.raises(ValidationError, match="Fernet"):
        make(environment="development", encryption_key=f"{Fernet.generate_key().decode()},oops")


def test_comma_separated_keys_are_accepted_for_rotation():
    a, b = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    s = make(environment="production", secret_key=STRONG, encryption_key=f" {a} , {b} ")
    assert s.encryption_key_list == [a, b]
