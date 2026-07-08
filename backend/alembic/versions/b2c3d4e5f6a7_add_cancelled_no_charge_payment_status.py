"""add cancelled_no_charge payment status

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-04 00:00:00.000000

Corrige el bug de dinero: cuando se cancelaba una consulta cuyo pago seguía
en PENDING (el paciente nunca pagó el QR), el código marcaba el pago como
REFUNDED_FULL — lo que hacía aparecer "Reembolso total" en el panel de admin
sin que se haya cobrado nada. Este nuevo valor del enum distingue
explícitamente "se canceló sin que hubiera cobro" de un reembolso real.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ALTER TYPE ... ADD VALUE no puede correr dentro de la transacción normal
    # de Alembic en Postgres < 12 (y es más seguro igual en 12+), por eso se
    # ejecuta en un bloque autocommit aparte.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE paymentstatus ADD VALUE IF NOT EXISTS 'CANCELLED_NO_CHARGE'")


def downgrade() -> None:
    """Downgrade schema.

    Postgres no permite quitar un valor de un enum de forma directa. Si se
    necesita revertir, primero hay que migrar cualquier fila con
    'CANCELLED_NO_CHARGE' a otro valor (p. ej. 'REFUNDED_FULL') y luego
    recrear el tipo sin ese valor. Se deja como no-op para no bloquear el
    downgrade con un error; revertir manualmente si es estrictamente necesario.
    """
    pass
