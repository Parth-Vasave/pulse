# ruff: noqa: S608  (SQL is built only from internal integer constants; every value is a bound parameter)
"""Read-side aggregates over check_results.

Uptime is TIME-WEIGHTED (see docs/ARCHITECTURE.md "Metrics definitions"):

  * Each check is treated as the monitor's state from its own timestamp until the next check,
    but never for longer than CAP = 2 x the monitor's interval. Past the cap the state is
    unknown, so paused periods and outages of this platform are excluded rather than counted
    as up or down.
  * The first check before the window start still counts for the part of its coverage that
    falls inside the window; coverage is clipped to [window_start, now].
  * uptime % = passing seconds / (passing + failing seconds). No covered time -> None.

Latency percentiles use checks that received an HTTP response (response_time_ms IS NOT NULL);
timeouts/DNS failures have no latency and show up in uptime and the error breakdown instead.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import CheckResult, Monitor

RANGES: dict[str, tuple[timedelta, int]] = {
    "1h": (timedelta(hours=1), 60),
    "24h": (timedelta(hours=24), 900),
    "7d": (timedelta(days=7), 3600),
    "30d": (timedelta(days=30), 21600),
}
CAP_MULTIPLIER = 2

# One CTE shared by every time-weighted query: per check, the interval [s, e) it speaks for.
_SEGMENTS = """
WITH c AS (
  SELECT r.monitor_id, r.checked_at, r.success, r.error_type, r.response_time_ms,
         LEAD(r.checked_at) OVER (PARTITION BY r.monitor_id ORDER BY r.checked_at, r.id) AS next_at,
         m.interval_seconds * {cap} * interval '1 second' AS cap
  FROM check_results r JOIN monitors m ON m.id = r.monitor_id
  WHERE r.monitor_id = ANY(:ids) AND r.checked_at <= CAST(:now AS timestamptz)
    AND r.checked_at >= CAST(:min_start AS timestamptz) - m.interval_seconds * {cap} * interval '1 second'
), seg AS (
  SELECT monitor_id, success, error_type, response_time_ms AS rt, checked_at AS s,
         LEAST(COALESCE(next_at, CAST(:now AS timestamptz)), checked_at + cap,
               CAST(:now AS timestamptz)) AS e
  FROM c
)
"""


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


@dataclass(frozen=True)
class Coverage:
    up_seconds: float = 0.0
    down_seconds: float = 0.0

    @property
    def covered_seconds(self) -> float:
        return self.up_seconds + self.down_seconds

    @property
    def uptime(self) -> float | None:
        if self.covered_seconds <= 0:
            return None
        return round(self.up_seconds / self.covered_seconds * 100, 3)


def coverage(
    db: Session, monitor_ids: list[int], windows: list[timedelta], now: datetime | None = None
) -> dict[int, list[Coverage]]:
    """Passing/failing seconds per monitor for each window, from a single scan."""
    now = _now(now)
    out = {mid: [Coverage() for _ in windows] for mid in monitor_ids}
    if not monitor_ids:
        return out
    params: dict[str, Any] = {"ids": monitor_ids, "now": now, "min_start": now - max(windows)}
    cols = []
    for i, w in enumerate(windows):
        params[f"w{i}"] = now - w
        secs = (
            f"GREATEST(0, EXTRACT(EPOCH FROM LEAST(e, CAST(:now AS timestamptz))"
            f" - GREATEST(s, CAST(:w{i} AS timestamptz))))"
        )
        cols.append(
            f"COALESCE(SUM({secs}) FILTER (WHERE success), 0), COALESCE(SUM({secs}) FILTER (WHERE NOT success), 0)"
        )
    # Interpolated parts are internal integer constants / column expressions; all values are bound params.
    sql = _SEGMENTS.format(cap=CAP_MULTIPLIER) + f"SELECT monitor_id, {', '.join(cols)} FROM seg GROUP BY monitor_id"
    for row in db.execute(text(sql), params).all():
        out[row[0]] = [Coverage(float(row[1 + 2 * i]), float(row[2 + 2 * i])) for i in range(len(windows))]
    return out


@dataclass
class Summary:
    total_checks: int
    successful_checks: int
    uptime_percentage: float | None
    downtime_seconds: int
    covered_seconds: int
    avg_response_time_ms: float | None
    p50_response_time_ms: float | None
    p95_response_time_ms: float | None
    p99_response_time_ms: float | None


def _round(v: float | None) -> float | None:
    return None if v is None else round(float(v), 1)


def summary(db: Session, monitor: Monitor, window: timedelta, now: datetime | None = None) -> Summary:
    now = _now(now)
    cov = coverage(db, [monitor.id], [window], now)[monitor.id][0]
    rt = CheckResult.response_time_ms
    row = db.execute(
        select(
            func.count(),
            func.count().filter(CheckResult.success.is_(True)),
            func.avg(rt),
            func.percentile_cont(0.5).within_group(rt),
            func.percentile_cont(0.95).within_group(rt),
            func.percentile_cont(0.99).within_group(rt),
        ).where(
            CheckResult.monitor_id == monitor.id, CheckResult.checked_at >= now - window, CheckResult.checked_at <= now
        )
    ).one()
    return Summary(
        row[0],
        row[1],
        cov.uptime,
        round(cov.down_seconds),
        round(cov.covered_seconds),
        _round(row[2]),
        _round(row[3]),
        _round(row[4]),
        _round(row[5]),
    )


def uptime_windows(db: Session, monitor: Monitor, now: datetime | None = None) -> dict[str, float | None]:
    covs = coverage(db, [monitor.id], [timedelta(days=1), timedelta(days=7), timedelta(days=30)], now)[monitor.id]
    return {"24h": covs[0].uptime, "7d": covs[1].uptime, "30d": covs[2].uptime}


def series(db: Session, monitor: Monitor, range_key: str, now: datetime | None = None) -> list[dict[str, Any]]:
    """Per-bucket availability (time-weighted), error rate and error breakdown.

    A check's covered seconds are attributed to the bucket containing the start of its coverage,
    so buckets always sum exactly to the headline totals (a segment crossing a boundary is not split).
    """
    now = _now(now)
    window, bucket_s = RANGES[range_key]
    start = now - window
    secs = "GREATEST(0, EXTRACT(EPOCH FROM LEAST(e, CAST(:now AS timestamptz)) - GREATEST(s, CAST(:start AS timestamptz))))"
    sql = (
        _SEGMENTS.format(cap=CAP_MULTIPLIER)
        + f"""
