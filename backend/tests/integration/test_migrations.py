"""The migrations are what real databases run; the tests build tables from the models. These tests make
sure the two cannot drift apart, and that every migration can be rolled back."""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

import app.models  # noqa: F401  (register every table on Base.metadata)
from alembic import command
from app.core.config import get_settings
from app.core.database import Base

SCRATCH_DB = "monitor_migration_check"


def _alembic_config(url: str) -> Config:
    cfg = Config("alembic.ini")
    cfg.set_main_option("script_location", "alembic")
    cfg.attributes["url"] = url
    return cfg


@pytest.fixture
def scratch_url():
    """A brand-new empty database, so migrations run exactly as they would on a fresh install."""
    base = make_url(get_settings().database_url)
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{SCRATCH_DB}"'))
    yield base.set(database=SCRATCH_DB).render_as_string(hide_password=False)
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}" WITH (FORCE)'))
    admin.dispose()


def test_there_is_a_single_migration_head():
    heads = ScriptDirectory.from_config(_alembic_config("unused")).get_heads()
    assert len(heads) == 1, f"branched migration history: {heads}"


def test_migrations_produce_exactly_the_schema_the_models_describe(scratch_url):
    command.upgrade(_alembic_config(scratch_url), "head")
    engine = create_engine(scratch_url)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True, "compare_server_default": False})
        diff = compare_metadata(ctx, Base.metadata)
    engine.dispose()
    assert diff == [], f"models and migrations disagree; run `alembic revision --autogenerate`:\n{diff}"


def test_every_migration_can_be_rolled_back_and_reapplied(scratch_url):
    cfg = _alembic_config(scratch_url)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    engine = create_engine(scratch_url)
    left = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert left == set(), f"downgrade left tables behind: {left}"
    command.upgrade(cfg, "head")
    assert {"users", "monitors", "check_results", "incidents"} <= set(inspect(engine).get_table_names())
    engine.dispose()


def test_partial_indexes_that_enforce_invariants_exist_after_migrating(scratch_url):
    """The one-open-incident-per-monitor guarantee lives in a migration, not in application code."""
    command.upgrade(_alembic_config(scratch_url), "head")
    engine = create_engine(scratch_url)
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_incidents_one_open_per_monitor'")
        ).scalar_one()
    engine.dispose()
    assert "UNIQUE" in row and "status" in row and "open" in row
