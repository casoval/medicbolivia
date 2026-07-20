"""add doctor_leads table

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-07-19 00:00:00.000000

Tabla de prospectos de médicos (buscador admin, ver
app/api/v1/endpoints/admin.py::search_doctor_leads_maps) para captación:
médicos que todavía NO tienen cuenta en la plataforma, descubiertos por
el admin vía Google Places, carga manual o import CSV, con seguimiento
de estado hasta que (si acepta) se registran como Professional.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'q1r2s3t4u5v6'
down_revision: Union[str, Sequence[str], None] = 'p0q1r2s3t4u5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'doctor_leads',
        sa.Column('id', postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column('full_name', sa.String(length=200), nullable=False),
        sa.Column('specialty', sa.String(length=100), nullable=True),
        sa.Column('city', sa.String(length=100), nullable=True),
        sa.Column('phone', sa.String(length=20), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('clinic_or_hospital', sa.String(length=200), nullable=True),
        sa.Column('address', sa.String(length=300), nullable=True),
        sa.Column('source', sa.String(length=20), nullable=False, server_default='MANUAL'),
        sa.Column('place_id', sa.String(length=150), nullable=True),
        sa.Column('maps_url', sa.String(length=500), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='NUEVO'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('last_contacted_at', sa.DateTime(), nullable=True),
        sa.Column('converted_professional_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['converted_professional_id'], ['professionals.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
        sa.UniqueConstraint('phone', name='uq_doctor_leads_phone'),
    )
    op.create_index('ix_doctor_leads_status', 'doctor_leads', ['status'])
    op.create_index('ix_doctor_leads_specialty', 'doctor_leads', ['specialty'])
    op.create_index('ix_doctor_leads_city', 'doctor_leads', ['city'])
    op.create_index('ix_doctor_leads_place_id', 'doctor_leads', ['place_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_doctor_leads_place_id', table_name='doctor_leads')
    op.drop_index('ix_doctor_leads_city', table_name='doctor_leads')
    op.drop_index('ix_doctor_leads_specialty', table_name='doctor_leads')
    op.drop_index('ix_doctor_leads_status', table_name='doctor_leads')
    op.drop_table('doctor_leads')
