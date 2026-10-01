.PHONY: dev down test test-backend test-frontend lint format migrate seed build e2e logs help lock

help: ## List commands
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

.env:
	cp .env.example .env

dev: .env ## Start everything with Docker (UI :3000, API :8000, mail :8025, demo target :9000)
	docker compose up --build

down: ## Stop containers (add V=1 to also delete data volumes)
	docker compose down $(if $(V),-v,)

migrate: ## Apply database migrations
	docker compose run --rm migrate alembic upgrade head

seed: ## Load demo data (demo@example.com / demo-password-123)
	docker compose run --rm -e DEMO_TARGET_URL=http://demo-service:9000 migrate python -m app.seed

test: test-backend test-frontend ## Run all tests

test-backend: ## Backend tests (needs local Postgres db `monitor_test` and Redis; see README)
	cd backend && .venv/bin/pytest -p no:warnings

test-frontend:
	cd frontend && npm test

e2e: ## Browser end-to-end test against the running stack
	cd frontend && npx playwright test

lint: ## Lint and type-check everything
	cd backend && .venv/bin/ruff check . ../worker && .venv/bin/ruff format --check . ../worker && MYPYPATH=.:.. .venv/bin/mypy app ../worker
	cd frontend && npm run lint && npm run typecheck

format:
	cd backend && .venv/bin/ruff check . ../worker --fix && .venv/bin/ruff format . ../worker

build: ## Build all Docker images
	docker compose build

logs:
	docker compose logs -f --tail=100

lock: ## Re-compile the pinned, hashed Python lock files on Python 3.12 (the version Docker and CI use)
	docker run --rm -v "$$PWD/backend":/work -w /work python:3.12-slim sh -c '\
	  pip install -q --disable-pip-version-check pip-tools && \
	  pip-compile -q --generate-hashes --strip-extras --allow-unsafe -o requirements.txt requirements.in && \
	  pip-compile -q --generate-hashes --strip-extras --allow-unsafe -o requirements-dev.txt requirements-dev.in'
