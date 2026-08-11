"""merge heads before whatsapp lid fix

El árbol de migraciones volvió a quedar con 2 cabezas sin fusionar
(b1c2d3e4f5a6 y m3n4o5p6q7r8, branches paralelos ya mergeados por
separado). Solo estructural, no toca ninguna tabla — une el árbol para
poder encadenar la migración real de este fix (soporte de @lid en
whatsapp_conversations) sin el error de "Multiple head revisions".

Revision ID: c3d4e5f6a7b8
Revises: b1c2d3e4f5a6, m3n4o5p6q7r8
Create Date: 2026-08-11
"""
from typing import Sequence, Union


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = (
    'b1c2d3e4f5a6', 'm3n4o5p6q7r8',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: solo fusiona el árbol de migraciones."""
    pass


def downgrade() -> None:
    """No-op: no hay nada que revertir, es puramente estructural."""
    pass
