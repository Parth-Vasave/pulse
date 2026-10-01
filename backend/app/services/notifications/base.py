from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Literal


@dataclass(frozen=True)
class IncidentMessage:
    kind: Literal["created", "resolved"]
    incident_id: int
    monitor_name: str
    monitor_url: str
    reason: str
    started_at: datetime
    resolved_at: datetime | None = None

    @property
    def downtime_seconds(self) -> int | None:
        if self.resolved_at is None:
            return None
        return max(0, int((self.resolved_at - self.started_at).total_seconds()))

    @property
    def subject(self) -> str:
        icon = "🚨 INCIDENT" if self.kind == "created" else "✅ RECOVERED"
        return f"{icon}: {self.monitor_name}"

    def body(self) -> str:
        if self.kind == "created":
            return (
                "🚨 API INCIDENT\n"
                f"Monitor: {self.monitor_name}\n"
                f"URL: {self.monitor_url}\n"
                f"Reason: {self.reason}\n"
                f"Started: {self.started_at:%H:%M} UTC"
            )
        return (
            f"✅ API RECOVERED\nMonitor: {self.monitor_name}\nDowntime: {format_duration(self.downtime_seconds or 0)}"
        )


def format_duration(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return " ".join(p for p in (f"{h}h" if h else "", f"{m}m" if m or h else "", f"{s}s") if p)


class NotificationError(Exception):
    """Delivery failed. `retryable` tells the dispatcher whether another attempt can help."""

    def __init__(self, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


class NotificationProvider(ABC):
    channel_type: str

    @abstractmethod
    def send(self, config: dict, message: IncidentMessage) -> None:
        """Deliver the message or raise NotificationError."""
