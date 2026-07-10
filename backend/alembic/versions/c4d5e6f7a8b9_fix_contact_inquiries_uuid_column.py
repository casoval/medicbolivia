"""fix contact_inquiries id column from varchar to native uuid

La columna id de contact_inquiries se creó como sa.String() plano en la
migración anterior (a8b9c0d1e2f3), mientras que el modelo de SQLAlchemy
(models.py) la define como UUID(as_uuid=False). Postgres no compara
varchar = uuid sin conversión explícita, lo que rompe cualquier
SELECT/UPDATE que filtre por id — por ejemplo el db.refresh(inquiry) que
se hace justo después de guardar cada consulta del formulario público:

    (sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError)
    el operador no existe: character varying = uuid

Mismo bug, mismo arreglo que ya se hizo una vez para el módulo de
WhatsApp/recordatorios en f9e8d7c6b5a4. No hay FKs que apunten a
contact_inquiries.id, así que no hace falta soltar/recrear constraints.

Revision ID: c4d5e6f7a8b9
Revises: a8b9c0d1e2f3
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c4d5e6f7a8b9"
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "contact_inquiries",
        "id",
        type_=postgresql.UUID(as_uuid=False),
        existing_type=sa.String(),
        postgresql_using="id::uuid",
    )


def downgrade() -> None:
    op.alter_column(
        "contact_inquiries",
        "id",
        type_=sa.String(),
        existing_type=postgresql.UUID(as_uuid=False),
        postgresql_using="id::varchar",
    )
