"""add HELP agent type

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Create Date: 2026-07-18 00:00:00.000000

Agrega el valor 'HELP' al enum agenttype, para el agente de ayuda
persistente (guía de la plataforma accesible en cualquier momento, no solo
durante el onboarding de primer registro — ver ONBOARDING vs HELP en
app/agents/coordinator.py).
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'o9p0q1r2s3t4'
down_revision: Union[str, Sequence[str], None] = 'n8o9p0q1r2s3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ALTER TYPE ... ADD VALUE no puede correr dentro de la transacción normal
    # de Alembic en Postgres, por eso se ejecuta en un bloque autocommit aparte
    # (mismo patrón que b2c3d4e5f6a7_add_cancelled_no_charge_payment_status.py).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE agenttype ADD VALUE IF NOT EXISTS 'HELP'")


def downgrade() -> None:
    """Downgrade schema.

    Postgres no permite quitar un valor de un enum de forma directa. Si se
    necesita revertir, primero hay que migrar cualquier fila con
    agent_type='HELP' a otro valor (p. ej. 'ONBOARDING') y luego recrear el
    tipo sin ese valor. Se deja como no-op para no bloquear el downgrade.
    """
    pass
