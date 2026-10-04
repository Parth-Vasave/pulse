from prometheus_client import Counter, Gauge, Histogram

monitor_checks_total = Counter("monitor_checks_total", "Monitor checks executed")
monitor_check_failures_total = Counter("monitor_check_failures_total", "Failed monitor checks", ["error_type"])
monitor_check_duration_seconds = Histogram(
    "monitor_check_duration_seconds",
    "Wall-clock duration of a monitor check",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
)
incidents_created_total = Counter("incidents_created_total", "Incidents opened")
incidents_resolved_total = Counter("incidents_resolved_total", "Incidents resolved")
notifications_sent_total = Counter("notifications_sent_total", "Notifications delivered", ["channel_type"])
notifications_failed_total = Counter("notifications_failed_total", "Notification delivery failures", ["channel_type"])
worker_jobs_total = Counter("worker_jobs_total", "Worker jobs started", ["task"])
worker_job_failures_total = Counter("worker_job_failures_total", "Worker jobs that raised", ["task"])

# Pulse watching itself: Beat -> Redis -> worker -> DB must all be alive for this timestamp to keep advancing.
scheduler_last_tick_timestamp_seconds = Gauge(
    "scheduler_last_tick_timestamp_seconds", "Unix time of the last completed scheduler tick"
)
queue_depth = Gauge("queue_depth", "Jobs waiting in a Celery queue", ["queue"])
heartbeat_pings_total = Counter("heartbeat_pings_total", "Dead-man's-switch pings sent", ["outcome"])
