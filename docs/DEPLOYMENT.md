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
| `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` | a strong, matching value |
| `COOKIE_SECURE` | `true` (serve over HTTPS) |
| `CORS_ORIGINS`, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL` | your public URLs |
| `SSRF_ALLOWED_HOSTS` | empty |
| `SEED_DEMO_DATA` | `false` (the prod compose file never seeds) |
| `SMTP_*` | a real SMTP relay |

Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of ports 3000 and 8000. Do not
expose Postgres or Redis.

## Notes
- The frontend image is built with `INTERNAL_API_URL=http://backend:8000` (the compose service name). If your API
  has a different internal address, rebuild the frontend image with `--build-arg INTERNAL_API_URL=...`.
- Run exactly one `scheduler` (Celery Beat). Scale `worker` freely.
