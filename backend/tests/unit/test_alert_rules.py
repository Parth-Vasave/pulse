"""The alert rules are only useful if they reference metrics the app really exports."""

import re
from pathlib import Path

import yaml
from prometheus_client import REGISTRY

import app.core.metrics  # noqa: F401  (registers the app's metrics)
import worker.celery_app  # noqa: F401

MONITORING = Path(__file__).resolve().parents[3] / "infrastructure" / "monitoring"
PROMQL_BUILTINS = {"time", "max", "sum", "rate", "increase", "up"}


def exported_series() -> set[str]:
    """Series names as Prometheus sees them. Labelled metrics have no samples until first use, so derive from types."""
    suffixes = {"counter": ["_total"], "histogram": ["_bucket", "_sum", "_count"]}
    return {m.name + suffix for m in REGISTRY.collect() for suffix in ["", *suffixes.get(m.type, [])]}


def rules():
    doc = yaml.safe_load((MONITORING / "alerts.yml").read_text())
    return [r for g in doc["groups"] for r in g["rules"]]


def test_every_rule_has_what_an_on_call_engineer_needs():
    for r in rules():
        assert r["alert"].startswith("Pulse"), r
        assert r["labels"]["severity"] in {"critical", "warning"}, r
        assert r["annotations"]["summary"] and r["annotations"]["description"], r


def test_rules_only_reference_metrics_that_exist():
    series = exported_series() | {"up"}
    for r in rules():
        expr = re.sub(r"\{[^}]*\}|\[[^\]]*\]|\"[^\"]*\"", "", r["expr"])  # drop label matchers, ranges, strings
        names = set(re.findall(r"[a-zA-Z_:][a-zA-Z0-9_:]*", expr)) - PROMQL_BUILTINS
        assert names <= series, f"{r['alert']} references unknown metrics: {names - series}"


def test_the_scheduler_stall_alert_exists_and_prometheus_loads_the_rules():
    assert "PulseSchedulerStalled" in {r["alert"] for r in rules()}
    config = yaml.safe_load((MONITORING / "prometheus.yml").read_text())
    assert config["rule_files"] == ["/etc/prometheus/alerts.yml"]
