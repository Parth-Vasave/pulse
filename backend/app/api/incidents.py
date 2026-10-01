from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import AppError
from app.models import Incident, IncidentEvent, Monitor, User
from app.repositories import stats
from app.schemas.incident import IncidentDetail, IncidentEventOut, IncidentOut

router = APIRouter(tags=["incidents"])


def _out(incident: Incident, monitor_name: str) -> dict:
    end = incident.resolved_at or datetime.now(UTC)
    return {
        "id": incident.id,
        "monitor_id": incident.monitor_id,
        "monitor_name": monitor_name,
        "started_at": incident.started_at,
        "resolved_at": incident.resolved_at,
        "status": incident.status,
        "failure_count": incident.failure_count,
        "recovery_count": incident.recovery_count,
        "reason": incident.reason,
        "duration_seconds": max(0, int((end - incident.started_at).total_seconds())),
    }


@router.get("/api/incidents", response_model=list[IncidentOut])
def list_incidents(
    status: Literal["open", "resolved"] | None = None,
    monitor_id: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        select(Incident, Monitor.name)
        .join(Monitor, Monitor.id == Incident.monitor_id)
        .where(Monitor.user_id == user.id)
    )
    if status:
        q = q.where(Incident.status == status)
    if monitor_id:
        q = q.where(Incident.monitor_id == monitor_id)
    rows = db.execute(q.order_by(Incident.started_at.desc()).limit(limit)).all()
    return [_out(i, name) for i, name in rows]


@router.get("/api/incidents/{incident_id}", response_model=IncidentDetail)
def get_incident(incident_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.execute(
        select(Incident, Monitor.name)
        .join(Monitor, Monitor.id == Incident.monitor_id)
        .where(Incident.id == incident_id, Monitor.user_id == user.id)
    ).first()
    if row is None:
        raise AppError(404, "Incident not found")
    events = db.scalars(
        select(IncidentEvent)
        .where(IncidentEvent.incident_id == incident_id)
        .order_by(IncidentEvent.occurred_at, IncidentEvent.id)
    ).all()
    return {**_out(*row), "events": [IncidentEventOut.model_validate(e) for e in events]}


@router.get("/api/dashboard/summary", tags=["dashboard"])
def dashboard_summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    monitors = db.scalars(select(Monitor).where(Monitor.user_id == user.id)).all()
    statuses = [stats.display_status(m) for m in monitors]
    active = db.scalar(
        select(func.count())
        .select_from(Incident)
        .join(Monitor, Monitor.id == Incident.monitor_id)
        .where(Monitor.user_id == user.id, Incident.status == "open")
    )
    return {
        "total_monitors": len(monitors),
        "healthy_monitors": statuses.count("up"),
        "down_monitors": statuses.count("down"),
        "paused_monitors": statuses.count("paused"),
        "active_incidents": active or 0,
        "overall_uptime_24h": stats.overall_uptime_24h(db, user.id),
    }
