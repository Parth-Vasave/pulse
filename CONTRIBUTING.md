# Contributing to Pulse

Thanks for helping improve Pulse! This guide gets you from zero to your
first pull request. For setup details, the README is the single source of
truth, so this guide links to it instead of repeating commands.

## 1. Find an issue

1. Browse the [issues](../../issues) and filter by the `good first issue`
   or `documentation` label.
2. Read the issue and its comments to check nobody else is working on it.
3. Comment "I'd like to work on this" and wait to be assigned.

## 2. Set up the project

1. Fork the repo and clone your fork.
2. Follow the [Quick start (Docker)](README.md#quick-start-docker) to start
   the demo stack. To run without Docker, see
   [Local development without Docker](README.md#local-development-without-docker).
3. Open http://localhost:3000 and log in with the seeded demo user to
   confirm everything works.

Useful docs while you explore:
- [Architecture](docs/ARCHITECTURE.md): service layout and incident state machine
- [API](docs/API.md): endpoints
- [Security](docs/SECURITY.md): SSRF, encryption, tenancy rules

## 3. Make a focused change

1. Create a branch from `main`:
   `git checkout -b my-change`
2. Keep the change small: one issue, one pull request.
3. Pick the tests closest to your change:
   - **Backend** (`backend/`, `worker/`): add or update a pytest test.
     Backend tests need the `monitor_test` Postgres database and Redis;
     see [Testing](README.md#testing).
   - **Frontend** (`frontend/`): add or update a Vitest test next to the
     component or hook you changed.
4. Run the checks before pushing:

       make test    # backend + frontend tests
       make lint    # ruff, mypy, eslint, tsc

   `make e2e` runs the Playwright browser tests against the running stack
   (only needed for UI-flow changes).
5. Never commit secrets: keep real keys in your local `.env`, which must
   not be committed.

## 4. Open a pull request

1. Push your branch to your fork and open a PR against `main`.
2. Describe what you changed and why, and link the issue
   (for example `Closes #58`).
3. CI runs lint, type checks, tests, migrations and audits on every PR.
   Fix any failures by pushing more commits to the same branch.
4. Respond to review comments; a maintainer will merge once it's ready.

## Reporting bugs

Open an issue with steps to reproduce, expected behavior and actual
behavior. For security problems, follow the repository's security policy
instead of opening a public issue.
