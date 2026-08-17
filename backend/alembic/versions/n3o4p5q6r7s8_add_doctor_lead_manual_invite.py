"""add doctor_leads.last_manual_invite_at

Revision ID: n3o4p5q6r7s8
Revises: h8i9j0k1l2m3
Create Date: 2026-08-16 00:00:00.000000

Soporta la invitación manual de médicos: el admin genera el mensaje +
PDF para copiar/pegar y enviar él mismo por WhatsApp (en vez de que la
plataforma lo mande automáticamente), porque los envíos automáticos a
números no registrados empezaron a marcarse como spam y llevaron a un
baneo del número. Este campo no reemplaza a last_invite_status (que se
deriva de whatsapp_messages): una invitación manual no genera ningún
WhatsAppMessage porque no hay envío real desde la plataforma.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'n3o4p5q6r7s8'
down_revision: Union[str, Sequence[str], None] = 'h8i9j0k1l2m3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('doctor_leads', sa.Column('last_manual_invite_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('doctor_leads', 'last_manual_invite_at')
