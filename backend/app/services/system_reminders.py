"""
app/services/system_reminders.py
Punto único para disparar cualquiera de los 12 recordatorios "de sistema"
del catálogo (ver app/db/seed_system_reminders.py) desde el código de
negocio — consultations.py, reminder_tasks.py — sin repetir en cada
endpoint: buscar la regla, respetar is_active, rellenar la plantilla,
mandar el WhatsApp y dejar el registro en reminder_logs (para que se vea
como "nota" en la pestaña Recordatorios del panel).

Dos modos de envío:
  - stagger_seconds=None (default): instantáneo, vía send_whatsapp_message
    .delay(). Usar para eventos que ocurren de a uno por vez y donde la
    inmediatez importa (paciente esperando, pago confirmado, cancelación).
  - stagger_seconds=N: encola el envío con `countdown=N` (Celery
    apply_async) en vez de mandarlo ya. Lo usa reminder_tasks.py para
    escalonar lotes (ej. 20 citas a la misma hora, o el barrido diario de
    mensajes sin leer) — cada mensaje del lote sale con N segundos de
    diferencia respecto al anterior, para no mandar todo en el mismo
    instante y arriesgar que whatsapp-web.js (que simula un WhatsApp Web
    real) sea detectado y bloqueado por un volumen no-humano de envíos
    simultáneos.
"""
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.models.models import ReminderRule, ReminderLog, User
from app.tasks.whatsapp_tasks import send_whatsapp_message

# Separación por defecto entre mensajes de un mismo lote escalonado.
DEFAULT_STAGGER_SECONDS = 4.0


def _fill_template(template: str, **kwargs) -> str:
    try:
        return template.format(**kwargs)
    except KeyError:
        # Si la plantilla usa una variable que no le pasamos (ej. el admin
        # editó el texto y agregó {algo} que no existe para este trigger),
        # se manda sin reemplazar en vez de romper el envío completo.
        return template


async def fire_system_reminder(
    db: AsyncSession,
    rule_id: str,
    user_id: str,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[str] = None,
    stagger_seconds: Optional[float] = None,
    **template_vars,
) -> None:
    """
    Dispara UNA de las 12 reglas fijas (`rule_id` = una constante de
    app.db.seed_system_reminders.SystemReminderID) para un user_id puntual.

    No hace `await db.commit()` — el caller sigue controlando su propia
    transacción, mismo patrón que notify_user().
    """
    rule_result = await db.execute(select(ReminderRule).where(ReminderRule.id == rule_id))
    rule = rule_result.scalar_one_or_none()
    if not rule:
        # No debería pasar en un ambiente donde corrió el seed al arrancar,
        # pero no tiene sentido tumbar el flujo de negocio (pago, cancelación...)
        # por esto — solo se pierde el aviso de WhatsApp.
        logger.warning(f"fire_system_reminder: regla {rule_id} no existe (¿faltó el seed de sistema?)")
        return
    if not rule.is_active:
        return

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.phone:
        db.add(ReminderLog(
            rule_id=rule.id, user_id=user_id,
            related_entity_type=related_entity_type, related_entity_id=related_entity_id,
            status="SKIPPED", error_detail="Usuario sin teléfono registrado",
        ))
        return

    message = _fill_template(rule.message_template, **template_vars)
    send_kwargs = dict(
        phone=user.phone, message=message, audience=rule.audience, user_id=user.id,
        related_entity_type=related_entity_type, related_entity_id=related_entity_id, sent_by="SYSTEM",
    )

    if stagger_seconds:
        send_whatsapp_message.apply_async(kwargs=send_kwargs, countdown=stagger_seconds)
    else:
        send_whatsapp_message.delay(**send_kwargs)

    db.add(ReminderLog(
        rule_id=rule.id, user_id=user_id,
        related_entity_type=related_entity_type, related_entity_id=related_entity_id,
        status="SENT",
    ))
