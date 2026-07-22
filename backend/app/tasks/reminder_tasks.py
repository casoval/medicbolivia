"""
app/tasks/reminder_tasks.py
Motor de recordatorios automáticos (pestaña 2 del panel IA).

Tres mecanismos, a propósito:

1. EVENTO INSTANTÁNEO puntual (ej. "paciente esperando", "pago
   confirmado", "cancelación") — se dispara en el momento exacto desde el
   endpoint donde ocurre (ver fire_system_reminder() llamado desde acá y
   desde consultations.py). Nunca hay muchos a la vez del mismo tipo en el
   mismo segundo, así que se manda sin escalonar.

2. CRON de citas agendadas (`check_scheduled_appointment_reminders`, cada
   60s): revisa qué ReminderRule de tipo SCHEDULED_APPOINTMENT_REMINDER
   debe dispararse ahora, comparando contra Consultation.scheduled_at. Acá
   sí puede haber varias citas cayendo en la misma ventana (ej. 20 citas
   agendadas todas a la 1pm) — todo el lote de esa corrida se manda
   ESCALONADO (unos segundos de diferencia entre uno y otro) para no
   parecerle a WhatsApp un envío masivo no-humano.

3. CRON diario de mensajes sin leer (`send_unread_messages_reminder`,
   20:00 hora La Paz): mismo criterio de escalonado que el punto 2.
"""
import asyncio
from datetime import datetime, timedelta

from sqlalchemy import select, and_
from loguru import logger

from app.core.celery_app import celery_app
from app.db.database import AsyncSessionLocal, engine
from app.db.seed_system_reminders import SystemReminderID
from app.models.models import (
    ReminderRule, ReminderLog, Consultation, ConsultationType, ConsultationStatus,
    Patient, Professional, User, ChatMessage, ChatConversation, ChatConversationStatus,
)
from app.services.system_reminders import fire_system_reminder, DEFAULT_STAGGER_SECONDS


# ── 1. Evento instantáneo: paciente esperando (consulta inmediata) ──
# (recordatorio #1 del catálogo — dispara desde consultations.py::create_consultation,
#  no espera al beat: la urgencia es real, el profesional tiene ~5 min para aceptar)

async def _notify_professional_patient_waiting(consultation_id: str) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
        consultation = result.scalar_one_or_none()
        if not consultation or not consultation.professional_id:
            return

        prof_result = await db.execute(select(Professional).where(Professional.id == consultation.professional_id))
        professional = prof_result.scalar_one_or_none()
        pat_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient = pat_result.scalar_one_or_none()
        if not professional or not patient:
            return

        await fire_system_reminder(
            db, SystemReminderID.PROF_IMMEDIATE_WAITING, professional.user_id,
            related_entity_type="Consultation", related_entity_id=consultation.id,
            paciente=f"{patient.first_name} {patient.last_name}",
            especialidad=consultation.specialty or professional.specialty,
        )
        await db.commit()
        logger.info(f"WhatsApp 'paciente esperando' encolado para profesional {professional.id} (consulta {consultation.id})")


@celery_app.task(name="app.tasks.reminder_tasks.notify_professional_patient_waiting")
def notify_professional_patient_waiting(consultation_id: str):
    """
    Llamar con `.delay(consultation.id)` justo después de crear una
    Consultation con consultation_type=IMMEDIATE, en
    consultations.py::create_consultation.
    """
    # asyncio.run() crea un event loop nuevo en cada llamada, pero el
    # pool de conexiones de `engine` es un singleton de módulo pensado
    # para el loop único y persistente de FastAPI. Sin este dispose(),
    # una conexión del pool creada en un loop anterior (ya cerrado)
    # puede reusarse acá y asyncpg tira "attached to a different loop".
    asyncio.run(_notify_professional_patient_waiting(consultation_id))
    asyncio.run(engine.dispose())


# ── 2. Cron: recordatorios de citas agendadas (#4 profesional / #1 paciente) ──

