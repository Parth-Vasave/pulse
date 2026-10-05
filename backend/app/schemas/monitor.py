from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.retry import max_check_seconds

HttpMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
_FORBIDDEN_HEADERS = {"host", "content-length", "transfer-encoding", "connection"}


class BodyContains(BaseModel):
    type: Literal["body_contains"]
    value: str = Field(min_length=1, max_length=500)


class BodyNotContains(BaseModel):
    type: Literal["body_not_contains"]
    value: str = Field(min_length=1, max_length=500)


class JsonField(BaseModel):
    type: Literal["json_field"]
    path: str = Field(min_length=1, max_length=200)
    operator: Literal["eq", "ne", "contains", "exists"] = "eq"
    value: str | int | float | bool | None = None

    @model_validator(mode="after")
    def value_required(self) -> "JsonField":
        if self.operator != "exists" and self.value is None:
            raise ValueError("value is required unless operator is 'exists'")
        return self


Assertion = Annotated[BodyContains | BodyNotContains | JsonField, Field(discriminator="type")]


class MonitorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(max_length=2048)
    method: HttpMethod = "GET"
    headers: dict[str, str] = Field(default_factory=dict)
    body: str | None = Field(default=None, max_length=65536)
    expected_status_code: int = Field(default=200, ge=100, le=599)
    timeout_seconds: int = Field(default=10, ge=1, le=30)
    interval_seconds: int = Field(default=60, ge=30, le=86400)
    response_time_threshold_ms: int | None = Field(default=None, ge=1, le=60000)
    failure_threshold: int = Field(default=3, ge=1, le=10)
    recovery_threshold: int = Field(default=2, ge=1, le=10)
    check_retries: int = Field(default=0, ge=0, le=3)
    assertions: list[Assertion] = Field(default_factory=list, max_length=10)
    enabled: bool = True
    show_on_status_page: bool = False

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("url")
    @classmethod
    def basic_url(cls, v: str) -> str:
        parts = urlsplit(v.strip())
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError("url must be a valid http(s) URL")
        return v.strip()

    @field_validator("headers")
    @classmethod
    def check_headers(cls, v: dict[str, str]) -> dict[str, str]:
        if len(v) > 20:
            raise ValueError("at most 20 headers")
        for k, val in v.items():
            if not k or len(k) > 100 or len(val) > 2000 or any(c in k + val for c in "\r\n"):
                raise ValueError(f"invalid header {k!r}")
            if k.lower() in _FORBIDDEN_HEADERS:
                raise ValueError(f"header {k!r} cannot be set")
        return v

    @model_validator(mode="after")
    def body_vs_method(self) -> "MonitorCreate":
        if self.body and self.method == "GET":
            raise ValueError("GET requests cannot have a body")
        return self

    @model_validator(mode="after")
    def check_fits_interval(self) -> "MonitorCreate":
        # A check that can outlast its interval overlaps the next one against the same target.
        worst = max_check_seconds(self.timeout_seconds, self.check_retries)
        if worst > self.interval_seconds:
            raise ValueError(
                f"timeout and retries allow a check to take up to {worst:g}s, longer than the "
                f"{self.interval_seconds}s interval; lower the timeout or retries, or check less often"
            )
        return self


class MonitorUpdate(BaseModel):
    """PATCH semantics: only provided fields change; the merged result is re-validated."""

    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    url: str | None = None
    method: HttpMethod | None = None
    headers: dict[str, str] | None = None
    body: str | None = None
    expected_status_code: int | None = None
    timeout_seconds: int | None = None
    interval_seconds: int | None = None
    response_time_threshold_ms: int | None = None
    failure_threshold: int | None = None
    recovery_threshold: int | None = None
    check_retries: int | None = None
    assertions: list[dict[str, Any]] | None = None
    enabled: bool | None = None
    show_on_status_page: bool | None = None


class MonitorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    url: str
    method: str
    headers: dict[str, str]
    body: str | None
    expected_status_code: int
    timeout_seconds: int
    interval_seconds: int
    response_time_threshold_ms: int | None
    failure_threshold: int
    recovery_threshold: int
    check_retries: int
    assertions: list[dict[str, Any]]
    enabled: bool
    show_on_status_page: bool
    status: str
    last_checked_at: datetime | None
    last_response_time_ms: int | None
    created_at: datetime
    updated_at: datetime
    # Added by the list endpoint
    uptime_24h: float | None = None
    display_status: Literal["up", "down", "paused", "unknown"] = "unknown"


class CheckResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    checked_at: datetime
    success: bool
    status_code: int | None
    response_time_ms: int | None
    check_duration_ms: int | None
    error_type: str | None
    error_message: str | None
