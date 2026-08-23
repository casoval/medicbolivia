"""add whatsapp_new_contacts_daily_cap a platform_settings

Tope diario configurable de a cuántos números NUNCA antes contactados por
la plataforma se les puede escribir por WhatsApp en un día. Ver el
comentario largo en el modelo (PlatformSettings.whatsapp_new_contacts_daily_cap,
models.py) y app/services/whatsapp_reachout_cap.py para el porqué: WhatsApp
(vía whatsapp-web.js, no es la Business API oficial) restringe en
silencio los envíos a contactos nuevos por cuenta ("Reachout Timelock",
error 463) — con una cuenta que ya tuvo restricciones antes, el margen
real puede ser mucho más chico de lo esperable, así que arranca
deliberadamente bajo (5/día) y se sube a mano desde el panel admin según
cómo evolucione, no automático.

Revision ID: q5r6s7t8u9v0
Revises: p4q5r6s7t8u9
Create Date: 2026-08-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'q5r6s7t8u9v0'
down_revision: Union[str, Sequence[str], None] = 'p4q5r6s7t8u9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE platform_settings
        ADD COLUMN IF NOT EXISTS whatsapp_new_contacts_daily_cap INTEGER NOT NULL DEFAULT 5
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE platform_settings DROP COLUMN IF EXISTS whatsapp_new_contacts_daily_cap")
