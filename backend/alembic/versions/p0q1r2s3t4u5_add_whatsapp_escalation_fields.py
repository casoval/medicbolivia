"""add whatsapp conversation escalation fields

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-07-18 00:00:00.000000

Agrega needs_admin_attention y escalation_reason a whatsapp_conversations,
para que el agente de WhatsApp pueda derivar a administración (sugerencias,
propuestas de negocio, reclamos que no puede resolver) y esa conversación
quede marcada/destacada en el inbox del panel admin — ver
[ESCALATE_ADMIN:...] en app/agents/coordinator.py::WHATSAPP_SYSTEM.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'p0q1r2s3t4u5'
down_revision: Union[str, Sequence[str], None] = 'o9p0q1r2s3t4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'whatsapp_conversations',
        sa.Column('needs_admin_attention', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'whatsapp_conversations',
        sa.Column('escalation_reason', sa.String(length=300), nullable=True),
    )
    # El server_default cumple su función solo para las filas existentes al
    # migrar; no lo dejamos como default permanente en el modelo porque
    # SQLAlchemy ya maneja el default=False en la capa de aplicación.
    op.alter_column('whatsapp_conversations', 'needs_admin_attention', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('whatsapp_conversations', 'escalation_reason')
    op.drop_column('whatsapp_conversations', 'needs_admin_attention')
