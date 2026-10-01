# REST API

Interactive docs: **`/docs`** (Swagger UI) and **`/openapi.json`** on the API (port 8000). Via the UI origin the API is proxied at `/api/*`.

**Auth:** session cookie (set by register/login) *or* `Authorization: Bearer <API key>`.

**Errors** always look like:
```json
{ "error": { "code": "validation_error", "message": "Request validation failed",
             "details": [{ "field": "timeout_seconds", "message": "Input should be less than or equal to 30" }] } }
```
Status codes: `201` created · `204` no content · `401` not authenticated · `404` not found *or not yours* · `409` conflict/limit · `413` body too large · `422` validation / blocked URL (`code: invalid_target`) · `429` rate limited (`Retry-After`) · `502` test notification failed · `503` dependency down.

## Auth
| | |
|---|---|
| `POST /api/auth/register` | `{email, password(≥10)}` → `201` user + cookie. `409` if email exists |
| `POST /api/auth/login` | → `200` user + cookie. `401` generic failure |
| `POST /api/auth/logout` | → `204` |
| `GET /api/auth/me` | → current user |

## Account
All three re-check the **current password** (wrong password → `403` with `code: "incorrect_password"`, not `401`, so clients don't mistake it for a lost session) and share the strict auth rate limit.

| | |
|---|---|
| `POST /api/account/email` | `{new_email, current_password}` → `200` user. `409` if the address is taken, `422` if unchanged |
| `POST /api/account/password` | `{current_password, new_password(≥10, must differ)}` → `204`. **Signs out every other session**; the caller gets a fresh cookie. API keys keep working |
| `POST /api/account/delete` | `{current_password}` → `204`. Permanently deletes the user and, by `ON DELETE CASCADE`, all their monitors, results, incidents, channels, notifications and API keys |

## Monitors
`POST /api/monitors`
```json
{ "name": "Production API", "url": "https://api.example.com/health", "method": "GET",
  "headers": {"Authorization": "Bearer …"}, "expected_status_code": 200,
  "timeout_seconds": 5, "interval_seconds": 60, "response_time_threshold_ms": 1500,
  "failure_threshold": 3, "recovery_threshold": 2, "check_retries": 0,
  "assertions": [ {"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"},
                  {"type": "body_contains", "value": "\"database\": \"connected\""} ],
  "show_on_status_page": true }
```
→ `201` monitor (`status: unknown` until the first check; `display_status`: `up|down|paused|unknown`).

| | |
|---|---|
| `GET /api/monitors` | list with `uptime_24h` |
| `GET /api/monitors/heartbeats` | `{monitorId: [bool…]}` last 60 outcomes (oldest first) |
| `GET/PATCH/DELETE /api/monitors/{id}` | PATCH merges and re-validates; `{"enabled": false}` pauses |
| `GET /api/monitors/{id}/checks?limit=50&failures_only=false` | recent results |
| `GET /api/monitors/{id}/stats?range=1h\|24h\|7d\|30d` | summary, 24h/7d/30d uptime, time series |

Assertion types: `body_contains`, `body_not_contains`, `json_field` (`operator`: `eq|ne|contains|exists`, dotted `path`, e.g. `checks.0.ok`).

Stats example:
```json
{ "range": "24h",
  "summary": { "total_checks": 1440, "successful_checks": 1430, "uptime_percentage": 99.306,
               "downtime_seconds": 600, "covered_seconds": 86400,
               "avg_response_time_ms": 50.5, "p50_response_time_ms": 50.5,
               "p95_response_time_ms": 95.1, "p99_response_time_ms": 99.0 },
  "uptime": { "24h": 99.306, "7d": 99.9, "30d": null },
  "series": [ { "timestamp": "…", "checks": 15, "availability": 93.33, "error_rate": 13.33,
                "errors": { "timeout": 1, "http_error": 1 },
                "avg_response_time_ms": 150.0, "max_response_time_ms": 200 } ] }
```
Uptime and `availability` are **time-weighted** (see ARCHITECTURE.md); `error_rate` is the share of *checks* that failed, and `errors` counts failures by cause. `null` means *no data*, not 0%.

## Incidents and dashboard
| | |
|---|---|
| `GET /api/incidents?status=open\|resolved&monitor_id=&limit=` | list with `duration_seconds` |
| `GET /api/incidents/{id}` | incident + `events[]` timeline (`first_failure`, `failure`, `incident_created`, `notification_sent`, `recovery_check`, `recovered`, `incident_resolved`, …) |
| `GET /api/dashboard/summary` | totals, healthy/down/paused, active incidents, `overall_uptime_24h` |

## Notification channels
`POST /api/channels` `{type: "email", name, address}` or `{type: "webhook"|"discord", name, url}` · `GET /api/channels` (targets masked) · `PATCH /api/channels/{id}` `{enabled, name}` · `DELETE` · `POST /api/channels/{id}/test` → `{status: "sent"}` or `502`.

Webhook payload:
```json
{ "event": "incident.created", "incident_id": 7, "monitor": {"name": "Production API", "url": "…"},
  "reason": "3 consecutive failures. Last error: Request timed out", "started_at": "…",
  "resolved_at": null, "downtime_seconds": null, "text": "🚨 API INCIDENT\nMonitor: …" }
```
`event` is `incident.created` or `incident.resolved`.

## API keys
`POST /api/api-keys` `{name}` → `201` with `key` (**shown once**) · `GET /api/api-keys` (prefix only) · `DELETE /api/api-keys/{id}` → `204` revokes.

## Status page
`GET/PUT /api/status-page` `{enabled, slug}` (`409` if slug taken) · public, unauthenticated: `GET /api/public/status/{slug}` → `{overall_status, components[{name,status,uptime_30d}], incidents[…]}`. The UI renders it at `/status/{slug}`.

## Operations
`GET /health` liveness · `GET /ready` checks Postgres and Redis (`503` with per-dependency booleans only) · `GET /metrics` Prometheus.
