"""add composite index on notifications(user_id, created_at)

La tabla `notifications` (la campanita de paciente y profesional) no tenía
ningún índice sobre user_id desde que se creó. Postgres no indexa
foreign keys automáticamente, y esta tabla pasó de ser de bajo tráfico a
ser escrita por CASI todo el sistema — notify_user() (usado en chat,
recordatorios, WhatsApp, broadcast) más los ~10 sitios de
consultations.py que arman Notification() a mano — y leída en cada carga
de la campanita, en ambos roles.

Las dos queries reales (GET /me/notifications de paciente y profesional)
son exactamente:
    WHERE user_id = ? [AND read_at IS NULL] ORDER BY created_at DESC LIMIT 50

Un índice compuesto (user_id, created_at) cubre el filtro y el orden en
un solo índice, sin necesidad de un índice aparte para read_at (que solo
se usa como filtro adicional opcional, no como criterio principal).

Solo agrega un índice — no toca datos ni tipos de columna, segura de
aplicar sin downtime.

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-07-31
"""
from typing import Sequence, Union

from alembic import op


revision: str = 't4u5v6w7x8y9'
down_revision: Union[str, Sequence[str], None] = 's3t4u5v6w7x8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_notifications_user_id_created_at',
        'notifications',
        ['user_id', 'created_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_notifications_user_id_created_at', table_name='notifications')
