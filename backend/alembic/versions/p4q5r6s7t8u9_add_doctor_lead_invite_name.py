"""add doctor_leads.invite_name

Revision ID: p4q5r6s7t8u9
Revises: n3o4p5q6r7s8
Create Date: 2026-08-17 00:00:00.000000

Nombre corregido a mano para usar en el saludo de la invitación (mensaje
y PDF) cuando full_name trae datos extra pegados (frecuente en resultados
de Google Places: "Medicina Interna - Dr. Jorge Pérez - La Paz"). Si queda
vacío, la invitación sigue usando full_name como hasta ahora — ver
_lead_invite_name() en app/api/v1/endpoints/admin.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'p4q5r6s7t8u9'
down_revision: Union[str, Sequence[str], None] = 'n3o4p5q6r7s8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('doctor_leads', sa.Column('invite_name', sa.String(length=200), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('doctor_leads', 'invite_name')
