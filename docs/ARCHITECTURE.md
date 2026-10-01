# Architecture

```
 Browser ──► Next.js (UI + /api proxy) ──► FastAPI ──► PostgreSQL
                                              │            ▲
                                              │ (no checks run here)
 Celery Beat ──enqueue due checks──► Redis ──► Celery workers ──► monitored APIs
 (scheduler)                         (queue)        │
                                                    ├─► incident engine ──► PostgreSQL
                                                    └─► notifications ──► email / webhook / Discord
```

| Service | Role | Scales by |
|---|---|---|
| `frontend` | Next.js UI; proxies `/api/*` to the API so the session cookie is first-party | replicas |
| `backend` | FastAPI REST API. **Never performs monitoring requests.** | replicas |
| `scheduler` | Celery Beat: a 5 s tick that enqueues due checks, plus housekeeping | exactly 1 |
| `worker` | Celery workers: run checks, apply incident logic, deliver notifications | replicas / concurrency |
| `postgres` | System of record (including the schedule) | – |
| `redis` | Job queue broker and rate-limit counters | – |

## Design decisions (the "why" behind the interview questions)

**Why separate workers from FastAPI?** A check can take up to 30 s plus retries. Running it in a request handler would tie API capacity to the slowest customer endpoint, and a burst of monitors would starve user traffic. Workers fail, restart and scale independently; the API only reads and writes rows.

**Why Celery + Redis?** Mature retries, routing, time limits and late acknowledgement for little code. Redis is already needed for rate limiting. Checks are I/O-bound, so workers use the *threads* pool: cheap concurrency (20 per container) and one process, which makes in-process Prometheus counters accurate. Celery's weakness (visibility timeout semantics) is why delivery is `acks_late` and every task is safe to run twice.

**Why PostgreSQL?** Relational integrity (FKs, cascade delete), partial indexes, `FOR UPDATE SKIP LOCKED`, `date_bin` and `percentile_cont` for analytics. One database does queueing-state, tenancy and metrics.

**How are monitoring jobs scheduled?** The *database is the schedule*: each monitor has `next_check_at`. Every 5 s Beat runs one transaction:
`SELECT … WHERE enabled AND next_check_at <= now FOR UPDATE SKIP LOCKED` → enqueue → set `next_check_at = now + interval` → commit.
- Enqueue happens *before* commit. If Redis is down the transaction rolls back and the monitor is picked up next tick: at-least-once, never silently skipped.
- `SKIP LOCKED` makes overlapping ticks harmless. Even a duplicated Beat cannot double-schedule.
- Jobs carry `expires = interval`: a check that sat in the queue longer than one interval is stale and dropped, so a backlog cannot turn into a burst against customer endpoints (no retry storm).
- Adding, pausing or editing a monitor needs no scheduler reload: it is just a row.

**How is multi-tenancy enforced?** Every row hangs off `users.id`. Endpoints resolve a monitor with `WHERE id = :id AND user_id = :user` (`get_owned_monitor`); incidents, notification channels and API keys are scoped the same way (incidents via a join to the owning monitor). A foreign resource returns **404, not 403**, so IDs can't be probed. `tests/api/test_isolation.py` exercises every endpoint as a second user.

## Check execution (worker)

1. Load the monitor config in a short session, then **release the DB connection** (no connection is held during a slow HTTP call).
2. `http_checker.run_check` builds an SSRF-guarded client and performs the request with hard timeouts, redirects off, body read only when assertions need it (capped at 1 MB).
3. The outcome is classified: `timeout`, `dns_failure`, `connect_failure`, `invalid_response`, `unexpected_status`, `http_error`, `assertion_failed`, `slow_response`, `blocked_target`. Target misbehaviour is an *outcome*, never an exception.
4. `incident_service.record_check` runs in **one transaction under a row lock** on the monitor: insert the result, advance counters, open/resolve incidents, create `pending` notification rows.
5. After commit, notification jobs are enqueued. If Redis is down this fails soft; the sweeper re-enqueues from the database.

A bug inside the check task raises to Celery, which logs it, counts `worker_job_failures_total` and moves on. It cannot take the worker down or poison other monitors.

## Incident state machine

Pure function in `services/state_machine.py`; no I/O, exhaustively unit-tested.

```
UNKNOWN / UP ──(consecutive failures ≥ failure_threshold)──► DOWN   [open incident]
DOWN ──(consecutive successes ≥ recovery_threshold)──► UP           [resolve incident]
```
While DOWN, a failure resets the success streak (recovery must be *consecutive*) and keeps counting. While UP, a success resets the failure streak.

