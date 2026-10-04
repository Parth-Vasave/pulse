"""Re-encrypt every stored secret under the primary ENCRYPTION_KEY (the first one listed).

    ENCRYPTION_KEY=<new>,<old> python -m app.rotate_keys

Safe to re-run. Once it reports 0 failures, drop the old key from ENCRYPTION_KEY.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection

from app.core.crypto import ENVELOPE_KEY, is_envelope, rotate_token
from app.core.database import engine

# Plain JSONB views of the encrypted columns, so values are read and written as raw envelopes.
TARGETS = (
    sa.table("monitors", sa.column("id", sa.Integer), sa.column("headers", JSONB)),
    sa.table("notification_channels", sa.column("id", sa.Integer), sa.column("configuration", JSONB)),
)


def rotate_all(conn: Connection) -> int:
    """Rotate all envelopes in place; returns how many rows were rewritten."""
    rotated = 0
    for table in TARGETS:
        secret = table.c[1]
        for row_id, value in conn.execute(sa.select(table.c.id, secret)).all():
            if not is_envelope(value):
                continue
            new = {ENVELOPE_KEY: rotate_token(value[ENVELOPE_KEY])}
            conn.execute(sa.update(table).where(table.c.id == row_id).values({secret.name: new}))
            rotated += 1
    return rotated


if __name__ == "__main__":
    with engine.begin() as connection:
        print(f"re-encrypted {rotate_all(connection)} rows")
