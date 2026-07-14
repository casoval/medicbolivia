"""professional_memberships.period_label pasa a opcional (nota libre del admin)

period_label ya no es obligatorio ni tiene semántica funcional (la
vigencia siempre la deciden starts_at/ends_at) — ahora es solo texto
libre para que el admin identifique la fila en el historial. Se
amplía el largo de 20 a 60 para permitir notas un poco más
descriptivas.

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "i3j4k5l6m7n8"
down_revision = "h2i3j4k5l6m7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "professional_memberships",
        "period_label",
        existing_type=sa.String(length=20),
        type_=sa.String(length=60),
        nullable=True,
    )


def downgrade() -> None:
    # No se puede volver a NOT NULL sin decidir qué poner en las filas
    # que hayan quedado con period_label NULL, así que se rellenan con
    # un placeholder antes de reimponer la restricción.
    op.execute(
        "UPDATE professional_memberships SET period_label = '(sin período)' WHERE period_label IS NULL"
    )
    op.alter_column(
        "professional_memberships",
        "period_label",
        existing_type=sa.String(length=60),
        type_=sa.String(length=20),
        nullable=False,
    )
