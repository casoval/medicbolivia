"""
app/tasks/chat_tasks.py
Expiración automática de conversaciones del chat interno paciente-profesional.

Una ChatConversation pasa a EXPIRED cuando se cumple expires_at
(Consultation.ended_at + settings.CHAT_WINDOW_DAYS). No se borra nada:
el historial sigue disponible en modo solo lectura, solo se bloquea el
envío de mensajes nuevos (ver validación en chat.py, tanto REST como WS).
"""
import asyncio
from datetime import datetime

from sqlalchemy import select, and_
from loguru import logger

from app.core.celery_app import celery_app
from app.db.database import AsyncSessionLocal, engine
from app.models.models import ChatConversation, ChatConversationStatus


async def _expire_chat_conversations():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatConversation).where(
                and_(
                    ChatConversation.status == ChatConversationStatus.ACTIVE.value,
                    ChatConversation.expires_at.is_not(None),
                    ChatConversation.expires_at < datetime.utcnow(),
                )
            )
        )
        vencidas = result.scalars().all()

        for conv in vencidas:
            conv.status = ChatConversationStatus.EXPIRED.value

        if vencidas:
            await db.commit()
            logger.info(f"💬 {len(vencidas)} conversación(es) de chat pasaron a EXPIRED")


@celery_app.task(name="app.tasks.chat_tasks.expire_chat_conversations")
def expire_chat_conversations():
    asyncio.run(_expire_chat_conversations())
    asyncio.run(engine.dispose())
