"""add commission_periods table and commission_percent_applied columns

Agrega el sistema de comisión por período y por profesional:

- commission_periods: filas con % + rango de vigencia (starts_at/ends_at),
  con scope GLOBAL (toda la plataforma, ej. promo "10% este mes") o
  PROFESSIONAL (un profesional puntual, ej. "5% los primeros 3 meses para
  un profesional nuevo"). El % individual gana sobre el global si ambos
  están vigentes al mismo tiempo.
- consultations.commission_percent_applied / payments.commission_percent_applied:
  foto fija del % que se usó al momento de cobrar, para que cambios
  futuros de comisión no alteren consultas ya generadas y para dar
  trazabilidad/transparencia total en reportes.

Revision ID: a7b8c9d0e1f2
Revises: f9e8d7c6b5a4
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a7b8c9d0e1f2"
down_revision = "f9e8d7c6b5a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Importante: usamos LA MISMA instancia de ENUM para crearlo explícitamente
    # y para la columna, con create_type=False. Si no, create_table() crea su
    # propia instancia del tipo y, al montar la tabla, intenta emitir
    # "CREATE TYPE commissionscope" de nuevo (sin checkfirst), lo que revienta
    # con DuplicateObject porque el tipo ya existe (creado en la línea de abajo).
    commission_scope = postgresql.ENUM(
        "GLOBAL", "PROFESSIONAL", name="commissionscope", create_type=False
    )
    commission_scope.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "commission_periods",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("scope", commission_scope, nullable=False),
        sa.Column("professional_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("percent", sa.Numeric(5, 2), nullable=False),
        sa.Column("label", sa.String(150), nullable=True),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["professional_id"], ["professionals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
    )
    op.create_index(
        "ix_commission_periods_professional_id", "commission_periods", ["professional_id"]
    )
    op.create_index(
        "ix_commission_periods_scope_active", "commission_periods", ["scope", "active"]
    )

    op.add_column(
        "consultations",
        sa.Column("commission_percent_applied", sa.Numeric(5, 2), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("commission_percent_applied", sa.Numeric(5, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payments", "commission_percent_applied")
    op.drop_column("consultations", "commission_percent_applied")

    op.drop_index("ix_commission_periods_scope_active", table_name="commission_periods")
    op.drop_index("ix_commission_periods_professional_id", table_name="commission_periods")
    op.drop_table("commission_periods")

    postgresql.ENUM(name="commissionscope", create_type=False).drop(
        op.get_bind(), checkfirst=True
    )
