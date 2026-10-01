from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (
        Index("ix_incidents_status", "status"),
        Index("ix_incidents_monitor_started", "monitor_id", "started_at"),
        # Dedup guarantee at the DB level: at most one open incident per monitor.
        Index("uq_incidents_one_open_per_monitor", "monitor_id", unique=True, postgresql_where="status = 'open'"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    monitor_id: Mapped[int] = mapped_column(ForeignKey("monitors.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | resolved
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    recovery_count: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(Text)


class IncidentEvent(Base):
    """Append-only timeline entries for an incident."""

    __tablename__ = "incident_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # first_failure | failure | incident_created | notification_sent | notification_failed
    # | recovery_check | recovered | incident_resolved
    event_type: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(Text)
