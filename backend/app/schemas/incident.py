from datetime import datetime

from pydantic import BaseModel, ConfigDict


class IncidentEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    occurred_at: datetime
    event_type: str
    message: str


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    monitor_id: int
    monitor_name: str
    started_at: datetime
    resolved_at: datetime | None
    status: str
    failure_count: int
    recovery_count: int
    reason: str
    duration_seconds: int


class IncidentDetail(IncidentOut):
    events: list[IncidentEventOut]
