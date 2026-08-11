"""merge heads before whatsapp lid fix

El árbol de migraciones volvió a quedar con 3 cabezas sin fusionar
(b1c2d3e4f5a6, b2c3d4e5f6a7 y m3n4o5p6q7r8, branches paralelos ya
mergeados por separado). Solo estructural, no toca ninguna tabla — une
el árbol para poder encadenar la migración real de este fix (soporte
de @lid en whatsapp_conversations) sin el error de "Multiple head
revisions".

NOTA: el revision ID original de este archivo (c3d4e5f6a7b8) chocaba
con una migración real y ya existente (add_refunded_amount_to_payments),
y el merge solo cubría 2 de los 3 heads reales. Corregido acá.

Revision ID: e6f7a8b9c0d1
Revises: b1c2d3e4f5a6, b2c3d4e5f6a7, m3n4o5p6q7r8
Create Date: 2026-08-11
"""
from typing import Sequence, Union


revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = (
    'b1c2d3e4f5a6', 'b2c3d4e5f6a7', 'm3n4o5p6q7r8',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: solo fusiona el árbol de migraciones."""
    pass


def downgrade() -> None:
    """No-op: no hay nada que revertir, es puramente estructural."""
    pass