async def _check_scheduled_appointment_reminders() -> None:
    async with AsyncSessionLocal() as db:
        rules_result = await db.execute(
            select(ReminderRule).where(
                ReminderRule.trigger_type == "SCHEDULED_APPOINTMENT_REMINDER",
                ReminderRule.is_active == True,
            )
        )
        rules = rules_result.scalars().all()
        if not rules:
            return

        now = datetime.utcnow()
        stagger_index = 0  # comparte el contador entre TODAS las reglas/citas de esta corrida

        for rule in rules:
            if not rule.offset_minutes:
                continue
            target_time = now + timedelta(minutes=rule.offset_minutes)
            # Ventana de 60s (coincide con la frecuencia del beat) para no
            # perder ni duplicar el disparo por el margen de ejecución.
            window_start = target_time - timedelta(seconds=30)
            window_end = target_time + timedelta(seconds=30)

            cons_result = await db.execute(
                select(Consultation).where(
                    and_(
                        Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                        Consultation.status == ConsultationStatus.PAYMENT_CONFIRMED,
                        Consultation.scheduled_at >= window_start,
                        Consultation.scheduled_at <= window_end,
                    )
                )
            )
            consultations = cons_result.scalars().all()

            for consultation in consultations:
                # Evitar duplicados: ¿ya se mandó este recordatorio para
                # esta consulta con esta regla?
                existing = await db.execute(
                    select(ReminderLog).where(
                        ReminderLog.rule_id == rule.id,
                        ReminderLog.related_entity_id == consultation.id,
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                # Si la cita se agendó con menos anticipación que el
                # offset del recordatorio (ej. se agendó "para dentro de
                # 40 min" y la regla es "avisar 1h antes"), no tiene
                # sentido mandarlo — por lógica, quien la agendó sabe que
                # es en breve. Se deja constancia como SKIPPED igual, para
                # que quede visible en el log de la regla.
                lead_time = consultation.scheduled_at - consultation.created_at
                if lead_time <= timedelta(minutes=rule.offset_minutes):
                    db.add(ReminderLog(
                        rule_id=rule.id, user_id=None,
                        related_entity_type="Consultation", related_entity_id=consultation.id,
                        status="SKIPPED",
                        error_detail=f"Cita agendada con {int(lead_time.total_seconds() // 60)} min de anticipación (< {rule.offset_minutes} min) — no hace falta avisar.",
                    ))
                    continue

                sent = await _send_reminder_for_rule(db, rule, consultation, stagger_index)
                if sent:
                    stagger_index += 1

        await db.commit()


async def _send_reminder_for_rule(db, rule: ReminderRule, consultation: Consultation, stagger_index: int) -> bool:
    pat_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
    patient = pat_result.scalar_one_or_none()
    prof_result = await db.execute(select(Professional).where(Professional.id == consultation.professional_id))
    professional = prof_result.scalar_one_or_none()
    if not patient or not professional:
        return False

    target_user_id = patient.user_id if rule.audience == "PATIENT" else (
        professional.user_id if rule.audience == "PROFESSIONAL" else None
    )
    if not target_user_id:
        return False

    scheduled = consultation.scheduled_at
    await fire_system_reminder(
        db, rule.id, target_user_id,
        related_entity_type="Consultation", related_entity_id=consultation.id,
        # Escalonado: cada cita de este mismo lote sale
        # DEFAULT_STAGGER_SECONDS después de la anterior en vez de todas
        # en el mismo instante — importante si hay muchas citas cayendo
        # en la misma ventana horaria.
        stagger_seconds=stagger_index * DEFAULT_STAGGER_SECONDS,
        paciente=f"{patient.first_name} {patient.last_name}",
        profesional=f"{professional.first_name} {professional.last_name}",
        especialidad=consultation.specialty or professional.specialty,
        fecha=scheduled.strftime("%d/%m/%Y") if scheduled else "",
        hora=scheduled.strftime("%H:%M") if scheduled else "",
    )
    return True


@celery_app.task(name="app.tasks.reminder_tasks.check_scheduled_appointment_reminders")
def check_scheduled_appointment_reminders():
    asyncio.run(_check_scheduled_appointment_reminders())
    asyncio.run(engine.dispose())


# ── 3. Cron diario 20:00 (La Paz): mensajes sin leer (#6 profesional / #2 paciente) ──

async def _send_unread_messages_reminder() -> None:
    async with AsyncSessionLocal() as db:
        # Quién tiene mensajes sin leer (sender_id = quién escribió). Se
        # agrupa por remitente+conversación primero para saber de qué lado
        # (paciente/profesional) viene cada uno...
        result = await db.execute(
            select(ChatMessage.conversation_id, ChatMessage.sender_id)
            .join(ChatConversation, ChatConversation.id == ChatMessage.conversation_id)
            .where(
                ChatMessage.read_at.is_(None),
                ChatConversation.status == ChatConversationStatus.ACTIVE.value,
            )
            .distinct()
        )
        rows = result.all()
        if not rows:
            return

        conv_cache: dict = {}
        # ...pero el AVISO es UNO SOLO por destinatario, sin importar en
        # cuántas conversaciones distintas tenga mensajes pendientes ni
        # quién se los mandó — no queremos 3 WhatsApp separados si el
        # profesional tiene 3 pacientes esperando respuesta, uno alcanza.
        recipients: dict[str, str] = {}  # user_id -> "PATIENT" | "PROFESSIONAL"

        for conversation_id, sender_id in rows:
            if conversation_id not in conv_cache:
                conv_result = await db.execute(select(ChatConversation).where(ChatConversation.id == conversation_id))
                conv_cache[conversation_id] = conv_result.scalar_one_or_none()
            conversation = conv_cache[conversation_id]
            if not conversation:
                continue

            is_patient_sender = sender_id == conversation.patient_user_id
            recipient_user_id = conversation.professional_user_id if is_patient_sender else conversation.patient_user_id
            recipients[recipient_user_id] = "PROFESSIONAL" if is_patient_sender else "PATIENT"

        stagger_index = 0
        for recipient_user_id, recipient_role in recipients.items():
            rule_id = SystemReminderID.PROF_UNREAD_8PM if recipient_role == "PROFESSIONAL" else SystemReminderID.PATIENT_UNREAD_8PM
            await fire_system_reminder(
                db, rule_id, recipient_user_id,
                related_entity_type="User", related_entity_id=recipient_user_id,
                stagger_seconds=stagger_index * DEFAULT_STAGGER_SECONDS,
            )
            stagger_index += 1

        await db.commit()
        logger.info(f"Recordatorio de mensajes sin leer: {stagger_index} aviso(s) encolado(s), escalonados cada {DEFAULT_STAGGER_SECONDS}s")


@celery_app.task(name="app.tasks.reminder_tasks.send_unread_messages_reminder")
def send_unread_messages_reminder():
    asyncio.run(_send_unread_messages_reminder())
    asyncio.run(engine.dispose())
