"""The migrations are what real databases run; the tests build tables from the models. These tests make
sure the two cannot drift apart, and that every migration can be rolled back."""

import json

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (register every table on Base.metadata)
from alembic import command
from app.core.config import get_settings
from app.core.database import Base
from app.models import Monitor, NotificationChannel, User

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


def test_secrets_migration_encrypts_existing_plaintext_rows_and_can_be_reversed(scratch_url):
    """Real databases hold plaintext headers/webhook URLs from before 0003; upgrading must protect them."""
    from app.core.crypto import is_envelope

    cfg = _alembic_config(scratch_url)
    command.upgrade(cfg, "0002")
    engine = create_engine(scratch_url)
    headers, hook = {"Authorization": "Bearer legacy-secret"}, {"url": "https://hooks.example.com/legacy-secret"}
    # 0003 changes data, not schema, so the ORM can create the rows; the secrets are then forced back to plaintext.
    with Session(engine) as session:
        user = User(email="m@example.com", password_hash="x")
        session.add(user)
        session.flush()
        mon_a = Monitor(user_id=user.id, name="a", url="https://a.example.com")
        mon_b = Monitor(user_id=user.id, name="b", url="https://b.example.com")
        chan = NotificationChannel(user_id=user.id, type="webhook", name="w")
        session.add_all([mon_a, mon_b, chan])
        session.commit()
        ids = (mon_a.id, mon_b.id, chan.id)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE monitors SET headers = CAST(:h AS jsonb) WHERE id = :i"),
            {"h": json.dumps(headers), "i": ids[0]},
        )
        conn.execute(
            text("UPDATE notification_channels SET configuration = CAST(:c AS jsonb) WHERE id = :i"),
            {"c": json.dumps(hook), "i": ids[2]},
        )

    def stored():
        with engine.connect() as conn:
            h = conn.execute(text("SELECT headers FROM monitors ORDER BY id")).scalars().all()
            c = conn.execute(text("SELECT configuration FROM notification_channels")).scalar_one()
        return h, c

    command.upgrade(cfg, "head")
    h, c = stored()
    assert is_envelope(h[0]) and h[1] == {} and is_envelope(c)
    assert "legacy-secret" not in str(h) + str(c)

    command.downgrade(cfg, "0002")
    assert stored() == ([headers, {}], hook)
    engine.dispose()


def test_retries_migration_fits_existing_checks_into_their_interval(scratch_url):
    """Rows saved before the timeout x attempts <= interval rule must stay editable, so 0004 lowers their retries."""
    cfg = _alembic_config(scratch_url)
    command.upgrade(cfg, "0003")
    engine = create_engine(scratch_url)
    # (timeout, retries, interval) -> retries after the migration
    cases = {
        (30, 3, 30): 0,  # every retry overruns
        (10, 3, 30): 1,  # 10 x 2 + 1 = 21 fits; 10 x 3 + 3 = 33 doesn't
        (10, 3, 60): 3,  # 10 x 4 + 7 = 47 already fits
        (5, 0, 30): 0,
    }
    with Session(engine) as session:
        user = User(email="r@example.com", password_hash="x")
        session.add(user)
        session.flush()
        session.add_all(
            Monitor(
                user_id=user.id,
                name=f"m{i}",
                url="https://a.example.com",
                timeout_seconds=t,
                check_retries=r,
                interval_seconds=iv,
            )
            for i, (t, r, iv) in enumerate(cases)
        )
        session.commit()

    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        retries = conn.execute(text("SELECT check_retries FROM monitors ORDER BY id")).scalars().all()
    assert retries == list(cases.values())
    engine.dispose()
