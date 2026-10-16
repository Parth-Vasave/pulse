from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import cache
from app.core.database import get_db
from app.core.errors import AppError
from app.models import Incident, Monitor, User
from app.repositories import stats

router = APIRouter(prefix="/api/public", tags=["public"])
# 30 days of time-weighted uptime scans every retained check of every listed monitor (~1.6 s of DB time
# for 20 monitors at a 30 s interval), and this endpoint is unauthenticated. One minute of lag moves a
# 30-day figure by at most 0.0023 points; component status and incidents stay live. When the figures
# expire, one request recomputes them while concurrent visitors keep getting the previous ones.
UPTIME_CACHE_SECONDS = 60


def _uptime_30d(db: Session, user_id: int, monitors: list[Monitor]) -> dict[int, float | None]:
    ids = [str(m.id) for m in monitors]  # JSON object keys are strings
    cached = cache.get_or_compute(
        f"status-uptime-30d:{user_id}",
        lambda: stats.uptime_30d_by_monitor(db, monitors),
        UPTIME_CACHE_SECONDS,
        usable=lambda v: all(i in v for i in ids),  # a newly listed monitor forces a recompute
    )
    return {m.id: cached[str(m.id)] for m in monitors}


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
    uptime = _uptime_30d(db, user.id, list(monitors))
    components = [{"name": m.name, "status": _component_status(m), "uptime_30d": uptime.get(m.id)} for m in monitors]
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
    # Worst status wins. "operational" needs at least one service actually up: a page whose services are
    # all paused or not checked yet (or that lists none) has nothing to vouch for.
    overall = next((s for s in ("outage", "degraded", "operational") if s in statuses), "unknown")
    return {
        "overall_status": overall,
        "components": components,
        "incidents": [
            {"monitor": name, "status": i.status, "started_at": i.started_at, "resolved_at": i.resolved_at}
            for i, name in incidents
        ],
    }
