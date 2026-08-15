"""add change_requested_at to professional_bank_accounts

Antes, una cuenta ya verificada quedaba igual de editable que una pendiente
-el PUT /me/bank-account no distinguía-, así que el profesional podía
pisarla por error sin que un admin se enterara del cambio hasta el próximo
pago. Ahora se bloquea la edición mientras verified=True (ver PUT en
professionals.py) y se agrega este campo: el profesional "pide" el cambio
en vez de editarla directo, quedando marcado acá para que el admin lo vea
puntualmente en la ficha del profesional y decida revertir la aprobación
(destrabando la edición) cuando corresponda.

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-08-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, Sequence[str], None] = 'g7h8i9j0k1l2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'professional_bank_accounts',
        sa.Column('change_requested_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('professional_bank_accounts', 'change_requested_at')
