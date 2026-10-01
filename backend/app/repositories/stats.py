"""Read-side aggregates over check_results.

Metric definitions (also documented in docs/ARCHITECTURE.md):
  * uptime %   = successful checks / total checks * 100 over the window; None if no checks.
                 Paused periods produce no checks and are therefore excluded, not counted as downtime.
  * latency    = avg / p50 / p95 / p99 (linear-interpolated percentile_cont) over checks that
                 received an HTTP response (response_time_ms IS NOT NULL). Timeouts/DNS failures
                 have no latency and are reflected in uptime/error-rate instead.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, literal_column, select
from sqlalchemy.orm import Session

from app.models import CheckResult, Monitor
from app.services.uptime import uptime_percentage

RANGES: dict[str, tuple[timedelta, int]] = {
    "1h": (timedelta(hours=1), 60),
    "24h": (timedelta(hours=24), 900),
    "7d": (timedelta(days=7), 3600),
    "30d": (timedelta(days=30), 21600),
}


def _since(delta: timedelta) -> datetime:
    return datetime.now(UTC) - delta


@dataclass
class Summary:
    total_checks: int
    successful_checks: int
    uptime_percentage: float | None
    avg_response_time_ms: float | None
    p50_response_time_ms: float | None
    p95_response_time_ms: float | None
    p99_response_time_ms: float | None


def _round(v: float | None) -> float | None:
    return None if v is None else round(float(v), 1)


def summary(db: Session, monitor_id: int, window: timedelta) -> Summary:
    rt = CheckResult.response_time_ms
    row = db.execute(
        select(
            func.count(),
            func.count().filter(CheckResult.success.is_(True)),
            func.avg(rt),
            func.percentile_cont(0.5).within_group(rt),
            func.percentile_cont(0.95).within_group(rt),
            func.percentile_cont(0.99).within_group(rt),
        ).where(CheckResult.monitor_id == monitor_id, CheckResult.checked_at >= _since(window))
    ).one()
    total, ok = row[0], row[1]
    return Summary(
        total, ok, uptime_percentage(ok, total), _round(row[2]), _round(row[3]), _round(row[4]), _round(row[5])
    )


def uptime_windows(db: Session, monitor_id: int) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    now = datetime.now(UTC)
    exprs = []
    for _label, days in (("24h", 1), ("7d", 7), ("30d", 30)):
        in_window = CheckResult.checked_at >= now - timedelta(days=days)
        exprs += [func.count().filter(in_window), func.count().filter(and_(in_window, CheckResult.success))]
    row = db.execute(select(*exprs).where(CheckResult.monitor_id == monitor_id)).one()
    for i, label in enumerate(("24h", "7d", "30d")):
        out[label] = uptime_percentage(row[2 * i + 1], row[2 * i])
    return out


def series(db: Session, monitor_id: int, range_key: str) -> list[dict[str, Any]]:
    window, bucket_s = RANGES[range_key]
    bucket = func.date_bin(
        literal_column(f"interval '{int(bucket_s)} seconds'"),
        CheckResult.checked_at,
        literal_column("timestamptz '2000-01-01 00:00:00+00'"),
    ).label("bucket")
    failures = func.count().filter(CheckResult.success.is_(False))
    rows = db.execute(
        select(
            bucket,
            func.count(),
            failures,
            func.avg(CheckResult.response_time_ms),
            func.max(CheckResult.response_time_ms),
        )
        .where(CheckResult.monitor_id == monitor_id, CheckResult.checked_at >= _since(window))
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    return [
        {
            "timestamp": r[0],
            "checks": r[1],
            "availability": round((r[1] - r[2]) / r[1] * 100, 2),
            "error_rate": round(r[2] / r[1] * 100, 2),
            "avg_response_time_ms": _round(r[3]),
            "max_response_time_ms": r[4],
        }
        for r in rows
    ]


def uptime_24h_by_monitor(db: Session, monitor_ids: list[int]) -> dict[int, float | None]:
    if not monitor_ids:
        return {}
    rows = db.execute(
        select(CheckResult.monitor_id, func.count(), func.count().filter(CheckResult.success.is_(True)))
        .where(CheckResult.monitor_id.in_(monitor_ids), CheckResult.checked_at >= _since(timedelta(hours=24)))
        .group_by(CheckResult.monitor_id)
    ).all()
    return {r[0]: uptime_percentage(r[2], r[1]) for r in rows}


def overall_uptime_24h(db: Session, user_id: int) -> float | None:
    row = db.execute(
        select(func.count(), func.count().filter(CheckResult.success.is_(True)))
        .join(Monitor, Monitor.id == CheckResult.monitor_id)
        .where(Monitor.user_id == user_id, CheckResult.checked_at >= _since(timedelta(hours=24)))
    ).one()
    return uptime_percentage(row[1], row[0])


def display_status(monitor: Monitor) -> str:
    if not monitor.enabled:
        return "paused"
    return monitor.status if monitor.status in ("up", "down") else "unknown"
