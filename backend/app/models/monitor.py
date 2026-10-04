from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedJSON
from app.core.database import Base
from app.models._common import created_col, updated_col


class Monitor(Base):
    __tablename__ = "monitors"
    __table_args__ = (
        # The scheduler's hot query: enabled monitors whose next_check_at has passed.
        Index("ix_monitors_due", "next_check_at", postgresql_where="enabled"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(2048))
    method: Mapped[str] = mapped_column(String(8), default="GET")
    headers: Mapped[dict[str, str]] = mapped_column(EncryptedJSON, default=dict)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_status_code: Mapped[int] = mapped_column(Integer, default=200)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=10)
    interval_seconds: Mapped[int] = mapped_column(Integer, default=60)
    response_time_threshold_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failure_threshold: Mapped[int] = mapped_column(Integer, default=3)
    recovery_threshold: Mapped[int] = mapped_column(Integer, default=2)
    # Extra immediate attempts on transport errors (timeout/DNS/connect). 0 = never retry.
    check_retries: Mapped[int] = mapped_column(Integer, default=0)
    assertions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    show_on_status_page: Mapped[bool] = mapped_column(Boolean, default=False)

    # Health state, owned by the incident engine.
    status: Mapped[str] = mapped_column(String(16), default="unknown")  # unknown | up | down
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_successes: Mapped[int] = mapped_column(Integer, default=0)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()
