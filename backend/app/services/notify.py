"""
app/services/notify.py
Punto único de notificación al usuario: crea la fila in-app (tabla
`notifications`, como ya existía) y además — si corresponde — encola el
envío por WhatsApp usando el mismo texto.

Por qué existe este archivo:
El modelo Notification ya traía este comentario desde antes:
    "si más adelante se conecta SMS/push real (Twilio, FCM, etc.), se
    dispara desde el mismo punto donde se crea esta fila, sin tocar el
    resto del flujo."
Este helper es exactamente eso: reemplaza los `db.add(Notification(...))`
sueltos repartidos en consultations.py (10+ lugares) por una sola función,
sin cambiar el resto de la lógica de negocio.

USO — reemplazar esto:
    db.add(Notification(
        user_id=patient_n.user_id,
        title="¡Cita confirmada!",
        body="...",
        type="CONSULTATION_CONFIRMED",
        entity_type="Consultation",
        entity_id=consultation.id,
    ))

por esto:
    await notify_user(
        db, user_id=patient_n.user_id,
        title="¡Cita confirmada!",
        body="...",
        type_="CONSULTATION_CONFIRMED",
        entity_type="Consultation", entity_id=consultation.id,
    )

La migración de los ~10 puntos existentes en consultations.py se hace de
forma incremental (no rompe nada mientras conviven ambos estilos), pero
todo código NUEVO debería usar notify_user directamente.
"""
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.models.models import Notification, User, WhatsAppAudience, AgentConfig


async def _get_agent_config(db: AsyncSession) -> Optional[AgentConfig]:
    result = await db.execute(select(AgentConfig).where(AgentConfig.id == "global"))
    config = result.scalar_one_or_none()
    if config is None:
        # Autocreación con defaults, mismo patrón que PlatformSettings.
        config = AgentConfig(id="global")
        db.add(config)
        await db.flush()
    return config


def _audience_for_role(role: str) -> str:
    mapping = {
        "PATIENT": WhatsAppAudience.PATIENT.value,
        "PROFESSIONAL": WhatsAppAudience.PROFESSIONAL.value,
        "ADMIN": WhatsAppAudience.ADMIN.value,
    }
    return mapping.get(role, WhatsAppAudience.PUBLIC.value)


async def notify_user(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    type_: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    send_whatsapp: bool = True,
) -> Notification:
    """
    Crea la notificación in-app (siempre) y encola el envío por WhatsApp
    (si el usuario tiene teléfono y el canal está habilitado para su rol).

    IMPORTANTE: no hace `await db.commit()` — el caller sigue controlando
    la transacción igual que antes con `db.add(Notification(...))`. Solo
    hace `db.flush()` para poder leer el id recién creado si hiciera falta.
    """
    notification = Notification(
        user_id=user_id,
        title=title,
        body=body,
        type=type_,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.add(notification)
    await db.flush()

    if send_whatsapp:
        await _maybe_send_whatsapp(db, user_id, title, body, entity_type, entity_id)

    return notification


async def _maybe_send_whatsapp(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: str,
    entity_type: Optional[str],
    entity_id: Optional[str],
) -> None:
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.phone:
        return

    config = await _get_agent_config(db)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    channel_enabled = {
        "PATIENT": config.auto_reply_patients,
        "PROFESSIONAL": config.auto_reply_professionals,
        "ADMIN": True,  # el admin siempre recibe sus propias alertas
    }.get(role, config.auto_reply_public)

    if not channel_enabled:
        logger.info(f"WhatsApp deshabilitado para rol {role}, se omite envío a {user.phone}")
        return

    # Import diferido para evitar import circular (tasks importa modelos,
    # notify es importado desde los endpoints).
    from app.tasks.whatsapp_tasks import send_whatsapp_message

    message = f"*{title}*\n{body}" if title else body
    send_whatsapp_message.delay(
        phone=user.phone,
        message=message,
        audience=_audience_for_role(role),
        user_id=user_id,
        related_entity_type=entity_type,
        related_entity_id=entity_id,
        sent_by="SYSTEM",
    )
