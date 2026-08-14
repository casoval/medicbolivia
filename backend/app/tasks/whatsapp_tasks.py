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
from app.services.whatsapp_throttle import wait_for_whatsapp_slot


class _TransientSendError(Exception):
    """
    Falla de whatsapp-service que se espera que se resuelva sola en
    unos segundos (frame de Puppeteer muerto reconectando, servicio
    reiniciando, etc.) — dispara un reintento de la tarea en vez de
    marcar el mensaje como fallido de una.
    """


# Contactos con privacidad de número activada en WhatsApp (@lid) no tienen
# un teléfono real resoluble — ver docstring de WhatsAppConversation en
# app/models/models.py. Para esos casos, `phone` en realidad contiene el
# JID crudo que mandó WhatsApp (ej. "157445045391462@lid" o
# "59172345678@c.us" ya resuelto pero de un origen no boliviano). Se
# reconoce por el "@": ningún valor que pase por normalize_bo_phone()
# normalmente lo tiene. Cuando aplica, NO se normaliza (fallaría) — se
# manda tal cual a whatsapp-service, que ya sabe usar un JID completo
# directo (ver toWhatsAppChatId en whatsapp-service/src/index.js).
def _is_raw_whatsapp_jid(value: str) -> bool:
    return "@" in (value or "")


async def _get_or_create_conversation(db, phone: str, audience: str, user_id: Optional[str]) -> WhatsAppConversation:
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.phone == phone))
    conversation = result.scalar_one_or_none()
    if conversation is None:
        conversation = WhatsAppConversation(
            phone=phone, audience=audience, user_id=user_id,
            is_resolved_phone=not _is_raw_whatsapp_jid(phone),
        )
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
    #
    # Excepción: si `phone` es en realidad un JID crudo de WhatsApp (caso
    # @lid — contacto sin número real resoluble, ver _is_raw_whatsapp_jid),
    # NO se normaliza — normalize_bo_phone() lo rechazaría siempre. Se
    # manda tal cual, whatsapp-service ya sabe usarlo directo.
    if not _is_raw_whatsapp_jid(phone):
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
        # Mismo piso global que usa el OTP síncrono (ver
        # whatsapp_throttle.py) — el rate_limit de Celery en el decorador
        # de esta tarea solo protege ráfagas DENTRO de send_whatsapp_message;
        # esto además coordina contra send_whatsapp_document (bucket
        # separado) y contra el envío de OTP (que no pasa por Celery).
        await wait_for_whatsapp_slot()
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
    # Techo real de arranques por minuto, sin importar de dónde vino el
    # .delay() (evento instantáneo, cron de citas, cron de no leídos,
    # broadcast, o /whatsapp/test-message). El countdown/jitter de cada
    # mecanismo solo demora CUÁNDO una tarea se vuelve elegible; con
    # concurrency=4 en el worker (ver ecosystem.config.js), dos tareas de
    # mecanismos distintos que se vuelven elegibles en el mismo segundo
    # igual se ejecutan en paralelo. rate_limit lo evita en la única
    # puerta por la que pasa todo — 3/m ≈ un envío cada ~20s como piso
    # duro, siga o no cargado el worker.
    rate_limit="3/m",
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
    # Ver comentario equivalente en _send_and_log sobre _is_raw_whatsapp_jid.
    if not _is_raw_whatsapp_jid(phone):
        try:
            phone = normalize_bo_phone(phone)
        except InvalidPhoneError as exc:
            logger.error(f"Teléfono inválido, no se puede enviar documento WhatsApp: {exc}")
            await _log_message(phone, f"[PDF: {filename}] {caption}", audience, user_id,
                                related_entity_type, related_entity_id, sent_by,
                                status="FAILED", error_detail=str(exc))
            return

    try:
        # Ver comentario equivalente en _send_and_log — mismo piso global,
        # necesario acá también porque send_whatsapp_document tiene su
        # PROPIO bucket de rate_limit, separado del de send_whatsapp_message.
        await wait_for_whatsapp_slot()
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
    # Mismo criterio que send_whatsapp_message — ver comentario ahí.
    # OJO: el rate_limit de Celery es POR TASK NAME, no compartido entre
    # las dos tareas. Hoy send_whatsapp_document solo se usa para el PDF
    # de invitación a médicos (volumen bajo), así que en la práctica no
    # compite con send_whatsapp_message por la misma sesión de WhatsApp
    # en el mismo segundo — pero si el volumen de documentos crece, esto
    # deja de ser cierto y hay que unificar el límite (ver nota abajo).
    rate_limit="3/m",
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
