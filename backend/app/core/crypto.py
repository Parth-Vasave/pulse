"""Encryption at rest for secrets that live in Postgres.

Monitor request headers (often bearer tokens) and notification channel configuration (webhook URLs carry secrets in
their path) are stored as a Fernet token (AES-128-CBC + HMAC-SHA256) wrapped in a small JSON envelope, so the columns
stay JSONB and need no schema change. A database dump, backup or read-only SQL access no longer reveals them; the
`ENCRYPTION_KEY` lives only in the application environment.

Keys are rotated by putting the new key first in `ENCRYPTION_KEY` (comma-separated) and running
`python -m app.rotate_keys`; once it finishes, the old key can be dropped.
"""

import base64
import hashlib
import json
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import TypeDecorator

from app.core.config import get_settings

ENVELOPE_KEY = "__pulse_enc_v1__"


class DecryptionError(RuntimeError):
    """The stored value was not encrypted with any configured key (wrong or lost ENCRYPTION_KEY)."""


def _dev_key(secret_key: str) -> str:
    """Development convenience only: derive a key from SECRET_KEY so a fresh checkout works with no setup."""
    return base64.urlsafe_b64encode(
        hashlib.sha256(b"pulse-dev-encryption-key:" + secret_key.encode()).digest()
    ).decode()


@lru_cache
def _fernet_for(keys: tuple[str, ...]) -> MultiFernet:
    return MultiFernet([Fernet(k) for k in keys])


def _fernet() -> MultiFernet:
    settings = get_settings()
    return _fernet_for(tuple(settings.encryption_key_list) or (_dev_key(settings.secret_key),))


def encrypt_json(value: Any) -> str:
    return _fernet().encrypt(json.dumps(value, separators=(",", ":")).encode()).decode()


def decrypt_json(token: str) -> Any:
    try:
        return json.loads(_fernet().decrypt(token.encode()))
    except InvalidToken as exc:
        raise DecryptionError(
            "Cannot decrypt a stored secret: ENCRYPTION_KEY does not match the key it was encrypted with"
        ) from exc


def rotate_token(token: str) -> str:
    """Re-encrypt a token under the primary key (the first one configured)."""
    try:
        return _fernet().rotate(token.encode()).decode()
    except InvalidToken as exc:
        raise DecryptionError("Cannot rotate a stored secret: no configured ENCRYPTION_KEY decrypts it") from exc


def is_envelope(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {ENVELOPE_KEY}


class EncryptedJSON(TypeDecorator[Any]):
    """JSONB column whose non-empty contents are encrypted transparently.

    Empty values stay as-is (nothing to protect). On read, a value that is not an envelope is returned unchanged, so a
    row written before encryption was enabled still loads; migration 0003 encrypts all such rows.
    """

    impl = JSONB
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if not value:
            return value
        return {ENVELOPE_KEY: encrypt_json(value)}

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        if is_envelope(value):
            return decrypt_json(value[ENVELOPE_KEY])
        return value
