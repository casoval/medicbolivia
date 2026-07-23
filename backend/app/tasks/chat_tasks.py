"""
app/tasks/chat_tasks.py
Expiración automática de conversaciones del chat interno paciente-profesional.

Una ChatConversation pasa a EXPIRED cuando se cumple expires_at
(Consultation.ended_at + settings.CHAT_WINDOW_DAYS). No se borra nada:
el historial sigue disponible en modo solo lectura, solo se bloquea el
envío de mensajes nuevos (ver validación en chat.py, tanto REST como WS).
"""
import asyncio
from app.core.timezone import utcnow_naive

from sqlalchemy import select, and_
from loguru import logger

from app.core.celery_app import celery_app
from app.db.database import AsyncSessionLocal, engine
from app.models.models import (
    ChatConversation, ChatConversationStatus, ChatBlock,
    ProfessionalPatientVisibility, User, UserRole,
)


async def _notify_admin_of_chat_report(chat_block_id: str):
    """Avisa a todos los usuarios con rol ADMIN que se generó un reporte
    de chat (bloqueo con is_reported=True), para que lo revisen desde el
    panel Chat > Reportes."""
    from app.services.notify import notify_user

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ChatBlock).where(ChatBlock.id == chat_block_id))
        block = result.scalar_one_or_none()
        if not block or not block.is_reported:
            return

        admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        admins = admins_result.scalars().all()

        category_label = block.reason_category or "OTHER"
        for admin in admins:
            await notify_user(
                db, user_id=admin.id,
                title="Nuevo reporte de chat",
                body=f"Se reportó una conversación (motivo: {category_label}). Revísalo en Chat > Reportes.",
                type_="CHAT_REPORT",
                entity_type="ChatBlock", entity_id=block.id,
                send_whatsapp=False,  # solo in-app, para no saturar WhatsApp por cada reporte
            )
        await db.commit()
        logger.info(f"🚩 Admins notificados de reporte de chat: chat_block_id={chat_block_id}")


@celery_app.task(name="app.tasks.chat_tasks.notify_admin_of_chat_report")
def notify_admin_of_chat_report(chat_block_id: str):
    asyncio.run(_notify_admin_of_chat_report(chat_block_id))
    asyncio.run(engine.dispose())


async def _notify_admin_of_patient_visibility_report(visibility_id: str):
    """Igual que arriba, pero para reportes que vienen del bloqueo
    integral desde 'Mis Pacientes' (ProfessionalPatientVisibility)."""
    from app.services.notify import notify_user

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ProfessionalPatientVisibility).where(ProfessionalPatientVisibility.id == visibility_id)
        )
        visibility = result.scalar_one_or_none()
        if not visibility or not visibility.is_reported:
            return

        admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        admins = admins_result.scalars().all()

        category_label = visibility.reason_category or "OTHER"
        for admin in admins:
            await notify_user(
                db, user_id=admin.id,
                title="Nuevo reporte de paciente",
                body=f"Un profesional reportó/bloqueó a un paciente (motivo: {category_label}). Revísalo en Chat > Reportes.",
                type_="CHAT_REPORT",
                entity_type="ProfessionalPatientVisibility", entity_id=visibility.id,
                send_whatsapp=False,
            )
        await db.commit()
        logger.info(f"🚩 Admins notificados de reporte de paciente: visibility_id={visibility_id}")


@celery_app.task(name="app.tasks.chat_tasks.notify_admin_of_patient_visibility_report")
def notify_admin_of_patient_visibility_report(visibility_id: str):
    asyncio.run(_notify_admin_of_patient_visibility_report(visibility_id))
    asyncio.run(engine.dispose())


async def _expire_chat_conversations():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatConversation).where(
                and_(
                    ChatConversation.status == ChatConversationStatus.ACTIVE.value,
                    ChatConversation.expires_at.is_not(None),
                    ChatConversation.expires_at < utcnow_naive(),
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
