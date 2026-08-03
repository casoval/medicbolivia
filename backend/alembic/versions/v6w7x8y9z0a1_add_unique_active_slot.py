"""add unique index to prevent professional double-booking

Condición de carrera encontrada al revisar el agendamiento: dos pacientes
distintos podían terminar con una cita confirmada para el mismo
profesional en el mismo scheduled_at si sus requests de POST
/consultations corrían casi en simultáneo (típico en un horario popular
que varios pacientes ven "disponible" al mismo tiempo). La validación en
create_consultation (compute_available_slots) solo LEE las citas
existentes antes de escribir — no alcanza bajo concurrencia real.

Este índice único parcial es la última línea de defensa: cubre solo los
estados donde la cita "ocupa" de verdad el horario del profesional (si
está cancelada/reembolsada/completada, ese mismo horario debería poder
volver a reservarse). Si dos requests corren la carrera, el segundo
INSERT falla acá — el backend ya captura ese error puntual en
consultations.py::create_consultation y devuelve un 409 claro en vez de
dejar pasar la doble reserva.

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-08-02
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'v6w7x8y9z0a1'
down_revision: Union[str, Sequence[str], None] = 'u5v6w7x8y9z0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS por si ya se corrió a mano en algún ambiente — mismo
    # criterio idempotente que el resto de las migraciones de este repo.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_professional_active_slot
        ON consultations (professional_id, scheduled_at)
        WHERE status IN (
            'WAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'PROFESSIONAL_ACCEPTED',
            'WAITING_PROFESSIONAL', 'IN_PROGRESS'
        )
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_professional_active_slot")
