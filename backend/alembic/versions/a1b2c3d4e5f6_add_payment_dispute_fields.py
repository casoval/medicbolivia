"""add payment dispute fields

Revision ID: a1b2c3d4e5f6
Revises: cdcaf9cd15c2
Create Date: 2026-07-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'cdcaf9cd15c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('payments', sa.Column('dispute_category', sa.String(length=50), nullable=True))
    op.add_column('payments', sa.Column('dispute_reason', sa.Text(), nullable=True))
    op.add_column('payments', sa.Column('disputed_at', sa.DateTime(), nullable=True))
    op.add_column('payments', sa.Column('resolution_note', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('payments', 'resolution_note')
    op.drop_column('payments', 'disputed_at')
    op.drop_column('payments', 'dispute_reason')
    op.drop_column('payments', 'dispute_category')
