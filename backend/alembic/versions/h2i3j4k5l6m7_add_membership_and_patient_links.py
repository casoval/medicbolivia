"""add professional membership, patient-professional links and cash/professional-scheduled consultations

Agrega el sistema de membresía mensual del profesional:

- professional_memberships: habilitación mensual manual por admin (comisión
  0% mientras esté vigente — ver app.services.commission._has_active_membership,
  que la evalúa con MÁS prioridad que commission_periods individual/global).
  No hay cobro automático dentro de la plataforma; el admin la activa cuando
  confirma el pago por fuera.
- patient_professional_links: vínculo "Mis pacientes". Solo el paciente lo
  crea y lo revoca (nunca el profesional). Un profesional con membresía
  activa puede agendar directamente a un paciente vinculado, sin pasar por
  el flujo normal de disponibilidad/pago inmediato.
- consultations.created_by_role: quién originó la consulta (PATIENT, el
  flujo de siempre, o PROFESSIONAL, el agendamiento directo nuevo).
- payments.payment_channel: por dónde entró el cobro (PLATFORM_QR, el de
  siempre, o CASH, solo para el agendamiento directo con membresía).

Todas las columnas nuevas tienen default seguro y backfill explícito, así
que ninguna fila ni comportamiento existente cambia.

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "h2i3j4k5l6m7"
down_revision = "g1h2i3j4k5l6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Enums nuevos ──────────────────────────────────────────────────
    consultation_created_by = postgresql.ENUM(
        "PATIENT", "PROFESSIONAL", name="consultationcreatedby", create_type=False
    )
    consultation_created_by.create(op.get_bind(), checkfirst=True)

    payment_channel = postgresql.ENUM(
        "PLATFORM_QR", "CASH", name="paymentchannel", create_type=False
    )
    payment_channel.create(op.get_bind(), checkfirst=True)

    # ── consultations.created_by_role ────────────────────────────────
    op.add_column(
        "consultations",
        sa.Column(
            "created_by_role", consultation_created_by, nullable=False,
            server_default="PATIENT",
        ),
    )
    # server_default ya cubre el backfill de filas existentes; lo quitamos
    # después para que el modelo (que fija el default en Python en los
    # INSERT nuevos) sea la única fuente de verdad hacia adelante.
    op.alter_column("consultations", "created_by_role", server_default=None)

    # ── payments.payment_channel ──────────────────────────────────────
    op.add_column(
        "payments",
        sa.Column(
            "payment_channel", payment_channel, nullable=False,
            server_default="PLATFORM_QR",
        ),
    )
    op.alter_column("payments", "payment_channel", server_default=None)

    # ── professional_memberships ──────────────────────────────────────
    op.create_table(
        "professional_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("professional_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("period_label", sa.String(20), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column("enabled_by_admin_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["professional_id"], ["professionals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["enabled_by_admin_id"], ["users.id"]),
    )
    op.create_index(
        "ix_professional_memberships_professional_id",
        "professional_memberships", ["professional_id"],
    )
    # Índice pensado para la query de _has_active_membership: buscar la
    # membresía activa vigente de un profesional en un instante dado.
    op.create_index(
        "ix_professional_memberships_active_lookup",
        "professional_memberships", ["professional_id", "active", "starts_at", "ends_at"],
    )

    # ── patient_professional_links ────────────────────────────────────
    op.create_table(
        "patient_professional_links",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("professional_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["professional_id"], ["professionals.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_patient_professional_links_patient_id",
        "patient_professional_links", ["patient_id"],
    )
    op.create_index(
        "ix_patient_professional_links_professional_id",
        "patient_professional_links", ["professional_id"],
    )
    # Búsqueda típica: "¿este paciente tiene un vínculo activo con este
    # profesional?" (revoked_at IS NULL) — ver app.services.patient_links.get_active_link
    op.create_index(
        "ix_patient_professional_links_active_lookup",
        "patient_professional_links", ["patient_id", "professional_id", "revoked_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_patient_professional_links_active_lookup", table_name="patient_professional_links")
    op.drop_index("ix_patient_professional_links_professional_id", table_name="patient_professional_links")
    op.drop_index("ix_patient_professional_links_patient_id", table_name="patient_professional_links")
    op.drop_table("patient_professional_links")

    op.drop_index("ix_professional_memberships_active_lookup", table_name="professional_memberships")
    op.drop_index("ix_professional_memberships_professional_id", table_name="professional_memberships")
    op.drop_table("professional_memberships")

    op.drop_column("payments", "payment_channel")
    op.drop_column("consultations", "created_by_role")

    postgresql.ENUM(name="paymentchannel", create_type=False).drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="consultationcreatedby", create_type=False).drop(op.get_bind(), checkfirst=True)
