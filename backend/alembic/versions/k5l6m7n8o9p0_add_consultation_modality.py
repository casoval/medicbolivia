"""Agrega consultations.modality (VIDEO_CALL / IN_PERSON)

Solo tiene una elección real para citas agendadas directamente por el
profesional (created_by_role=PROFESSIONAL) — el resto de consultas siempre
son VIDEO_CALL, ya que la plataforma las conecta por videollamada. Default
VIDEO_CALL para no romper filas existentes.

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-07-15
"""
from alembic import op
import sqlalchemy as sa

revision = "k5l6m7n8o9p0"
down_revision = "j4k5l6m7n8o9"
branch_labels = None
depends_on = None

consultation_modality = sa.Enum("VIDEO_CALL", "IN_PERSON", name="consultationmodality")


def upgrade() -> None:
    consultation_modality.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "consultations",
        sa.Column(
            "modality",
            consultation_modality,
            nullable=False,
            server_default="VIDEO_CALL",
        ),
    )
    # El server_default fue solo para poblar filas existentes sin bloquear
    # la migración — no queremos que quede como default permanente a nivel
    # de columna (el default real lo maneja la app vía el modelo).
    op.alter_column("consultations", "modality", server_default=None)


def downgrade() -> None:
    op.drop_column("consultations", "modality")
    consultation_modality.drop(op.get_bind(), checkfirst=True)
