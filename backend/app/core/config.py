from functools import lru_cache

from cryptography.fernet import Fernet
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Values that ship in this (public) repository. Anyone can read them, so they must never sign real tokens.
_INSECURE_SECRET_MARKERS = ("dev-only", "change-me", "changeme", "not-a-secret")
_DEV_ENVIRONMENTS = ("development", "test")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://monitor:monitor_dev_password@localhost:5432/monitor"
    redis_url: str = "redis://localhost:6379/0"

    secret_key: str = Field(default="dev-only-insecure-secret-key-change-me-0000", min_length=32)
    access_token_minutes: int = 720
    cookie_secure: bool = False
    cookie_name: str = "access_token"

    # Encrypts secrets stored in Postgres (monitor headers, notification channel config). One Fernet key, or several
    # comma-separated for rotation: the first encrypts, all of them decrypt. Required outside development.
    encryption_key: str = ""

    cors_origins: str = "http://localhost:3000"
    frontend_url: str = "http://localhost:3000"
    max_request_bytes: int = 256 * 1024
    max_monitors_per_user: int = 50
    max_channels_per_user: int = 10
    max_api_keys_per_user: int = 10

    # Hostnames exempt from private-IP blocking (dev demo service only).
    ssrf_allowed_hosts: str = ""

    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "alerts@apimonitor.local"
    smtp_starttls: bool = False

    # Only enable behind a trusted reverse proxy that sets X-Forwarded-For.
    trust_proxy_headers: bool = False
    # Number of trusted proxies in front of the API; the client IP is that many entries from the right of X-Forwarded-For.
    trusted_proxy_count: int = 1
    rate_limit_per_minute: int = 120
    auth_rate_limit_per_minute: int = 10

    # Result retention
    check_retention_days: int = 35

    # Dead-man's switch: if set, the scheduler GETs this URL about once per interval, but only after a tick that
    # succeeded. An external service (Healthchecks.io, Cronitor, ...) alerts when the pings stop.
    heartbeat_url: str = ""
    heartbeat_interval_seconds: int = Field(default=60, ge=10)

    @model_validator(mode="after")
    def _refuse_insecure_secret_outside_dev(self) -> "Settings":
        """Fail fast: with a publicly known SECRET_KEY anyone could forge login tokens."""
        insecure = any(marker in self.secret_key.lower() for marker in _INSECURE_SECRET_MARKERS)
        if insecure and self.environment.lower() not in _DEV_ENVIRONMENTS:
            raise ValueError(
                "SECRET_KEY is a placeholder. Set a strong random value, e.g. "
                "python -c 'import secrets; print(secrets.token_urlsafe(48))'"
            )
        return self

    @model_validator(mode="after")
    def _require_valid_encryption_key(self) -> "Settings":
        """Fail fast: stored secrets are only as safe as the key, and a malformed key would fail on first write."""
        if not self.encryption_key_list:
            if self.environment.lower() not in _DEV_ENVIRONMENTS:
                raise ValueError(
                    "ENCRYPTION_KEY is required outside development. Generate one with: "
                    "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
                )
            return self
        for key in self.encryption_key_list:
            try:
                Fernet(key)
            except ValueError as exc:
                raise ValueError(
                    "ENCRYPTION_KEY must be Fernet keys (32 url-safe base64 bytes), comma-separated"
                ) from exc
        return self

    @model_validator(mode="after")
    def _require_http_heartbeat_url(self) -> "Settings":
        if self.heartbeat_url and not self.heartbeat_url.lower().startswith(("http://", "https://")):
            raise ValueError("HEARTBEAT_URL must be an http(s) URL")
        return self

    @property
    def encryption_key_list(self) -> list[str]:
        return [k.strip() for k in self.encryption_key.split(",") if k.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ssrf_allowed_host_set(self) -> frozenset[str]:
        return frozenset(h.strip().lower() for h in self.ssrf_allowed_hosts.split(",") if h.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