**How are incidents deduplicated?** Three layers: (1) the state machine only emits `OPEN_INCIDENT` on the transition into DOWN; (2) the row lock serialises concurrent checks of one monitor (tested with 4 racing threads → 1 incident); (3) a **partial unique index** `ON incidents(monitor_id) WHERE status = 'open'` makes a duplicate impossible even if the first two were bypassed. The insert uses a savepoint so a violation doesn't poison the transaction.

## Timeline

`incident_events` is append-only. When an incident opens, the failing streak is back-filled from `check_results` (first failure, failure #2 …) followed by `incident_created`; later `notification_sent|failed`, `recovery_check`, `recovered`, `incident_resolved` are added. The UI renders this list directly.

## Notifications

`NotificationProvider` (email via SMTP, generic webhook, Discord) behind `get_provider(type)`. A delivery is a `notifications` row (`pending → sent | failed`, `attempts`, `error_message`).

- Providers raise `NotificationError(retryable=…)`: 5xx/429/network → retryable; 4xx and SSRF-blocked → permanent.
- Retry: exponential backoff 2 s, 4 s, 8 s, 16 s, 32 s (cap 300 s), max **5 attempts**, then `failed` plus a timeline event.
- Delivery uses `FOR UPDATE SKIP LOCKED` on the row, so two workers never send the same message twice.
- A failed notification never touches incident state: incidents commit first, delivery is a separate job.
- Webhook/Discord URLs go through the same SSRF guard as monitor targets.

## Retry strategy summary

| What | Policy |
|---|---|
| Monitored request | Per-monitor `check_retries` (0–3, default **0**), only on timeout/connect errors, backoff 1 s, 2 s, 4 s capped at 5 s. HTTP errors are never retried; they are valid results. |
| DB errors in a check task | `autoretry_for=OperationalError`, exponential backoff + jitter, max 5 |
| Notifications | See above |
| Scheduler enqueue | Transaction rollback, retried next 5 s tick |
| Lost notification enqueue | Sweeper every 60 s re-enqueues `pending` rows older than 2 min |

## Failure handling

| Failure | Behaviour |
|---|---|
| Monitored API down/slow/garbage | Recorded as a result; worker unaffected |
| PostgreSQL down | API → `503` envelope; tasks retry with backoff; `pool_pre_ping` recovers connections; `/ready` → 503 |
| Redis down | Beat rolls back and retries; checks already queued stay in Redis (AOF); workers reconnect indefinitely; check results and incidents live in Postgres so nothing is lost; rate limiter fails open (logged) |
| Worker crash mid-task | `acks_late` + `reject_on_worker_lost` → job redelivered |
| Notification provider down | Retried with backoff, then marked failed and shown in the timeline |

## Database

`users` → `monitors` → `check_results`, `incidents` → `incident_events`, `notifications`; `notification_channels` and `api_keys` hang off `users`. Notable indexes: `check_results(monitor_id, checked_at)` (all analytics), partial `monitors(next_check_at) WHERE enabled` (scheduler), partial unique open-incident index, `incidents(status)`. Results older than `CHECK_RETENTION_DAYS` (35) are purged hourly in batches. Migrations: Alembic, verified up/down in CI.

## Metrics definitions

- **Uptime %** = successful checks ÷ total checks × 100 in the window, rounded to 3 dp. **No checks → `null`** ("No data"), never 0 or 100. Paused periods produce no checks, so they are excluded, not counted as downtime. Uptime is *check-based*, not time-weighted: with uneven intervals it approximates availability.
- **Latency** (avg, P50, P95, P99) uses `percentile_cont` (linear interpolation) over checks that received an HTTP response. Timeouts/DNS failures have no latency and show up in uptime/error rate. Failed-but-answered checks (a 500) are included, because slow errors matter.
- **Series**: `date_bin` buckets (1 h → 1 min, 24 h → 15 min, 7 d → 1 h, 30 d → 6 h); availability and error rate are per-bucket check ratios.
- **Public status**: `down` → outage; `up` but last response above the monitor's threshold → degraded; otherwise operational.

## Observability

Structured JSON logs (`service`, `event`, `monitor_id`, …) with key-based redaction of anything resembling passwords, tokens, headers or keys. Prometheus: API at `GET /metrics`, worker at `:9101/metrics` (`monitor_checks_total`, `monitor_check_failures_total{error_type}`, `monitor_check_duration_seconds`, `incidents_created_total`, `incidents_resolved_total`, `notifications_sent_total`, `notifications_failed_total`, `worker_jobs_total`, `worker_job_failures_total`). `docker compose --profile monitoring up` adds Prometheus on :9090.
