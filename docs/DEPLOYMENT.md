# Deployment and releases

## Releasing
Tag a commit on `main`:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The `Release` workflow builds the `backend`, `frontend` and `demo` images and pushes them to
`ghcr.io/<owner>/pulse-<name>` tagged `1.0.0`, `1.0` and `latest`. It then creates a GitHub release with generated
notes and `docker-compose.prod.yml` + `.env.example` attached. Make the packages public (or `docker login ghcr.io`
on the host) so they can be pulled.

## Running a release
```bash
curl -LO https://github.com/Parth-Vasave/pulse/releases/latest/download/docker-compose.prod.yml
curl -L  https://github.com/Parth-Vasave/pulse/releases/latest/download/.env.example -o .env
# edit .env (see below), then:
PULSE_VERSION=1.0.0 docker compose -f docker-compose.prod.yml up -d
```
Migrations run automatically in the `migrate` job before the API, worker and scheduler start. To upgrade, change
`PULSE_VERSION` and run `up -d` again. To roll back the app, set the old version; schema downgrades are manual
(`alembic downgrade -1`).

## Required `.env` changes for production
| Setting | Value |
|---|---|
| `ENVIRONMENT` | `production` (the app refuses the placeholder `SECRET_KEY` otherwise) |
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `ENCRYPTION_KEY` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. **Required** (the app refuses to start without it). Set it *before* the first start of this version: the migration encrypts existing headers and webhook URLs with it. Back it up; see [SECURITY.md](SECURITY.md#encryption-at-rest) |
| `HEARTBEAT_URL` | optional: ping URL from Healthchecks.io / Cronitor / Better Stack (see below) |
| `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` | a strong, matching value |
| `COOKIE_SECURE` | `true` (serve over HTTPS) |
| `CORS_ORIGINS`, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL` | your public URLs |
| `SSRF_ALLOWED_HOSTS` | empty |
| `SEED_DEMO_DATA` | `false` (the prod compose file never seeds) |
| `SMTP_*` | a real SMTP relay |

Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of ports 3000 and 8000. Do not
expose Postgres or Redis.

## Monitoring Pulse itself
A monitoring tool that silently stops is worse than none, so Pulse reports on itself in three layers:

1. **Dead-man's switch (recommended, external).** Create a check at a service such as Healthchecks.io, set its period to
   ~1 minute with a few minutes of grace, and put its ping URL in `HEARTBEAT_URL`. Every scheduler tick that completes
   successfully (Beat → Redis → worker → Postgres) pings it, at most once per `HEARTBEAT_INTERVAL_SECONDS`. If Pulse, its
   host or its network dies, the pings stop and *that service* alerts you, which no in-stack alert can do.
2. **Prometheus alerts.** `infrastructure/monitoring/alerts.yml` alerts on a stalled scheduler
   (`scheduler_last_tick_timestamp_seconds` not advancing), a down API or worker, backed-up `checks` / `notifications`
   queues (`queue_depth`), failing notification delivery and a failing heartbeat ping. `docker compose --profile
   monitoring up` loads it into Prometheus on :9090; point your Alertmanager at that Prometheus to route the alerts.
   The production compose file does not run Prometheus: mount the same two files into yours.
3. **Metrics for dashboards:** `scheduler_last_tick_timestamp_seconds`, `queue_depth{queue}` and
   `heartbeat_pings_total{outcome}` are exported by the worker on `:9101/metrics`.

The tick runs in the worker (Beat only enqueues it), so a dead Beat shows up as a stale timestamp while the worker
still looks healthy: that is why the alert watches the timestamp rather than just `up`.

## Notes
- The frontend image is built with `INTERNAL_API_URL=http://backend:8000` (the compose service name). If your API
  has a different internal address, rebuild the frontend image with `--build-arg INTERNAL_API_URL=...`.
- Run exactly one `scheduler` (Celery Beat). Scale `worker` freely.
