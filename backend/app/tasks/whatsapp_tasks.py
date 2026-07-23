"""
app/tasks/whatsapp_tasks.py
Tarea de Celery que efectivamente manda el mensaje de WhatsApp, llamando
al microservicio Node (whatsapp-service/, whatsapp-web.js) y dejando
registro en `whatsapp_conversations` / `whatsapp_messages`.

Todo lo que necesite mandar un WhatsApp (recordatorios, notificaciones de
consulta inmediata, respuestas del agente IA) pasa por acá — es el único
lugar que le habla al microservicio Node.

Reintentos: whatsapp-service usa whatsapp-web.js (Puppeteer/Chromium por
debajo), que a veces muere y se reconecta solo en unos segundos (ver
whatsapp-service/src/index.js — detección de "detached frame" /
"target closed" y reconexión forzada). Un envío que le pega justo a ese
instante no es un error permanente: reintentar unos segundos después casi
siempre funciona. Por eso esta tarea reintenta sola (vía Celery) los
errores 502/503 y de red hacia whatsapp-service, y solo registra el
mensaje como FAILED en la BD cuando se agotan los reintentos — así no se
acumula una fila por cada intento fallido.
"""
import asyncio
from app.core.timezone import utcnow_naive
from typing import Optional

import httpx
from loguru import logger
from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.phone import normalize_bo_phone, InvalidPhoneError
from app.db.database import AsyncSessionLocal, engine
from app.models.models import WhatsAppConversation, WhatsAppMessage, WhatsAppAudience


class _TransientSendError(Exception):
    """
    Falla de whatsapp-service que se espera que se resuelva sola en
    unos segundos (frame de Puppeteer muerto reconectando, servicio
    reiniciando, etc.) — dispara un reintento de la tarea en vez de
    marcar el mensaje como fallido de una.
    """


async def _get_or_create_conversation(db, phone: str, audience: str, user_id: Optional[str]) -> WhatsAppConversation:
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.phone == phone))
    conversation = result.scalar_one_or_none()
    if conversation is None:
        conversation = WhatsAppConversation(phone=phone, audience=audience, user_id=user_id)
        db.add(conversation)
        await db.flush()
    return conversation


async def _log_message(
    phone: str,
    message: str,
    audience: str,
    user_id: Optional[str],
    related_entity_type: Optional[str],
    related_entity_id: Optional[str],
    sent_by: str,
    status: str,
    error_detail: Optional[str],
) -> None:
    """Escribe el resultado FINAL (SENT o FAILED tras agotar reintentos) — se llama una sola vez por mensaje, nunca por cada intento."""
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
        conversation.last_message_at = utcnow_naive()
        conversation.last_message_preview = message[:300]
        await db.commit()


