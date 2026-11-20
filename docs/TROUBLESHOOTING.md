# Troubleshooting the local Docker demo

For the stack from the [Docker quick start](../README.md#quick-start-docker). Run every command from the repository
root (where `docker-compose.yml` lives).

## First look
```bash
docker compose ps -a                  # every service, including ones that exited
docker compose logs --tail=100 <service>
```
Service names: `postgres`, `redis`, `migrate`, `backend`, `worker`, `scheduler`, `frontend`, `demo-service`, `mailpit`
(plus `prometheus` when you start with the `monitoring` profile). Check the list with `docker compose config --services`
(add `--profile monitoring` before `config` to include `prometheus`).

`prometheus` is optional and only exists in the `monitoring` profile. Put the flag before the command each time you
use it: `docker compose --profile monitoring up -d`, `docker compose --profile monitoring ps -a`,
`docker compose --profile monitoring logs --tail=100 prometheus`. Without the flag, Compose does not start or list it.

Before anything else:
- `.env` exists. Without it, Compose stops with `required variable POSTGRES_PASSWORD is missing a value: copy
  .env.example to .env`. Fix: `cp .env.example .env`.
- `docker compose config --quiet` prints nothing when the Compose file and `.env` are valid. It changes nothing.

## Port conflicts
The stack publishes these host ports:

| Port | Service | Used for |
|---|---|---|
| 3000 | `frontend` | web UI |
| 8000 | `backend` | API and `/docs` |
| 8025 | `mailpit` | mail inbox |
| 9000 | `demo-service` | demo target API |
| 9090 | `prometheus` | only with `--profile monitoring` |

**Symptom:** `docker compose up` fails with `Bind for ...:<port> failed: port is already allocated` (another
container) or a "port is already in use" error (another program), and the affected service stays in the `Created` state.

**Find what holds the port** (example: 8000). First check Docker. Read the `PORTS` column for a host mapping such as
`0.0.0.0:8000->8000/tcp` or `127.0.0.1:8000->80/tcp`. The number before `->` is the host port, so look for
`:8000->`:
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```
(Do not use `docker ps --filter publish=8000`: it matches the container-side port, not the host port.) If no
container maps it, look for a program listening on the port:
```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN                                          # macOS / Linux
netstat -ano -p tcp | findstr :8000 | findstr LISTENING                   # Windows cmd (last column is the PID)
Get-NetTCPConnection -LocalPort 8000 -State Listen                        # Windows PowerShell (OwningProcess is the PID)
```

**Fix, either way:**
1. Stop the other program or container, then run `docker compose down` to clear the half-created containers and
   `docker compose up -d` again.
2. Keep the other program and move Pulse to free host ports. Create `docker-compose.override.yml` next to
   `docker-compose.yml` (Compose reads it automatically; do not commit it). `!override` needs Docker Compose 2.24.4 or
   newer (check with `docker compose version`):
   ```yaml
   services:
     frontend:
       ports: !override ["127.0.0.1:3100:3000"]
     backend:
       ports: !override ["127.0.0.1:8100:8000"]
     demo-service:
       ports: !override ["127.0.0.1:9100:9000"]
     mailpit:
       ports: !override ["127.0.0.1:8125:8025"]
     # Optional: only used when you start with --profile monitoring
     prometheus:
       ports: !override ["127.0.0.1:9190:9090"]
   ```
   Only the host side changes (`host_ip:host_port:container_port`), so containers still reach each other on the original
   ports. Open the UI, API docs, Mailpit and demo target at your new ports (for example http://localhost:3100).
   The monitor URL in the walk-through stays `http://demo-service:9000/switch`, because the worker reaches the demo
   service over the Compose network.

   Note the loopback bind: `docker-compose.yml` publishes `"8000:8000"`, which listens on every network interface, so
   other devices on your network can reach it. The `127.0.0.1:` prefix above restricts each port to this computer only.

   Check the result before restarting. `config --quiet` is silent on success. The `grep` command shows the merged
   port bindings.
   ```bash
   docker compose config --quiet
   docker compose config | grep -E "host_ip|published"
   docker compose --profile monitoring config --quiet
   ```

   Apply the override with `docker compose up -d`. If you use Prometheus, run `docker compose --profile monitoring up -d`.

## A service never becomes healthy
Startup order: `postgres` and `redis` (healthchecks) then `migrate` (Alembic plus demo seed) then `backend`,
`worker` and `scheduler`, then `frontend`. If an earlier step fails, the later ones stay in `Created` and Compose
reports `service "migrate" didn't complete successfully: exit 1`.

1. Run `docker compose ps -a` and find the first service that is `Exited` with a non-zero code or `unhealthy`.
   `postgres`, `redis` and `backend` show `(healthy)` when ready; `migrate` should show `Exited (0)`. `worker` and
   `scheduler` have no healthcheck, so `Up` is all `ps` can tell you; read their logs.
2. Read that service's logs: `docker compose logs --tail=100 migrate` (or `postgres`, `backend`, `worker`).
3. Check the usual cause before retrying:

| Log line | Cause | Fix |
|---|---|---|
| `password authentication failed for user "monitor"` (from `migrate`) | The `pgdata` volume was created with an earlier password. Postgres only reads `POSTGRES_PASSWORD` on first start | Restore the original password in **both** `.env` settings: `POSTGRES_PASSWORD` and the password inside `DATABASE_URL`. Then run `docker compose up -d` |
| `required variable POSTGRES_PASSWORD is missing` | no `.env` | `cp .env.example .env` |
| `bind` / `port is already allocated` | see [Port conflicts](#port-conflicts) | |

4. Retry with `docker compose up -d` (or `docker compose --profile monitoring up -d` if you use Prometheus). This keeps
   your data and is safe to repeat. Do not delete volumes as a first response; `docker compose down` (without `-v`)
   is enough to stop the stack.

If the original password is truly lost and you accept losing all monitors and the seeded demo data, `docker compose
down -v` (or `make down V=1`) deletes the `pgdata` and `redisdata` volumes for this project. This cannot be undone.
Run it only on a throwaway demo stack, never on one holding data you want to keep.

## Demo email does not show up in Mailpit
Mailpit (http://localhost:8025) is the inbox for the stack's SMTP server. It is empty after a fresh start: nothing is
sent until a notification fires.

1. **Is Mailpit up?** `docker compose ps mailpit` should say `(healthy)`. The inbox can also be read as JSON:
   `curl http://localhost:8025/api/v1/messages`.
2. **Is there an email channel?** In Settings, add an email channel and use **Send test**. A message titled
   `INCIDENT: Test monitor` should appear in Mailpit within a couple of seconds. If **Send test** shows
   `Delivery failed: ...`, the API could not reach the mail server: check `docker compose logs --tail=100 backend`
   and that `.env` still has `SMTP_HOST=mailpit` and `SMTP_PORT=1025` (not `localhost`, which inside a container is
   the container itself).
3. **Test alerts work but incident alerts do not?** Alerts are sent by the `worker`, and checks are queued by the
   `scheduler`. Look at `docker compose logs --tail=100 worker scheduler`, and confirm that `worker` and `scheduler`
   are `Up`.
4. **Check the monitor.** It must target `http://demo-service:9000/switch` (not `localhost`) and be enabled with
   your email channel selected. With the walk-through settings (every 30 s, open after 2 failures) allow about a
   minute after **Make it fail**.
5. After editing `.env`, recreate the services that read it so they pick the change up:
   `docker compose up -d --force-recreate backend worker`.

Still stuck? Open an issue with the output of `docker compose ps -a` and the relevant `docker compose logs` lines.
Remove passwords and other secrets first.
