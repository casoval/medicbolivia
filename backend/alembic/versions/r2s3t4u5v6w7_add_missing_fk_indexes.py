"""add missing indexes on foreign-key / hot-filter columns

Postgres NO indexa automáticamente las columnas de foreign key (solo el PK
y las columnas con UniqueConstraint, como users.phone/email). El esquema
inicial (45d8846d6772) nunca agregó índices explícitos sobre las columnas
por las que en realidad se filtra todo el tiempo: el historial de un
paciente/profesional, el panel admin, y sobre todo el cron de
recordatorios de citas (`reminder_tasks.py::_check_scheduled_appointment_
reminders`), que corre cada 60s y filtra consultations por status +
scheduled_at.

Con pocas filas esto no se nota (el planner igual barre toda la tabla
rápido). El problema aparece con el uso real: cada consulta, pago,
calificación y nota clínica que se acumula hace esas queries más lentas
— hasta convertirse en un cuello de botella real bajo carga, justo el
escenario que se quiere evitar. Esta migración es solo de índices: no
toca datos ni cambia ningún tipo de columna, así que es segura de aplicar
sobre la base de datos existente (de prueba) sin downtime relevante.

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-07-24
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'r2s3t4u5v6w7'
down_revision: Union[str, Sequence[str], None] = 'q1r2s3t4u5v6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── consultations ─────────────────────────────────────────────────
    # patient_id / professional_id: historial de paciente y profesional,
    # el filtro más común de toda la app.
    op.create_index('ix_consultations_patient_id', 'consultations', ['patient_id'])
    op.create_index('ix_consultations_professional_id', 'consultations', ['professional_id'])
    # Compuesto (status, scheduled_at): cubre exactamente el WHERE del cron
    # de recordatorios de citas agendadas, que corre cada 60s para siempre.
    op.create_index(
        'ix_consultations_status_scheduled_at',
        'consultations',
        ['status', 'scheduled_at'],
    )
    # created_at: usado para ordenar listados (admin, historial) por fecha.
    op.create_index('ix_consultations_created_at', 'consultations', ['created_at'])

    # ── payments ─────────────────────────────────────────────────────
    op.create_index('ix_payments_patient_id', 'payments', ['patient_id'])
    op.create_index('ix_payments_status', 'payments', ['status'])

    # ── ratings ──────────────────────────────────────────────────────
    op.create_index('ix_ratings_patient_id', 'ratings', ['patient_id'])
    op.create_index('ix_ratings_professional_id', 'ratings', ['professional_id'])

    # ── prescriptions ────────────────────────────────────────────────
    op.create_index('ix_prescriptions_consultation_id', 'prescriptions', ['consultation_id'])
    op.create_index('ix_prescriptions_professional_id', 'prescriptions', ['professional_id'])

    # ── clinical_notes ───────────────────────────────────────────────
    op.create_index('ix_clinical_notes_consultation_id', 'clinical_notes', ['consultation_id'])
    op.create_index('ix_clinical_notes_professional_id', 'clinical_notes', ['professional_id'])
    op.create_index('ix_clinical_notes_patient_id', 'clinical_notes', ['patient_id'])


def downgrade() -> None:
    op.drop_index('ix_clinical_notes_patient_id', table_name='clinical_notes')
    op.drop_index('ix_clinical_notes_professional_id', table_name='clinical_notes')
    op.drop_index('ix_clinical_notes_consultation_id', table_name='clinical_notes')

    op.drop_index('ix_prescriptions_professional_id', table_name='prescriptions')
    op.drop_index('ix_prescriptions_consultation_id', table_name='prescriptions')

    op.drop_index('ix_ratings_professional_id', table_name='ratings')
    op.drop_index('ix_ratings_patient_id', table_name='ratings')

    op.drop_index('ix_payments_status', table_name='payments')
    op.drop_index('ix_payments_patient_id', table_name='payments')

    op.drop_index('ix_consultations_created_at', table_name='consultations')
    op.drop_index('ix_consultations_status_scheduled_at', table_name='consultations')
    op.drop_index('ix_consultations_professional_id', table_name='consultations')
    op.drop_index('ix_consultations_patient_id', table_name='consultations')
