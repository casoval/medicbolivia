"""add refunded_amount to payments

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Antes de esto, un reembolso PARTIAL solo quedaba registrado en el
    # AuditLog (metadata_) — el propio Payment no guardaba cuánto se
    # devolvió realmente, solo el monto original de la consulta.
    op.add_column('payments', sa.Column('refunded_amount', sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('payments', 'refunded_amount')
