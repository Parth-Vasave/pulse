from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError
from app.models import Incident, Monitor, User
from app.repositories import stats

router = APIRouter(prefix="/api/public", tags=["public"])


def _component_status(m: Monitor) -> str:
    if not m.enabled:
        return "paused"
    if m.status == "down":
        return "outage"
    if m.status == "up":
        slow = (
            m.response_time_threshold_ms
            and m.last_response_time_ms
            and m.last_response_time_ms > m.response_time_threshold_ms
        )
        return "degraded" if slow else "operational"
    return "unknown"


@router.get("/status/{slug}")
def public_status(slug: str, db: Session = Depends(get_db)):
    """Unauthenticated. Exposes only names, coarse status and incident times - never URLs,
    headers, bodies or failure reasons."""
    user = db.scalars(select(User).where(User.status_page_slug == slug, User.status_page_enabled.is_(True))).first()
    if user is None:
        raise AppError(404, "Status page not found")
    monitors = db.scalars(
        select(Monitor).where(Monitor.user_id == user.id, Monitor.show_on_status_page.is_(True)).order_by(Monitor.name)
    ).all()
    components = [
        {"name": m.name, "status": _component_status(m), "uptime_30d": stats.uptime_windows(db, m.id)["30d"]}
        for m in monitors
    ]
    since = datetime.now(UTC) - timedelta(days=14)
    incidents = (
        db.execute(
            select(Incident, Monitor.name)
            .join(Monitor, Monitor.id == Incident.monitor_id)
            .where(Monitor.id.in_([m.id for m in monitors]), Incident.started_at >= since)
            .order_by(Incident.started_at.desc())
            .limit(50)
        ).all()
        if monitors
        else []
    )
    statuses = {c["status"] for c in components}
    overall = "outage" if "outage" in statuses else "degraded" if "degraded" in statuses else "operational"
    return {
        "overall_status": overall if components else "unknown",
        "components": components,
        "incidents": [
            {"monitor": name, "status": i.status, "started_at": i.started_at, "resolved_at": i.resolved_at}
            for i, name in incidents
        ],
    }
