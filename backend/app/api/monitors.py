from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_owned_monitor
from app.core.database import get_db
from app.models import CheckResult, Monitor, User
from app.repositories import stats
from app.schemas.monitor import CheckResultOut, MonitorCreate, MonitorOut, MonitorUpdate
from app.services import monitor_service

router = APIRouter(prefix="/api/monitors", tags=["monitors"])


@router.post("", response_model=MonitorOut, status_code=201)
def create(data: MonitorCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    monitor = monitor_service.create_monitor(db, user, data)
    return _out(monitor, None)


@router.get("", response_model=list[MonitorOut])
def list_monitors(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    monitors = db.scalars(select(Monitor).where(Monitor.user_id == user.id).order_by(Monitor.name)).all()
    uptime = stats.uptime_24h_by_monitor(db, list(monitors))
    return [_out(m, uptime.get(m.id)) for m in monitors]


@router.get("/heartbeats")
def heartbeats(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[int, list[bool]]:
    ids = list(db.scalars(select(Monitor.id).where(Monitor.user_id == user.id)))
    return stats.recent_outcomes(db, ids)


@router.get("/traces")
def traces(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[int, list[dict]]:
    """Recent checks per monitor as {ok, ms, at}, oldest first: what the dashboard plot draws.
    120 checks covers the plot's last hour even at the shortest (30s) interval."""
    ids = list(db.scalars(select(Monitor.id).where(Monitor.user_id == user.id)))
    return {
        mid: [{"ok": ok, "ms": ms, "at": at.isoformat()} for ok, ms, at in checks]
        for mid, checks in stats.recent_traces(db, ids, limit=120).items()
    }


@router.get("/{monitor_id}", response_model=MonitorOut)
def get_monitor(monitor: Monitor = Depends(get_owned_monitor), db: Session = Depends(get_db)):
    return _out(monitor, stats.uptime_windows(db, monitor)["24h"])


@router.patch("/{monitor_id}", response_model=MonitorOut)
def update(patch: MonitorUpdate, monitor: Monitor = Depends(get_owned_monitor), db: Session = Depends(get_db)):
    monitor = monitor_service.update_monitor(db, monitor, patch)
    return _out(monitor, stats.uptime_windows(db, monitor)["24h"])


@router.delete("/{monitor_id}", status_code=204)
def delete(monitor: Monitor = Depends(get_owned_monitor), db: Session = Depends(get_db)) -> None:
    monitor_service.delete_monitor(db, monitor)


@router.get("/{monitor_id}/checks", response_model=list[CheckResultOut])
def recent_checks(
    limit: int = Query(50, ge=1, le=200),
    failures_only: bool = False,
    monitor: Monitor = Depends(get_owned_monitor),
    db: Session = Depends(get_db),
):
    q = select(CheckResult).where(CheckResult.monitor_id == monitor.id)
    if failures_only:
        q = q.where(CheckResult.success.is_(False))
    return db.scalars(q.order_by(CheckResult.checked_at.desc(), CheckResult.id.desc()).limit(limit)).all()


@router.get("/{monitor_id}/stats")
def monitor_stats(
    range: str = Query("24h", pattern="^(1h|24h|7d|30d)$"),
    monitor: Monitor = Depends(get_owned_monitor),
    db: Session = Depends(get_db),
):
    window = stats.RANGES[range][0]
    summary = stats.summary(db, monitor, window)
    return {
        "range": range,
        "summary": summary,
        "uptime": stats.uptime_windows(db, monitor),
        "series": stats.series(db, monitor, range),
    }


def _out(monitor: Monitor, uptime_24h: float | None) -> MonitorOut:
    out = MonitorOut.model_validate(monitor)
    out.uptime_24h = uptime_24h
    out.display_status = stats.display_status(monitor)  # type: ignore[assignment]
    return out
