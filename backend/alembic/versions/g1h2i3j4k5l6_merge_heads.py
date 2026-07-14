"""merge heads before membership feature

El historial de migraciones tenía 4 cabezas sin fusionar (branches
paralelos: chat interno, moderación de chat, contact_inquiries e
IA/WhatsApp). Esto es solo estructural — no toca ninguna tabla ni columna,
únicamente une el árbol de migraciones en un solo punto para poder seguir
encadenando revisiones nuevas con `alembic upgrade head` sin el error de
"Multiple head revisions are present".

Revision ID: g1h2i3j4k5l6
Revises: d1e2f3a4b5c6, b1c2d3e4f5a6, a8b9c0d1e2f3, f6a7b8c9d0e1
Create Date: 2026-07-13
"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = 'g1h2i3j4k5l6'
down_revision: Union[str, Sequence[str], None] = (
    'd1e2f3a4b5c6', 'b1c2d3e4f5a6', 'a8b9c0d1e2f3', 'f6a7b8c9d0e1',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: solo fusiona el árbol de migraciones."""
    pass


def downgrade() -> None:
    """No-op: no hay nada que revertir, es puramente estructural."""
    pass
