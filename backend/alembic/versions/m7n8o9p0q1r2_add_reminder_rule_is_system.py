"""add is_system flag to reminder_rules

Marca las 12 reglas fijas del catálogo de recordatorios (ver
app/db/seed_system_reminders.py) para distinguirlas de las reglas libres
que un admin puede crear a mano. Las reglas is_system=True se siembran
solas al arrancar el backend (lifespan en app/main.py) — esta migración
solo agrega la columna, no inserta filas.

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

revision = "m7n8o9p0q1r2"
down_revision = "l6m7n8o9p0q1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reminder_rules",
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("reminder_rules", "is_system", server_default=None)


def downgrade() -> None:
    op.drop_column("reminder_rules", "is_system")
