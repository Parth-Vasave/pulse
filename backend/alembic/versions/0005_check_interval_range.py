"""guarantee monitor intervals stay within 30 s .. 24 h

The time-weighted stats bound each scan by the longest interval a monitor can have; a row past it would have
its checks silently dropped from availability. The API already refuses such intervals, so this only makes the
database guarantee it. Rows written around the API are clamped first: checking more or less often is harmless,
and both bounds keep 0004's rule satisfied (timeout x 4 + 7 s <= 127 s at most; 0 retries fits at 30 s).
Downgrade drops the constraint and leaves the clamped values, which are valid either way.

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa

from alembic import op

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None

# Frozen here so the migration doesn't change if the app's constants do.
MIN_INTERVAL, MAX_INTERVAL = 30, 86_400


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE monitors SET interval_seconds = LEAST(GREATEST(interval_seconds, :lo), :hi)"
            " WHERE interval_seconds NOT BETWEEN :lo AND :hi"
        ).bindparams(lo=MIN_INTERVAL, hi=MAX_INTERVAL)
    )
    op.create_check_constraint(
        "ck_monitors_interval_range", "monitors", f"interval_seconds BETWEEN {MIN_INTERVAL} AND {MAX_INTERVAL}"
    )


def downgrade() -> None:
    op.drop_constraint("ck_monitors_interval_range", "monitors", type_="check")