async def _send_and_log(task, phone: str, message: str, audience: str, user_id: Optional[str],
                         related_entity_type: Optional[str], related_entity_id: Optional[str], sent_by: str) -> None:
    # Normalizamos ACÁ, antes de todo — así el número usado como clave de
    # WhatsAppConversation es siempre el mismo formato que usa el webhook
    # de entrada (whatsapp.py::receive_inbound_message), sin importar si
    # `phone` venía de un User registrado antes o después del fix de
    # normalización (ver app/core/phone.py).
    try:
        phone = normalize_bo_phone(phone)
    except InvalidPhoneError as exc:
        # Error permanente: el número nunca se va a volver válido solo,
        # no tiene sentido reintentar.
        logger.error(f"Teléfono inválido, no se puede enviar WhatsApp: {exc}")
        await _log_message(phone, message, audience, user_id, related_entity_type, related_entity_id, sent_by,
                            status="FAILED", error_detail=str(exc))
        return

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.WHATSAPP_SERVICE_URL}/send",
                json={"to": phone, "message": message},
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
        if resp.status_code >= 400:
            error_detail = f"whatsapp-service {resp.status_code}: {resp.text[:250]}"
            if resp.status_code in (502, 503):
                # 503 = "WhatsApp no está conectado" (reconectando) y
                # 502 = el propio whatsapp-service devuelve el error del
                # frame de Puppeteer muerto mientras se reconecta solo
                # (ver whatsapp-service/src/index.js). Ambos transitorios.
                raise _TransientSendError(error_detail)
            # Cualquier otro 4xx/5xx (ej. 400 por payload mal formado) es
            # permanente — reintentar no lo va a arreglar.
            logger.error(f"Error enviando WhatsApp a {phone}: {error_detail}")
            await _log_message(phone, message, audience, user_id, related_entity_type, related_entity_id, sent_by,
                                status="FAILED", error_detail=error_detail)
            return
    except httpx.RequestError as exc:
        # Error de red hacia whatsapp-service (ej. el proceso se está
        # reiniciando justo en este instante) — también transitorio.
        raise _TransientSendError(f"Error de red hacia whatsapp-service: {exc}") from exc
    except _TransientSendError as exc:
        attempt = task.request.retries + 1
        total = task.max_retries + 1
        if task.request.retries >= task.max_retries:
            # Reintentos agotados: recién acá se registra como FAILED
            # definitivo.
            logger.error(f"WhatsApp a {phone} falló tras {total} intentos: {exc}")
            await _log_message(phone, message, audience, user_id, related_entity_type, related_entity_id, sent_by,
                                status="FAILED", error_detail=f"{exc} (tras {total} intentos)")
            return
        logger.warning(f"Fallo transitorio enviando WhatsApp a {phone} (intento {attempt}/{total}), reintentando: {exc}")
        # Backoff lineal (30s, 60s, 90s con la config default_retry_delay=30
        # actual) — le da tiempo de sobra a whatsapp-service para
        # reconectar antes del siguiente intento.
        raise task.retry(exc=exc, countdown=task.default_retry_delay * attempt)

    await _log_message(phone, message, audience, user_id, related_entity_type, related_entity_id, sent_by,
                        status="SENT", error_detail=None)


