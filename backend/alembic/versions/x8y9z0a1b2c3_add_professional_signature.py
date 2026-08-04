"""add professional signature_url

Agrega signature_url a professionals: imagen de la firma del médico
(PNG con fondo transparente, capturada en un canvas desde su perfil),
usada para estampar la receta imprimible que generan los médicos para
las farmacias que todavía piden papel. Ver POST /professionals/signature
y app/services/prescription_pdf.py.

prescriptions.pdf_url y lab_orders.pdf_url ya existían desde la
migración w7x8y9z0a1b2 (se preveía este uso pero no estaba implementado)
— no hace falta tocarlos acá, solo empiezan a llenarse.

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'x8y9z0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'w7x8y9z0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS signature_url VARCHAR(500)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS signature_url")
