# Prometheus metrics

Pulse exposes Prometheus metrics from the API and worker processes and ships a scrape config (`infrastructure/monitoring/prometheus.yml`) and self-monitoring alerts (`infrastructure/monitoring/alerts.yml`).

These metrics cover aggregate check volume, wall-clock check latency, incidents, notifications, worker execution, and scheduler health. Per-monitor time-weighted uptime and single-attempt HTTP response-time percentiles are computed in PostgreSQL (`GET /api/monitors/{id}/stats`; see [ARCHITECTURE.md](ARCHITECTURE.md#metrics-definitions)).

## Scrape endpoints and topology

| Service | Job | Endpoint | Default port | What is exposed and what advances |
|---|---|---|---|---|
| `backend` (FastAPI API) | `api` | `GET /metrics` | `8000` | Exposes `up{job="api"}`, Python/process runtime metrics, and all 12 Pulse families registered on import. Unlabelled Pulse series stay at `0`, labelled families emit `# HELP`/`# TYPE` headers only, and none advance in the API. |
| `worker` (Celery threads pool) | `worker` | `GET /metrics` | `9101` (`WORKER_METRICS_PORT`) | Exposes and updates all 12 Pulse application and self-monitoring metrics, plus Python/process runtime metrics. |
| `scheduler` (Celery Beat) | none | none | none | Exposes no HTTP endpoint. End-to-end scheduling health is tracked by `scheduler_last_tick_timestamp_seconds` on `worker`. |

Key scrape and deployment caveats:

- **Filter application queries with `{job="worker"}`.** Because `backend/app/api/health.py` imports `app.core.metrics`, the API exposes static `0` samples for unlabelled Pulse metrics and their startup `*_created` gauges. Filtering on `{job="worker"}` keeps idle API series out of dashboards and aggregations.
- **Single-process threads pool, one replica in the shipped config.** Workers run Celery with `-P threads -c 20 -Q checks,notifications`, so one worker process shares in-process Prometheus counters, histograms, and gauges across its 20 threads. The shipped `infrastructure/monitoring/prometheus.yml` defines a single static target (`worker:9101`), which covers one worker replica. If you scale `worker` to multiple replicas, configure separate static targets or DNS service discovery (`dns_sd_configs`) so Prometheus scrapes each replica as its own `instance`, then aggregate counters and histogram buckets with `sum(...)` and shared-state gauges (`scheduler_last_tick_timestamp_seconds`, `queue_depth`) with `max(...)`.
- **Worker metrics server and API middleware.** `worker/celery_app.py` starts `prometheus_client.start_http_server` on `worker_ready` using `WORKER_METRICS_PORT` (default `9101`; set `0` to disable). The API `/metrics` route is hidden from OpenAPI (`include_in_schema=False`), exempt from rate limiting alongside `/health` and `/ready`, and returns `text/plain; version=1.0.0; charset=utf-8`.
- **Local vs. production scraping.** Local development can run `docker compose --profile monitoring up` to start `prom/prometheus:v3.15.0` on `:9090` with `scrape_interval: 15s` and `evaluation_interval: 15s` configured in `infrastructure/monitoring/prometheus.yml`. `docker-compose.prod.yml` does not run Prometheus: `backend` is published only on `127.0.0.1:8000` and `worker:9101` is internal to the Compose network. A production Prometheus must either join the Pulse Compose network or scrape host loopback mappings (adding one for worker metrics if running Prometheus on the host).

## Metric reference

All 12 Pulse metric families are defined in `backend/app/core/metrics.py`.

### Check execution

Updated in `worker/tasks/check.py` during `run_monitor_check` (skipped if the monitor was deleted or disabled before execution).

| Metric | Type | Unit | Labels | Notes |
|---|---|---|---|---|
| `monitor_checks_total` | Counter | checks | none | Executed monitor checks (both passing and failing). |
| `monitor_check_failures_total` | Counter | failed checks | `error_type` | Failed checks (`not outcome.success`). |
| `monitor_check_duration_seconds` | Histogram | seconds (`s`) | `le` (on `_bucket`) | Wall-clock check duration observed as `(outcome.check_duration_ms or 0) / 1000`. Exports `_bucket`, `_sum`, and `_count`. |

- **`error_type` values** (`worker/services/http_checker.py` and fallback in `worker/tasks/check.py`): `timeout`, `dns_failure`, `connect_failure`, `invalid_response`, `unexpected_status` (HTTP `< 400`, including unfollowed `3xx` redirects), `http_error` (HTTP `>= 400`), `assertion_failed`, `slow_response`, `blocked_target` (SSRF guard), and defensive fallback `unknown`.
- **Histogram buckets (`le` label strings emitted by `prometheus-client`):** `0.05`, `0.1`, `0.25`, `0.5`, `1.0`, `2.5`, `5.0`, `10.0`, `30.0`, `+Inf` (seconds).
- **Duration scope and retry semantics:** `monitor_check_duration_seconds` records total wall-clock duration across per-monitor `check_retries` (0 to 3 retries on timeout/connect errors, including backoff sleeps), assertion body reads, and failed/timed-out checks; those in-check retries still count as one `monitor_checks_total` increment and one histogram observation. Checks with retries can exceed `30.0` s into `+Inf`, where `histogram_quantile()` caps estimates at `30.0` s. If a database `OperationalError` triggers a Celery autoretry after `run_check()` already completed, the retried task runs and records check metrics again.

### Incidents and notifications

Updated in `backend/app/services/incident_service.py` and `backend/app/services/notification_service.py` (inside worker tasks).

| Metric | Type | Unit | Labels | Notes |
|---|---|---|---|---|
| `incidents_created_total` | Counter | incidents | none | Incidents opened at `failure_threshold` consecutive failures (not incremented if a duplicate open-incident insert loses a race). |
| `incidents_resolved_total` | Counter | incidents | none | Incidents resolved by recovery at `recovery_threshold` consecutive successes. Closing an open incident on pause or URL/method edit does not increment this counter. |
| `notifications_sent_total` | Counter | notifications | `channel_type` | Incident notifications delivered successfully. |
| `notifications_failed_total` | Counter | failed attempts | `channel_type` | Failed delivery attempts (`NotificationError`), incremented on every failed attempt including retryable attempts up to `MAX_ATTEMPTS = 5`. Deleted or disabled channels are skipped without incrementing. |

- **`channel_type` values** (`backend/app/services/notifications/providers.py`): `email`, `webhook`, `discord`.

### Worker jobs

Updated in `worker/tasks/check.py`, `worker/tasks/notify.py`, and `worker/scheduler/tasks.py`.

| Metric | Type | Unit | Labels | Notes |
|---|---|---|---|---|
| `worker_jobs_total` | Counter | jobs | `task` | Celery task executions started (`run_monitor_check`, `send_notification`, `enqueue_due_checks`). Housekeeping tasks (`sweep_pending_notifications`, `purge_old_results`) are not counted. |
| `worker_job_failures_total` | Counter | failed jobs | `task` | Unhandled exceptions raised by `run_monitor_check` or `send_notification` (typically Postgres or Redis errors). `enqueue_due_checks` does not increment this counter. |

- **Retry semantics:** Each Celery retry of `run_monitor_check` (`autoretry_for=(OperationalError,)`, up to 5 retries) increments `worker_jobs_total` again, and each raising attempt increments `worker_job_failures_total`. For `send_notification`, retryable `NotificationError` failures are caught inside `notification_service.deliver()` and returned rather than raised, so they increment `notifications_failed_total` (not `worker_job_failures_total`) and then trigger `self.retry(...)`, which increments `worker_jobs_total{task="send_notification"}` on each subsequent attempt (up to 5 total attempts). Normal target check failures never increment `worker_job_failures_total`.

### Self-monitoring

Updated in `worker/scheduler/tasks.py` when `enqueue_due_checks` runs (scheduled by Celery Beat every `5s`).

| Metric | Type | Unit | Labels | Notes |
|---|---|---|---|---|
| `scheduler_last_tick_timestamp_seconds` | Gauge | Unix timestamp (`s`) | none | Epoch seconds of the last completed scheduler tick (`set_to_current_time()`). Advances only when Beat, Redis, a worker, and Postgres all succeed; starts at `0` until the first tick completes on that worker. |
| `queue_depth` | Gauge | queued jobs | `queue` | Redis `LLEN` for `checks` and `notifications`, sampled after each completed tick. |
| `heartbeat_pings_total` | Counter | pings | `outcome` | Dead-man's-switch pings (`success`, `failure`) sent to `HEARTBEAT_URL` at most once per `HEARTBEAT_INTERVAL_SECONDS` (default `60` s, minimum `10` s) across all workers via Redis lock `pulse:heartbeat:lock`. Not emitted when `HEARTBEAT_URL` is unset. |

- **Queue depth limits (stale and in-flight):** `queue_depth` is only refreshed after `schedule_due()` succeeds, so it freezes at its last value (goes stale) if Beat stops, scheduling fails, or Redis errors during `_observe_queues()`. Because it reads Redis `LLEN`, it counts only jobs waiting in the broker list; it excludes jobs already popped and running in workers under `acks_late` as well as delayed retry tasks. Queued checks also carry `expires=max(monitor.interval_seconds, 30)` s and are dropped when popped after expiring.

### Runtime series, lazy labels, and resets

- **Standard and `*_created` series:** Prometheus adds `up{job="api"}` and `up{job="worker"}` (`1` = scrape succeeded, `0` = failed). `prometheus-client` exports default Python/process collectors (`python_gc_*`, `python_info`, and Linux/POSIX `process_*`) plus Unix creation-timestamp gauges formed by stripping `_total` from counters and appending `_created` (for example `monitor_checks_created`, `incidents_created_created`, `worker_jobs_created`, and `monitor_check_duration_seconds_created`).
- **Low cardinality:** No `monitor_id`, `user_id`, or target `url` labels exist; all labels have small bounded domains (`error_type` <= 10, `channel_type` = 3, `task` = 3, `queue` = 2, `outcome` = 2).
- **Lazy labelled series and first-increment caveat:** Labelled metrics (and their `*_created` series) emit no samples until a label value is first observed in that process. Counters also reset to `0` on worker restart, so always wrap them in `rate()` or `increase()`. Because a brand-new label series appears at `1` without a prior `0` sample, the very first increment on a previously unseen label set may evade `increase(...) > 0` alerts until a second increment occurs (unless Prometheus created-timestamp zero injection is enabled).

## PromQL examples

With `scrape_interval: 15s` in `infrastructure/monitoring/prometheus.yml`, a `[5m]` range window spans about 20 scrapes; adjust range windows if you change `scrape_interval`.

### Check volume

Check throughput (checks/s across scraped workers; multiply by `60` for checks/min, or use `sum(increase(monitor_checks_total{job="worker"}[1h]))` for hourly volume):

```promql
sum(rate(monitor_checks_total{job="worker"}[5m]))
```

Failed checks per second by `error_type`:

```promql
sum by (error_type) (rate(monitor_check_failures_total{job="worker"}[5m]))
```

Overall check failure ratio (`0` to `1`; returns `0` when checks are running with no failures and avoids `NaN` when idle):

```promql
(sum(rate(monitor_check_failures_total{job="worker"}[5m])) or vector(0))
  /
(sum(rate(monitor_checks_total{job="worker"}[5m])) > 0)
```

### Check latency

Estimated P95 wall-clock check duration in seconds (replace `0.95` with `0.50` or `0.99` for P50/P99):

```promql
histogram_quantile(0.95, sum by (le) (rate(monitor_check_duration_seconds_bucket{job="worker"}[5m])))
```

Mean wall-clock check duration in seconds:

```promql
sum(rate(monitor_check_duration_seconds_sum{job="worker"}[5m]))
  /
(sum(rate(monitor_check_duration_seconds_count{job="worker"}[5m])) > 0)
```

Share of checks completing within `1.0` s (`0` to `1`; note `.0` bucket formatting from `prometheus-client`):

```promql
sum(rate(monitor_check_duration_seconds_bucket{job="worker", le="1.0"}[5m]))
  /
(sum(rate(monitor_check_duration_seconds_count{job="worker"}[5m])) > 0)
```

### Self-monitoring and worker health

Seconds since the last completed scheduler tick:

```promql
time() - max(scheduler_last_tick_timestamp_seconds{job="worker"})
```

Current queued jobs by Celery queue:

```promql
max by (queue) (queue_depth{job="worker"})
```

Worker job exception ratio over 10 minutes (`0` to `1`; `or vector(0)` returns `0` instead of empty data on healthy workers where `worker_job_failures_total` has no emitted series):

```promql
(sum(rate(worker_job_failures_total{job="worker"}[10m])) or vector(0))
  /
(sum(rate(worker_jobs_total{job="worker"}[10m])) > 0)
```

Failed notification attempts over 15 minutes by `channel_type`:

```promql
sum by (channel_type) (increase(notifications_failed_total{job="worker"}[15m]))
```

## Alert rules and validation

`infrastructure/monitoring/alerts.yml` defines the 8 `pulse-self-monitoring` rules loaded by `infrastructure/monitoring/prometheus.yml` (covering scheduler stalls, unreachable API/worker scrapes, `checks` and `notifications` queue backlogs, notification delivery failures, worker job exception ratio, and failed heartbeat pings). Note that `increase(...) > 0` alerts on labelled counters (`PulseNotificationDeliveryFailing`, `PulseHeartbeatPingFailing`) are subject to the lazy first-increment caveat above. See [DEPLOYMENT.md](DEPLOYMENT.md#monitoring-pulse-itself) for pairing these alerts with an external `HEARTBEAT_URL` dead-man's switch.

Validate the monitoring config and alert rules with `promtool` (matching CI and `backend/tests/unit/test_alert_rules.py`):

```bash
docker run --rm --entrypoint promtool \
  -v "$PWD/infrastructure/monitoring:/etc/prometheus:ro" \
  prom/prometheus:v3.15.0 check config /etc/prometheus/prometheus.yml
```