@celery_app.task(
    bind=True,
    name="app.tasks.whatsapp_tasks.send_whatsapp_message",
    max_retries=3,
    default_retry_delay=30,
)
def send_whatsapp_message(
    self,
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

    `bind=True` para poder llamar a self.retry(...) desde _send_and_log
    en fallos transitorios de whatsapp-service — antes max_retries/
    default_retry_delay estaban configurados pero nunca se usaban
    (ningún código llamaba a retry), así que cualquier falla puntual del
    frame de Puppeteer quedaba marcada como FAILED para siempre.
    """
    try:
        asyncio.run(_send_and_log(
            task=self,
            phone=phone,
            message=message,
            audience=audience,
            user_id=user_id,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            sent_by=sent_by,
        ))
    finally:
        asyncio.run(engine.dispose())


async def _send_document_and_log(task, phone: str, pdf_base64: str, filename: str, caption: str,
                                  audience: str, user_id: Optional[str],
                                  related_entity_type: Optional[str], related_entity_id: Optional[str],
                                  sent_by: str) -> None:
    """
    Mismo patrón de _send_and_log (normalización, reintentos ante fallos
    transitorios de whatsapp-service, log final único), pero golpeando
    /send-document en vez de /send. El texto que se guarda en
    WhatsAppMessage.body es el `caption` con una marca de qué archivo se
    adjuntó — no se guarda el PDF en sí en la base de datos, solo queda
    en el chat real de WhatsApp.
    """
    try:
        phone = normalize_bo_phone(phone)
    except InvalidPhoneError as exc:
        logger.error(f"Teléfono inválido, no se puede enviar documento WhatsApp: {exc}")
        await _log_message(phone, f"[PDF: {filename}] {caption}", audience, user_id,
                            related_entity_type, related_entity_id, sent_by,
                            status="FAILED", error_detail=str(exc))
        return

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.WHATSAPP_SERVICE_URL}/send-document",
                json={
                    "to": phone, "filename": filename, "caption": caption,
                    "base64": pdf_base64, "mimetype": "application/pdf",
                },
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
        if resp.status_code >= 400:
            error_detail = f"whatsapp-service {resp.status_code}: {resp.text[:250]}"
            if resp.status_code in (502, 503):
                raise _TransientSendError(error_detail)
            logger.error(f"Error enviando documento WhatsApp a {phone}: {error_detail}")
            await _log_message(phone, f"[PDF: {filename}] {caption}", audience, user_id,
                                related_entity_type, related_entity_id, sent_by,
                                status="FAILED", error_detail=error_detail)
            return
    except httpx.RequestError as exc:
        raise _TransientSendError(f"Error de red hacia whatsapp-service: {exc}") from exc
    except _TransientSendError as exc:
        attempt = task.request.retries + 1
        total = task.max_retries + 1
        if task.request.retries >= task.max_retries:
            logger.error(f"Documento WhatsApp a {phone} falló tras {total} intentos: {exc}")
            await _log_message(phone, f"[PDF: {filename}] {caption}", audience, user_id,
                                related_entity_type, related_entity_id, sent_by,
                                status="FAILED", error_detail=f"{exc} (tras {total} intentos)")
            return
        logger.warning(f"Fallo transitorio enviando documento a {phone} (intento {attempt}/{total}), reintentando: {exc}")
        raise task.retry(exc=exc, countdown=task.default_retry_delay * attempt)

    await _log_message(phone, f"[PDF: {filename}] {caption}", audience, user_id,
                        related_entity_type, related_entity_id, sent_by,
                        status="SENT", error_detail=None)


@celery_app.task(
    bind=True,
    name="app.tasks.whatsapp_tasks.send_whatsapp_document",
    max_retries=3,
    default_retry_delay=30,
)
def send_whatsapp_document(
    self,
    phone: str,
    pdf_base64: str,
    filename: str,
    caption: str = "",
    audience: str = WhatsAppAudience.PUBLIC.value,
    user_id: Optional[str] = None,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[str] = None,
    sent_by: str = "SYSTEM",
):
    """
    Manda un PDF (u otro documento) adjunto por WhatsApp. Hoy se usa
    únicamente para el PDF de invitación formal de captación de médicos
    (ver app/api/v1/endpoints/admin.py::invite_doctor_lead y
    app/services/invitation_pdf.py), pero queda genérica por si en el
    futuro hace falta mandar otro tipo de documento (ej. un comprobante).
    """
    try:
        asyncio.run(_send_document_and_log(
            task=self,
            phone=phone,
            pdf_base64=pdf_base64,
            filename=filename,
            caption=caption,
            audience=audience,
            user_id=user_id,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            sent_by=sent_by,
        ))
    finally:
        asyncio.run(engine.dispose())


async def _notify_admin_of_whatsapp_escalation(conversation_id: str):
    """
    Avisa a todos los usuarios con rol ADMIN que el agente de WhatsApp
    derivó una conversación (sugerencia, propuesta de negocio, reclamo que
    no pudo resolver, o pedido explícito de hablar con un humano) — ver
    [ESCALATE_ADMIN:...] en app/agents/coordinator.py::WHATSAPP_SYSTEM.
    Mismo patrón que notify_admin_of_chat_report (chat_tasks.py): solo
    in-app, para no saturar WhatsApp con una notificación por cada
    escalamiento — el admin ya ve la conversación destacada en el inbox.
    """
    from app.models.models import User, UserRole
    from app.services.notify import notify_user

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WhatsAppConversation).where(WhatsAppConversation.id == conversation_id)
        )
        conversation = result.scalar_one_or_none()
        if not conversation or not conversation.needs_admin_attention:
            return

        admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        admins = admins_result.scalars().all()

        contact = conversation.contact_name or conversation.phone
        reason = conversation.escalation_reason or "sin motivo especificado"
        for admin in admins:
            await notify_user(
                db, user_id=admin.id,
                title="WhatsApp: conversación derivada a administración",
                body=f"{contact} — {reason}. Revísalo en IA / WhatsApp > Conversaciones.",
                type_="WHATSAPP_ESCALATION",
                entity_type="WhatsAppConversation", entity_id=conversation.id,
                send_whatsapp=False,  # solo in-app, la conversación ya queda marcada en el inbox
            )
        await db.commit()
        logger.info(f"🚩 Admins notificados de escalamiento de WhatsApp: conversation_id={conversation_id}")


@celery_app.task(name="app.tasks.whatsapp_tasks.notify_admin_of_whatsapp_escalation")
def notify_admin_of_whatsapp_escalation(conversation_id: str):
    asyncio.run(_notify_admin_of_whatsapp_escalation(conversation_id))
    asyncio.run(engine.dispose())
