"""add contact inquiries table

Revision ID: a8b9c0d1e2f3
Revises: d4e5f6a7b8c9
Create Date: 2026-07-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'contact_inquiries',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('full_name', sa.String(length=200), nullable=False),
        sa.Column('city', sa.String(length=100), nullable=True),
        sa.Column('country', sa.String(length=100), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('inquiry_type', sa.String(length=30), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('email_sent', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_contact_inquiries_created_at', 'contact_inquiries', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_contact_inquiries_created_at', table_name='contact_inquiries')
    op.drop_table('contact_inquiries')
