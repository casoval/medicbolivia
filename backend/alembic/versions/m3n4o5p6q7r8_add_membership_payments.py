"""add membership_payments (ledger de cobros de cuota de membresía)

ProfessionalMembership es el estado de VIGENCIA de la membresía (una fila
se estira al renovar — ver admin.renew_membership, que solo mueve
ends_at hacia adelante), no el historial de COBROS. Hasta ahora no
existía ningún registro estructurado de cuánto se le cobraba al
profesional por la membresía — el docstring original del modelo decía
literalmente "no hay cobro recurrente automatizado dentro de la
plataforma... el admin lleva el registro del pago mes a mes por fuera".

Esta tabla no automatiza el cobro (sigue siendo manual, por fuera de la
plataforma), pero le da un lugar estructurado al monto: una fila por
cada alta o renovación, en vez de perderse en el campo de texto libre
`note`. Con esto, admin/stats puede calcular un "ingreso por membresías
del mes" real — hasta ahora esa línea de ingresos era completamente
invisible para el sistema, aunque un profesional con membresía activa sí
le paga a la plataforma (solo que no vía comisión, que queda en 0%).

Revision ID: m3n4o5p6q7r8
Revises: a3b4c5d6e7f8
Create Date: 2026-08-08
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'm3n4o5p6q7r8'
down_revision: Union[str, Sequence[str], None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS membership_payments (
            id UUID PRIMARY KEY,
            membership_id UUID NOT NULL REFERENCES professional_memberships(id) ON DELETE CASCADE,
            professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
            fee_amount NUMERIC(10, 2) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'BOB',
            payment_reference VARCHAR(100),
            months_covered INTEGER NOT NULL DEFAULT 1,
            paid_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            recorded_by_admin_id UUID REFERENCES users(id),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
    """)

    # Acelera "membresías de este profesional" (perfil / historial) y la
    # suma de admin/stats por rango de fechas (paid_at >= month_start).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_membership_payments_membership_id "
        "ON membership_payments(membership_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_membership_payments_professional_id "
        "ON membership_payments(professional_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_membership_payments_paid_at "
        "ON membership_payments(paid_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_membership_payments_paid_at")
    op.execute("DROP INDEX IF EXISTS ix_membership_payments_professional_id")
    op.execute("DROP INDEX IF EXISTS ix_membership_payments_membership_id")
    op.execute("DROP TABLE IF EXISTS membership_payments")
