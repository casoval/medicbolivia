"""
app/services/broadcast.py
Envío de un mensaje libre (título + cuerpo) redactado por el admin a un
segmento de usuarios: todos, solo pacientes, solo profesionales, o
contactos de WhatsApp que escribieron al bot pero no tienen cuenta
(WHATSAPP_PUBLIC).

Dos canales, cada uno con su propia lógica:
  - Notificación in-app (tabla `notifications`): se crea de una sola vez
    para todos los destinatarios con cuenta — es solo un INSERT en la BD,
    no hay riesgo de "spam" ni límite de proveedor externo, así que no
    hace falta escalonarla.
  - WhatsApp: cada mensaje se encola por separado vía Celery
    (`send_whatsapp_message.apply_async(..., countdown=N)`), y `N` crece
    con un salto ALEATORIO entre cada destinatario (no un valor fijo como
    el stagger de reminder_tasks.py) para que la ráfaga de envíos se vea
    lo más parecida posible a una persona mandando mensajes uno por uno,
    y no a un script — reduce el riesgo de que whatsapp-web.js sea
    detectado y el número quede baneado.
"""
import random
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.models.models import (
    User, UserRole, UserStatus, ProfessionalStatus, Professional,
    Notification, WhatsAppConversation, WhatsAppAudience,
    BroadcastMessage, BroadcastAudience, BroadcastStatus,
    AgentConfig,
)
from app.tasks.whatsapp_tasks import send_whatsapp_message

# Espaciado aleatorio entre un envío de WhatsApp y el siguiente dentro de
# un mismo broadcast. Rango amplio a propósito (no un número redondo fijo
# tipo "cada 5s") para que el patrón de tiempos no sea reconocible.
MIN_GAP_SECONDS = 4
MAX_GAP_SECONDS = 15


async def _get_agent_config(db: AsyncSession) -> Optional[AgentConfig]:
    result = await db.execute(select(AgentConfig).where(AgentConfig.id == "global"))
    config = result.scalar_one_or_none()
    if config is None:
        config = AgentConfig(id="global")
        db.add(config)
        await db.flush()
    return config


async def _resolve_registered_recipients(db: AsyncSession, audience: str) -> list[User]:
    """Usuarios con cuenta (paciente/profesional), activos, según audiencia."""
    query = select(User).where(User.status == UserStatus.ACTIVE)

    if audience == BroadcastAudience.PATIENT.value:
        query = query.where(User.role == UserRole.PATIENT)
    elif audience == BroadcastAudience.PROFESSIONAL.value:
        # Solo profesionales aprobados — no tiene sentido mandarle un
        # anuncio de la plataforma a alguien todavía en revisión de docs.
        query = query.join(Professional, Professional.user_id == User.id).where(
            User.role == UserRole.PROFESSIONAL,
            Professional.status == ProfessionalStatus.APPROVED,
        )
    elif audience == BroadcastAudience.ALL.value:
        query = query.where(User.role.in_([UserRole.PATIENT, UserRole.PROFESSIONAL]))
    else:
        return []

    result = await db.execute(query)
    return list(result.scalars().all())


async def _resolve_public_contacts(db: AsyncSession) -> list[WhatsAppConversation]:
    """Contactos de WhatsApp sin cuenta en la plataforma (leads / consultas generales)."""
    result = await db.execute(
        select(WhatsAppConversation).where(
            WhatsAppConversation.audience == WhatsAppAudience.PUBLIC.value,
            WhatsAppConversation.user_id.is_(None),
        )
    )
    return list(result.scalars().all())


def _channel_enabled_for_role(config: AgentConfig, role: str) -> bool:
    return {
        "PATIENT": config.auto_reply_patients,
        "PROFESSIONAL": config.auto_reply_professionals,
    }.get(role, config.auto_reply_public)


async def send_broadcast(
    db: AsyncSession,
    title: str,
    body: str,
    audience: str,
    send_whatsapp: bool,
    sent_by_id: str,
) -> BroadcastMessage:
    """
    Crea el registro de auditoría, la notificación in-app (si aplica) y
    encola los WhatsApp escalonados. No hace `await db.commit()` — el
    caller (endpoint) controla la transacción, igual que notify_user().
    """
    broadcast = BroadcastMessage(
        title=title, body=body, audience=audience,
        send_whatsapp=send_whatsapp, sent_by_id=sent_by_id,
        status=BroadcastStatus.PENDING.value,
    )
    db.add(broadcast)
    await db.flush()

    config = await _get_agent_config(db) if send_whatsapp else None
    recipients_count = 0
    next_countdown = 0.0  # segundos acumulados desde ahora hasta el próximo envío

    if audience == BroadcastAudience.WHATSAPP_PUBLIC.value:
        contacts = await _resolve_public_contacts(db)
        whatsapp_enabled = config.auto_reply_public if config else False
        for contact in contacts:
            recipients_count += 1
            if send_whatsapp and whatsapp_enabled and contact.phone:
                next_countdown += random.uniform(MIN_GAP_SECONDS, MAX_GAP_SECONDS)
                message = f"*{title}*\n{body}" if title else body
                send_whatsapp_message.apply_async(
                    kwargs=dict(
                        phone=contact.phone, message=message,
                        audience=WhatsAppAudience.PUBLIC.value, user_id=None,
                        related_entity_type="BroadcastMessage", related_entity_id=broadcast.id,
                        sent_by="ADMIN",
                    ),
                    countdown=next_countdown,
                )
    else:
        users = await _resolve_registered_recipients(db, audience)
        for user in users:
            recipients_count += 1
            # Notificación in-app: siempre, es solo un insert.
            db.add(Notification(
                user_id=user.id, title=title, body=body,
                type="ADMIN_BROADCAST",
                entity_type="BroadcastMessage", entity_id=broadcast.id,
            ))

            role = user.role.value if hasattr(user.role, "value") else str(user.role)
            if send_whatsapp and user.phone and config and _channel_enabled_for_role(config, role):
                next_countdown += random.uniform(MIN_GAP_SECONDS, MAX_GAP_SECONDS)
                message = f"*{title}*\n{body}" if title else body
                audience_tag = {
                    "PATIENT": WhatsAppAudience.PATIENT.value,
                    "PROFESSIONAL": WhatsAppAudience.PROFESSIONAL.value,
                }.get(role, WhatsAppAudience.PUBLIC.value)
                send_whatsapp_message.apply_async(
                    kwargs=dict(
                        phone=user.phone, message=message,
                        audience=audience_tag, user_id=user.id,
                        related_entity_type="BroadcastMessage", related_entity_id=broadcast.id,
                        sent_by="ADMIN",
                    ),
                    countdown=next_countdown,
                )

    broadcast.recipients_count = recipients_count
    broadcast.status = BroadcastStatus.SENT.value
    logger.info(
        f"Broadcast '{title}' ({audience}): {recipients_count} destinatario(s), "
        f"WhatsApp escalonado a lo largo de ~{int(next_countdown)}s"
    )
    return broadcast


async def count_recipients(db: AsyncSession, audience: str) -> int:
    """Solo cuenta, para el preview en el frontend antes de confirmar el envío."""
    if audience == BroadcastAudience.WHATSAPP_PUBLIC.value:
        return len(await _resolve_public_contacts(db))
    return len(await _resolve_registered_recipients(db, audience))
