"""
app/tasks/whatsapp_tasks.py
Tarea de Celery que efectivamente manda el mensaje de WhatsApp, llamando
al microservicio Node (whatsapp-service/, Baileys) y dejando registro en
`whatsapp_conversations` / `whatsapp_messages`.

Todo lo que necesite mandar un WhatsApp (recordatorios, notificaciones de
consulta inmediata, respuestas del agente IA) pasa por acá — es el único
lugar que le habla al microservicio Node.
"""
import asyncio
from typing import Optional

import httpx
from loguru import logger
from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.phone import normalize_bo_phone, InvalidPhoneError
from app.db.database import AsyncSessionLocal, engine
from app.models.models import WhatsAppConversation, WhatsAppMessage, WhatsAppAudience


async def _get_or_create_conversation(db, phone: str, audience: str, user_id: Optional[str]) -> WhatsAppConversation:
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.phone == phone))
    conversation = result.scalar_one_or_none()
    if conversation is None:
        conversation = WhatsAppConversation(phone=phone, audience=audience, user_id=user_id)
        db.add(conversation)
        await db.flush()
    return conversation


async def _send_and_log(
    phone: str,
    message: str,
    audience: str,
    user_id: Optional[str],
    related_entity_type: Optional[str],
    related_entity_id: Optional[str],
    sent_by: str,
) -> None:
    # Normalizamos ACÁ, antes de todo — así el número usado como clave de
    # WhatsAppConversation es siempre el mismo formato que usa el webhook
    # de entrada (whatsapp.py::receive_inbound_message), sin importar si
    # `phone` venía de un User registrado antes o después del fix de
    # normalización (ver app/core/phone.py).
    try:
        phone = normalize_bo_phone(phone)
    except InvalidPhoneError as exc:
        logger.error(f"Teléfono inválido, no se puede enviar WhatsApp: {exc}")
        async with AsyncSessionLocal() as db:
            conversation = await _get_or_create_conversation(db, phone, audience, user_id)
            db.add(WhatsAppMessage(
                conversation_id=conversation.id, direction="OUT", body=message,
                sent_by=sent_by, status="FAILED", error_detail=str(exc),
                related_entity_type=related_entity_type, related_entity_id=related_entity_id,
            ))
            await db.commit()
        return

    status = "SENT"
    error_detail = None

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.WHATSAPP_SERVICE_URL}/send",
                json={"to": phone, "message": message},
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
        if resp.status_code >= 400:
            status = "FAILED"
            error_detail = f"whatsapp-service {resp.status_code}: {resp.text[:250]}"
            logger.error(f"Error enviando WhatsApp a {phone}: {error_detail}")
    except httpx.RequestError as exc:
        status = "FAILED"
        error_detail = f"Error de red hacia whatsapp-service: {exc}"
        logger.error(error_detail)

    async with AsyncSessionLocal() as db:
        conversation = await _get_or_create_conversation(db, phone, audience, user_id)
        db.add(WhatsAppMessage(
            conversation_id=conversation.id,
            direction="OUT",
            body=message,
            sent_by=sent_by,
            status=status,
            error_detail=error_detail,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        ))
        from datetime import datetime
        conversation.last_message_at = datetime.utcnow()
        conversation.last_message_preview = message[:300]
        await db.commit()


@celery_app.task(
    name="app.tasks.whatsapp_tasks.send_whatsapp_message",
    max_retries=3,
    default_retry_delay=30,
)
def send_whatsapp_message(
    phone: str,
    message: str,
    audience: str = WhatsAppAudience.PUBLIC.value,
    user_id: Optional[str] = None,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[str] = None,
    sent_by: str = "SYSTEM",
):
    """
    Punto de entrada síncrono (Celery worker) que ejecuta la lógica async
    real. Se llama con `.delay(...)` desde notify.py, reminder_tasks.py,
    o directamente desde cualquier endpoint que necesite mandar un
    WhatsApp puntual (ej. el admin respondiendo un chat a mano).
    """
    asyncio.run(_send_and_log(
        phone=phone,
        message=message,
        audience=audience,
        user_id=user_id,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        sent_by=sent_by,
    ))
    asyncio.run(engine.dispose())
