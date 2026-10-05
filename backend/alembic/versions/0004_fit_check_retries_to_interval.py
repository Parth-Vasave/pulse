"""lower check_retries where a check could outlast its interval

Monitors must now satisfy timeout x (retries + 1) + retry backoff <= interval (see MonitorCreate). Older rows may
not, and since PATCH re-validates the whole configuration they could no longer be edited, or even paused. Retries
are lowered until each check fits; 0 retries always fits because timeout (<= 30 s) never exceeds interval (>= 30 s).
Downgrade is a no-op: the lowered values are valid under both rules.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa

from alembic import op

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None

# Total backoff before the last attempt for 1, 2, 3 retries (1 s, 2 s, 4 s), frozen here so the migration
# doesn't change if the app's constants do.
BACKOFF_TOTAL = {1: 1, 2: 3, 3: 7}


def upgrade() -> None:
    # Highest retry count first, so a row lowered from 3 to 2 is re-checked at 2.
    for retries in (3, 2, 1):
        op.execute(
            sa.text(
                "UPDATE monitors SET check_retries = :lower"
                " WHERE check_retries = :retries"
                " AND timeout_seconds * (:retries + 1) + :backoff > interval_seconds"
            ).bindparams(lower=retries - 1, retries=retries, backoff=BACKOFF_TOTAL[retries])
        )


def downgrade() -> None:
    pass
