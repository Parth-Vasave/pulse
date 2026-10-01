import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$")


class ChannelCreate(BaseModel):
    type: Literal["email", "webhook", "discord"]
    name: str = Field(min_length=1, max_length=120)
    address: EmailStr | None = None
    url: str | None = Field(default=None, max_length=2048)
    enabled: bool = True

    @model_validator(mode="after")
    def required_fields(self) -> "ChannelCreate":
        if self.type == "email" and not self.address:
            raise ValueError("address is required for email channels")
        if self.type in ("webhook", "discord") and not (self.url and self.url.startswith(("http://", "https://"))):
            raise ValueError("a valid http(s) url is required")
        return self


class ChannelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None


class ChannelOut(BaseModel):
    id: int
    type: str
    name: str
    enabled: bool
    target: str  # masked: secrets in webhook URLs are never echoed back
    created_at: datetime


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiKeyCreated(ApiKeyOut):
    key: str  # shown exactly once


class StatusPageSettings(BaseModel):
    enabled: bool
    slug: str | None = None

    @model_validator(mode="after")
    def valid_slug(self) -> "StatusPageSettings":
        if self.slug is not None and not SLUG_RE.match(self.slug):
            raise ValueError("slug must be 3-64 chars: lowercase letters, digits, hyphens")
        if self.enabled and not self.slug:
            raise ValueError("slug is required to enable the status page")
        return self


class MetricsRange(BaseModel):
    range: Literal["1h", "24h", "7d", "30d"] = "24h"


Json = dict[str, Any]