SELECT date_bin(interval '{int(bucket_s)} seconds', GREATEST(s, CAST(:start AS timestamptz)),
                timestamptz '2000-01-01 00:00:00+00') AS bucket,
       success, error_type,
       COUNT(*) FILTER (WHERE s >= CAST(:start AS timestamptz)) AS checks,
       COUNT(rt) FILTER (WHERE s >= CAST(:start AS timestamptz)) AS rt_n,
       COALESCE(SUM(rt) FILTER (WHERE s >= CAST(:start AS timestamptz)), 0) AS rt_sum,
       MAX(rt) FILTER (WHERE s >= CAST(:start AS timestamptz)) AS rt_max,
       COALESCE(SUM({secs}) FILTER (WHERE success), 0) AS up_s,
       COALESCE(SUM({secs}) FILTER (WHERE NOT success), 0) AS down_s
FROM seg GROUP BY 1, 2, 3 ORDER BY 1
"""
    )
    rows = db.execute(text(sql), {"ids": [monitor.id], "now": now, "start": start, "min_start": start}).all()

    buckets: dict[datetime, dict[str, Any]] = {}
    for b, success, error_type, checks, rt_n, rt_sum, rt_max, up_s, down_s in rows:
        d = buckets.setdefault(
            b,
            {"checks": 0, "failed": 0, "errors": {}, "rt_n": 0, "rt_sum": 0.0, "rt_max": None, "up": 0.0, "down": 0.0},
        )
        d["checks"] += checks
        d["rt_n"] += rt_n
        d["rt_sum"] += float(rt_sum)
        d["rt_max"] = rt_max if d["rt_max"] is None else max(d["rt_max"], rt_max or 0)
        d["up"] += float(up_s)
        d["down"] += float(down_s)
        if not success:
            d["failed"] += checks
            key = error_type or "unknown"
            d["errors"][key] = d["errors"].get(key, 0) + checks

    points = []
    for b in sorted(buckets):
        d = buckets[b]
        if d["checks"] == 0:  # only the carried-over check from before the window
            continue
        covered = d["up"] + d["down"]
        availability = (d["up"] / covered * 100) if covered > 0 else (d["checks"] - d["failed"]) / d["checks"] * 100
        points.append(
            {
                "timestamp": b,
                "checks": d["checks"],
                "availability": round(availability, 2),
                "error_rate": round(d["failed"] / d["checks"] * 100, 2),
                "errors": d["errors"],
                "avg_response_time_ms": _round(d["rt_sum"] / d["rt_n"]) if d["rt_n"] else None,
                "max_response_time_ms": d["rt_max"],
            }
        )
    return points


def uptime_24h_by_monitor(db: Session, monitors: list[Monitor]) -> dict[int, float | None]:
    covs = coverage(db, [m.id for m in monitors], [timedelta(hours=24)])
    return {mid: c[0].uptime for mid, c in covs.items()}


def uptime_30d_by_monitor(db: Session, monitors: list[Monitor]) -> dict[int, float | None]:
    covs = coverage(db, [m.id for m in monitors], [timedelta(days=30)])
    return {mid: c[0].uptime for mid, c in covs.items()}


def overall_uptime_24h(db: Session, user_id: int) -> float | None:
    ids = list(db.scalars(select(Monitor.id).where(Monitor.user_id == user_id)))
    covs = coverage(db, ids, [timedelta(hours=24)])
    up = sum(c[0].up_seconds for c in covs.values())
    down = sum(c[0].down_seconds for c in covs.values())
    return Coverage(up, down).uptime


def display_status(monitor: Monitor) -> str:
    if not monitor.enabled:
        return "paused"
    return monitor.status if monitor.status in ("up", "down") else "unknown"


def recent_outcomes(db: Session, monitor_ids: list[int], limit: int = 60) -> dict[int, list[bool]]:
    """Last `limit` check outcomes per monitor, oldest first (for heartbeat strips)."""
    if not monitor_ids:
        return {}
    rn = func.row_number().over(partition_by=CheckResult.monitor_id, order_by=CheckResult.checked_at.desc())
    ranked = (
        select(CheckResult.monitor_id, CheckResult.success, CheckResult.checked_at, rn.label("rn"))
        .where(CheckResult.monitor_id.in_(monitor_ids))
        .subquery()
    )
    rows = db.execute(
        select(ranked.c.monitor_id, ranked.c.success).where(ranked.c.rn <= limit).order_by(ranked.c.checked_at)
    ).all()
    out: dict[int, list[bool]] = {mid: [] for mid in monitor_ids}
    for monitor_id, success in rows:
        out[monitor_id].append(success)
    return out
