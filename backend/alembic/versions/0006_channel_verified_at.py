"""record when a notification channel's destination was confirmed by its owner

Email channels now start unverified and receive nothing until the recipient follows a confirmation link, so an
account can no longer make Pulse mail arbitrary inboxes. Channels that already exist were created under the old
rules and are treated as verified (verified_at = created_at), so upgrading never silently stops anyone's alerts.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa

from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('notification_channels', sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE notification_channels SET verified_at = created_at")


def downgrade() -> None:
    op.drop_column('notification_channels', 'verified_at')
