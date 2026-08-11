"""whatsapp_conversations: soporte de JID crudo (@lid)

Bug real detectado ago-2026: WhatsApp oculta el número de teléfono real
de contactos con privacidad de número activada (identificador interno
"@lid" en vez del número). whatsapp-service intentaba resolverlo vía
getContact(), pero para estos contactos no siempre hay un número real
disponible — se reenviaba el mismo ID interno (14-15 dígitos) al backend,
que lo rechazaba con 422 en normalize_bo_phone() (correctamente: no es
un número boliviano válido) y el mensaje se perdía sin generar respuesta.
Confirmado en logs de producción: decenas de mensajes descartados de
varios contactos distintos a lo largo de más de una semana.

Este cambio permite que `phone` guarde el JID crudo tal cual lo manda
WhatsApp cuando no hay número real resoluble, marcado con
is_resolved_phone=False, para no perder el mensaje — igual se le puede
responder (WhatsApp permite enviar directo a ese JID).

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-11
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ancho a 40: un JID crudo tipo "157445045391462@lid" no entra en los
    # 20 caracteres originales (pensados solo para "591XXXXXXXX").
    op.execute("""
        ALTER TABLE whatsapp_conversations
        ALTER COLUMN phone TYPE VARCHAR(40)
    """)
    op.execute("""
        ALTER TABLE whatsapp_conversations
        ADD COLUMN IF NOT EXISTS is_resolved_phone BOOLEAN NOT NULL DEFAULT TRUE
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE whatsapp_conversations DROP COLUMN IF EXISTS is_resolved_phone")
    op.execute("""
        ALTER TABLE whatsapp_conversations
        ALTER COLUMN phone TYPE VARCHAR(20)
    """)
