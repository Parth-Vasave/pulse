"""Time-weighted uptime, bucketed availability and error breakdown against exact, hand-computed timelines.

Every test pins `now`, so expected values are arithmetic, not approximations of wall-clock time.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.models import CheckResult
from app.repositories import stats
from tests.integration.helpers import make_monitor, make_user

NOW = datetime(2026, 3, 9, 12, 0, tzinfo=UTC)  # the day after the US DST change
H, M = 3600, 60


def put(db, monitor, offsets, success=True, error_type=None, rt=50):
    """Insert checks at `NOW - offset` seconds."""
    db.add_all(
        CheckResult(
            monitor_id=monitor.id,
            checked_at=NOW - timedelta(seconds=o),
            success=success,
            status_code=200 if success else 500,
            response_time_ms=rt if success or rt else None,
            error_type=None if success else (error_type or "http_error"),
        )
        for o in offsets
    )
    db.commit()


def every(step, start_ago, end_ago=0):
    """Offsets (seconds before NOW) from start_ago down to end_ago, exclusive, spaced `step`."""
    return list(range(start_ago, end_ago, -step))


@pytest.fixture
def mon(db):
    return make_monitor(db, make_user(db), interval_seconds=60)


def day(db, monitor):
    return stats.summary(db, monitor, timedelta(hours=24), NOW)


def test_ten_minutes_down_in_a_day_is_99_306_percent(db, mon):
    offsets = every(M, 86400)  # 1440 checks, one per minute
    put(db, mon, offsets[:700] + offsets[710:], success=True)
    put(db, mon, offsets[700:710], success=False)
    s = day(db, mon)
    assert s.downtime_seconds == 600 and s.covered_seconds == 86400
    assert s.uptime_percentage == 99.306  # (86400 - 600) / 86400
    assert s.total_checks == 1440


def test_uneven_spacing_is_weighted_by_time_not_check_count(db):
    m = make_monitor(db, make_user(db), interval_seconds=3600)
    put(db, m, every(H, 24 * H, 2 * H), success=True)  # 22 hourly passes
    put(db, m, [2 * H], success=True)  # 23rd pass covers 1h to the first failure
    put(db, m, every(M, H), success=False)  # then 60 failures, one a minute
    s = day(db, m)
    assert s.total_checks == 83
    assert s.uptime_percentage == 95.833  # 23h up / 24h; a count-based figure would be 23/83 = 27.7%
    assert s.downtime_seconds == 3600


def test_gap_longer_than_cap_is_unknown_not_downtime(db, mon):
    put(db, mon, every(M, 86400, 86400 - 720 * M), success=True)  # monitor ran for 12h, then stopped
    s = day(db, mon)
    assert s.uptime_percentage == 100.0
    assert s.covered_seconds == 719 * M + 2 * M  # last check speaks for at most 2 x interval


def test_paused_period_is_excluded(db, mon):
    put(db, mon, every(M, 86400, 86400 - 360 * M), success=True)  # first 6h up
    put(db, mon, every(M, 6 * H), success=False)  # paused 6h..18h, last 6h failing
    s = day(db, mon)
    assert s.covered_seconds == (359 * M + 2 * M) + 360 * M
    assert s.uptime_percentage == round((359 * M + 2 * M) / s.covered_seconds * 100, 3)


def test_single_fresh_failure(db, mon):
    put(db, mon, [30], success=False)
    s = day(db, mon)
    assert (s.uptime_percentage, s.downtime_seconds, s.covered_seconds) == (0.0, 30, 30)


def test_no_data_is_none_not_zero_or_hundred(db, mon):
    assert day(db, mon).uptime_percentage is None
    put(db, mon, [3 * 86400], success=True)  # long before the window and its cap
    assert day(db, mon).uptime_percentage is None
    assert stats.uptime_windows(db, mon, NOW)["24h"] is None


def test_check_before_window_counts_for_its_overlap_only(db):
    m = make_monitor(db, make_user(db), interval_seconds=600)  # cap = 1200s
    put(db, m, [H + 300], success=False)  # 5 min before the 1h window opens
    s = stats.summary(db, m, timedelta(hours=1), NOW)
    assert s.downtime_seconds == 900 and s.uptime_percentage == 0.0  # 1200 - 300 inside the window
    assert s.total_checks == 0


def test_multiple_windows_from_one_scan(db):
    """Passing until 2 days ago, failing since. Each window clips the same segments differently."""
    m = make_monitor(db, make_user(db), interval_seconds=3600)
    put(db, m, every(H, 30 * 24 * H, 48 * H), success=True)
    put(db, m, every(H, 48 * H), success=False)
    assert stats.uptime_windows(db, m, NOW) == {
        "24h": 0.0,
        "7d": round(5 * 86400 / (7 * 86400) * 100, 3),  # 5 of 7 days passing
        "30d": round(28 * 86400 / (30 * 86400) * 100, 3),  # 28 of 30 days passing
    }


def test_overall_uptime_is_weighted_across_monitors(db):
    user = make_user(db)
    a = make_monitor(db, user, name="a", interval_seconds=3600)
    b = make_monitor(db, user, name="b", interval_seconds=3600)
    put(db, a, every(H, 24 * H), success=True)
    put(db, b, every(H, 24 * H, 12 * H), success=True)
    put(db, b, every(H, 12 * H), success=False)
    covs = stats.coverage(db, [a.id, b.id], [timedelta(hours=24)], NOW)
    up = sum(c[0].up_seconds for c in covs.values())
    down = sum(c[0].down_seconds for c in covs.values())
    assert stats.Coverage(up, down).uptime == 75.0


def test_series_availability_and_error_rate_per_bucket(db, mon):
    put(db, mon, every(M, 2 * H, 10 * M), success=True)
    put(db, mon, every(M, 10 * M), success=False, error_type="timeout", rt=0)
    pts = stats.series(db, mon, "1h", NOW)
    assert sum(p["checks"] for p in pts) == 60  # only checks inside the hour
    assert pts[0]["availability"] == 100.0 and pts[0]["error_rate"] == 0.0 and pts[0]["errors"] == {}
    assert pts[-1]["availability"] == 0.0 and pts[-1]["error_rate"] == 100.0
    assert pts[-1]["errors"] == {"timeout": 1}


def test_error_breakdown_by_type(db, mon):
    put(db, mon, [20 + i for i in range(4)], success=True)
    put(db, mon, [30, 31, 32], success=False, error_type="http_error")
    put(db, mon, [40, 41], success=False, error_type="timeout")
    put(db, mon, [50], success=False, error_type="assertion_failed")
    pts = stats.series(db, mon, "24h", NOW)
    total = {}
    for p in pts:
        for k, v in p["errors"].items():
            total[k] = total.get(k, 0) + v
    assert total == {"http_error": 3, "timeout": 2, "assertion_failed": 1}
    assert sum(p["checks"] for p in pts) == 10
    assert round(sum(p["error_rate"] * p["checks"] for p in pts) / 10, 2) == 60.0


def test_buckets_agree_with_headline(db):
    """One hourly check per 1h bucket: per-bucket availability must average to the headline figure."""
    m = make_monitor(db, make_user(db), interval_seconds=3600)
    grid = every(H, 7 * 24 * H)
    failing = {5 * 24 * H, 4 * 24 * H, 3 * 24 * H}
    put(db, m, [o for o in grid if o not in failing], success=True)
    put(db, m, sorted(failing), success=False)
    s = stats.summary(db, m, timedelta(days=7), NOW)
    pts = stats.series(db, m, "7d", NOW)
    assert len(pts) == 168 and sum(p["checks"] for p in pts) == s.total_checks == 168
    assert [p["availability"] for p in pts].count(0.0) == 3
    assert abs(sum(p["availability"] for p in pts) / len(pts) - s.uptime_percentage) < 0.01


def test_dst_and_session_timezone_do_not_change_results(db):
    """72 hourly checks straddling the 2026-03-08 US DST jump; one failure at the jump itself."""
    m = make_monitor(db, make_user(db), interval_seconds=3600)
    offsets = every(H, 72 * H)
    jump = datetime(2026, 3, 8, 7, 0, tzinfo=UTC)  # 02:00 America/New_York, the skipped hour
    bad = int((NOW - jump).total_seconds())
    put(db, m, [o for o in offsets if o != bad], success=True)
    put(db, m, [bad], success=False)

    def measure():
        s = stats.summary(db, m, timedelta(days=3), NOW)
        pts = stats.series(db, m, "7d", NOW)
        return s.uptime_percentage, [p["timestamp"] for p in pts]

    utc_result = measure()
    db.execute(text("SET TIME ZONE 'America/New_York'"))
    assert measure() == utc_result
    uptime, stamps = utc_result
    assert uptime == round(71 / 72 * 100, 3)
    assert len(stamps) == 72 and all((b - a) == timedelta(hours=1) for a, b in zip(stamps, stamps[1:], strict=False))
