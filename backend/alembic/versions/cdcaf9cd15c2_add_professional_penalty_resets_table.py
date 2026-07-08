"""add professional_penalty_resets table

Revision ID: cdcaf9cd15c2
Revises: 45d8846d6772
Create Date: 2026-07-03 18:44:14.771310

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cdcaf9cd15c2'
down_revision: Union[str, Sequence[str], None] = '45d8846d6772'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'professional_penalty_resets',
        sa.Column('professional_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('reset_at', sa.DateTime(), nullable=False),
        sa.Column('reset_by_admin_id', sa.UUID(as_uuid=False), nullable=True),
        sa.ForeignKeyConstraint(['professional_id'], ['professionals.id'], ),
        sa.ForeignKeyConstraint(['reset_by_admin_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('professional_id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('professional_penalty_resets')