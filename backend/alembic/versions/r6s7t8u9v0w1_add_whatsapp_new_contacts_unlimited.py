"""add whatsapp_new_contacts_unlimited a platform_settings

Toggle explícito de "sin límite" para el tope diario de contactos nuevos
por WhatsApp (whatsapp_new_contacts_daily_cap, ver q5r6s7t8u9v0). Separado
del número en un booleano aparte a propósito — ver comentario largo en
PlatformSettings.whatsapp_new_contacts_unlimited (models.py).

Revision ID: r6s7t8u9v0w1
Revises: q5r6s7t8u9v0
Create Date: 2026-08-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'r6s7t8u9v0w1'
down_revision: Union[str, Sequence[str], None] = 'q5r6s7t8u9v0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE platform_settings
        ADD COLUMN IF NOT EXISTS whatsapp_new_contacts_unlimited BOOLEAN NOT NULL DEFAULT FALSE
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE platform_settings DROP COLUMN IF EXISTS whatsapp_new_contacts_unlimited")
