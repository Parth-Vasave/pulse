"""encrypt monitor headers and notification channel configuration at rest

The columns stay JSONB; each non-empty value is replaced by an encryption envelope (see app.core.crypto).
Downgrade decrypts back to plain JSON, so it needs the same ENCRYPTION_KEY.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op
from app.core.crypto import ENVELOPE_KEY, decrypt_json, encrypt_json, is_envelope

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

# Plain JSONB views of the columns, independent of the models, so this migration keeps working as they evolve.
TARGETS = (
    sa.table("monitors", sa.column("id", sa.Integer), sa.column("headers", JSONB)),
    sa.table("notification_channels", sa.column("id", sa.Integer), sa.column("configuration", JSONB)),
)


def _convert(convert) -> None:
    conn = op.get_bind()
    for table in TARGETS:
        secret = table.c[1]
        for row_id, value in conn.execute(sa.select(table.c.id, secret)).all():
            new = convert(value)
            if new is not value:
                conn.execute(sa.update(table).where(table.c.id == row_id).values({secret.name: new}))


def _encrypt(value):
    if not value or is_envelope(value):
        return value
    return {ENVELOPE_KEY: encrypt_json(value)}


def _decrypt(value):
    return decrypt_json(value[ENVELOPE_KEY]) if is_envelope(value) else value


def upgrade() -> None:
    _convert(_encrypt)


def downgrade() -> None:
    _convert(_decrypt)
