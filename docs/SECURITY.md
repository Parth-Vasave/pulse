# Security

## Authentication
- Passwords hashed with **Argon2id** (`argon2-cffi` defaults). Never stored or logged in plaintext.
- Sessions are a signed JWT (HS256, `sub`, `exp`, `jti`) in an **HttpOnly, SameSite=Lax** cookie (`Secure` when `COOKIE_SECURE=true`). JavaScript can't read it, which removes the main XSS token-theft path.
- Logout clears the cookie. Tokens are stateless, so a stolen token stays valid until expiry (`ACCESS_TOKEN_MINUTES`) unless the password changes.
- **Password change signs out other sessions.** Every token carries a *credential version* (`pwv`, derived from `users.password_changed_at` in milliseconds). A token whose version doesn't match the user's current one is rejected, so a changed password invalidates all previously issued tokens, with no denylist and no dependence on clock resolution (tested by logging in from a second client). The changing session gets a fresh cookie. API keys are independent and must be revoked separately.
- **Sensitive account actions re-authenticate.** Changing email or password and deleting the account all require the current password, so a hijacked session alone can't take over or destroy the account. A wrong password returns `403` (the session is still valid), and these endpoints use the strict auth rate limit to throttle password guessing through a stolen session.
- Deleting an account is immediate and permanent; the database cascades to every owned row (tested, including that other users' data is untouched).
- Login returns one generic error for unknown email and wrong password, and verifies against a dummy hash for unknown emails, so neither the message nor the timing reveals which accounts exist. (Registration does reveal a taken email via `409`; that is a deliberate usability trade-off.)
- **API keys** (`Authorization: Bearer apm_…`): 256-bit random, shown once, stored only as a SHA-256 hash (a slow KDF adds nothing for high-entropy secrets). Revocable; `last_used_at` tracked.
- CSRF: cookie auth with `SameSite=Lax`, JSON-only bodies, and CORS restricted to `CORS_ORIGINS` (credentials allowed only for those). Cross-site requests don't carry the cookie.

## Authorization / multi-tenancy
Enforced in the backend on every request; the UI is not trusted. Resources are looked up *with* the owner's id (`WHERE id=? AND user_id=?`), and foreign IDs return `404`. Covered by `tests/api/test_isolation.py` for monitors, checks, stats, incidents, channels and API keys.

## SSRF prevention
Monitors and webhooks make the server fetch user-supplied URLs, the classic SSRF vector (e.g. `http://169.254.169.254/` cloud metadata, `http://localhost:5432`, internal admin panels).

Blocked: non-`http(s)` schemes, URLs with embedded credentials, `localhost` and `*.localhost/.internal/.local`, cloud metadata hostnames, and any address that is private (RFC 1918, ULA), loopback, link-local (incl. `169.254.169.254`, `fe80::/10`), multicast, reserved, unspecified, CGNAT `100.64/10` or benchmarking ranges. IPv4-mapped (`::ffff:127.0.0.1`) and 6to4 IPv6 forms are unwrapped and re-checked, so they can't smuggle a blocked IPv4 past the filter.

Layers:
1. **Creation-time** validation (`validate_url`) for fast feedback. Every address a hostname resolves to must pass; one bad record rejects it.
2. **Connect-time** guard (`GuardedBackend`, installed in the HTTP client's network layer). Each connection re-resolves the name, validates all addresses, then connects to the *validated IP itself* with SNI/cert checks still on the original hostname. There is no gap between "check" and "use", which defeats **DNS rebinding** (a hostname that resolved publicly at creation but privately later). Tested with a stub resolver returning `169.254.169.254`.
3. **Redirects are never followed**, so a public host cannot bounce a check to an internal one. A `302` is simply an unexpected status.
4. Proxy environment variables are ignored (`trust_env=False`).

Dev-only escape hatch: `SSRF_ALLOWED_HOSTS` is a list of exact hostnames exempt from the IP rules, used to monitor the bundled `demo-service` on the Docker network. **Leave it empty in production.**

Not covered: port restrictions (a user may probe public hosts' ports) and egress-network policy. For production, also run workers in a network segment with no route to internal services.

## Input validation
Pydantic validates every request: URL scheme/length, method allow-list, timeout 1–30 s, interval 30 s–24 h, status 100–599, thresholds 1–10, ≤20 headers (no CR/LF, `Host`/`Content-Length`/`Transfer-Encoding`/`Connection` forbidden), body ≤64 KB (GET can't have one), ≤10 assertions with a discriminated-union schema. PATCH merges then re-validates the whole config, so PATCH can't create what POST would reject. Per-user caps on monitors, channels and keys. SQL injection is prevented by SQLAlchemy parameterised queries (no string-built SQL; the few `literal_column` uses interpolate server-side integer constants only).

## Rate limiting and request limits
Redis sliding-window-counter limiter per client IP (atomic Lua script, so a crash can't leave a counter without a TTL): `RATE_LIMIT_PER_MINUTE` (default 120) overall and `AUTH_RATE_LIMIT_PER_MINUTE` (default 10) on login/register → `429` with `Retry-After`. If Redis is down it falls back to a per-process limiter (logged) rather than failing open. Behind a proxy, set `TRUST_PROXY_HEADERS=true` *only* if the proxy appends to `X-Forwarded-For`; the client is taken as the `TRUSTED_PROXY_COUNT`-th entry from the right (default 1), so client-supplied left-hand entries can't spoof it. Bodies over 256 KB get `413` (also enforced for chunked uploads).

## Headers and transport
API: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy: default-src 'none'` (not on `/docs`), and HSTS when `COOKIE_SECURE=true`. The Next.js app sets nosniff/frame/referrer headers. Terminate TLS in front of both in production.

## Secrets and logging
**Audit (October 2026):** the working tree and all pushed history were scanned with `gitleaks` (no findings; the only hits were Next.js build IDs in the gitignored `.next/` folder) plus a pattern search for cloud keys, tokens, private keys, webhooks and URL-embedded credentials. The only credential-like strings are labelled placeholders and test fixtures. CI now runs `gitleaks` on every push.

**Because this repository is public, its placeholder values are public.** `ENVIRONMENT=production` makes the app **refuse to start** if `SECRET_KEY` still contains a placeholder marker (`dev-only`, `change-me`, …); otherwise anyone could forge login tokens. The demo account (`demo@example.com`) exists only when `SEED_DEMO_DATA=true`; keep that off outside local development.

A root `.dockerignore` keeps `.env` files, `.venv`, `node_modules`, `.next` and `.git` out of every image (before it existed, a local `backend/.env` and a 250 MB virtualenv were being copied into the backend image).

No secrets in git: `.env` is ignored, `.env.example` holds clearly-marked dev placeholders. `SECRET_KEY` must be ≥32 chars; generate a real one. Logs are structured JSON, and any field whose name contains password/token/authorization/api_key/secret/cookie/headers is replaced with `[REDACTED]`. Monitor request headers (often credentials) are never logged. API responses mask webhook URLs to host only, because their paths carry secrets. The public status page returns only names, coarse state and incident times: no URLs, headers, bodies or failure reasons.

## Known limitations
No email verification or password reset (so changing email isn't verified by the new address); no MFA; no per-session revocation list (a stolen token is invalidated only by a password change or expiry); monitor `headers`/webhook URLs are stored unencrypted in Postgres (encrypt at rest or use a KMS for production); login rate limiting is per-IP rather than per-account.
