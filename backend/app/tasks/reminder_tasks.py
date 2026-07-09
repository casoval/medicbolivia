"""
app/tasks/reminder_tasks.py
Motor de recordatorios automáticos (pestaña 2 del panel IA).

Dos mecanismos distintos, a propósito:

1. EVENTO INSTANTÁNEO (ej. "paciente esperando" en consulta inmediata):
   se dispara en el momento exacto desde el endpoint donde ocurre —
   ver `notify_professional_patient_waiting()` acá abajo, llamada desde
   consultations.py justo al crear una consulta IMMEDIATE.
   No espera al beat de Celery: la urgencia es real (el profesional
   tiene ~2 min para aceptar).

2. CRON PERIÓDICO (ej. "tu cita es en 24h"): `check_scheduled_
   appointment_reminders` corre cada 60s (ver beat_schedule en
   celery_app.py) y revisa qué ReminderRule de tipo
   SCHEDULED_APPOINTMENT_REMINDER debe dispararse ahora, comparando
   contra Consultation.scheduled_at.
"""
import asyncio
from datetime import datetime, timedelta

from sqlalchemy import select, and_
from loguru import logger

from app.core.celery_app import celery_app
from app.db.database import AsyncSessionLocal, engine
from app.models.models import (
    ReminderRule, ReminderLog, Consultation, ConsultationType, ConsultationStatus,
    Patient, Professional, WhatsAppAudience,
)
from app.tasks.whatsapp_tasks import send_whatsapp_message


def _fill_template(template: str, **kwargs) -> str:
    try:
        return template.format(**kwargs)
    except KeyError:
        # Si la plantilla usa una variable que no le pasamos, se muestra
        # sin reemplazar en vez de romper el envío completo.
        return template


# ── 1. Evento instantáneo: paciente esperando (consulta inmediata) ──

async def _notify_professional_patient_waiting(consultation_id: str) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Consultation).where(Consultation.id == consultation_id)
        )
        consultation = result.scalar_one_or_none()
        if not consultation or not consultation.professional_id:
            return

        prof_result = await db.execute(
            select(Professional).where(Professional.id == consultation.professional_id)
        )
        professional = prof_result.scalar_one_or_none()
        pat_result = await db.execute(
            select(Patient).where(Patient.id == consultation.patient_id)
        )
        patient = pat_result.scalar_one_or_none()
        if not professional or not patient:
            return

        # user_id del profesional (para el log/audiencia)
        from app.models.models import User
        user_result = await db.execute(select(User).where(User.id == professional.user_id))
        prof_user = user_result.scalar_one_or_none()
        if not prof_user or not prof_user.phone:
            return

        message = (
            f"🩺 *Tienes un paciente esperando*\n\n"
            f"{patient.first_name} {patient.last_name} solicitó una consulta inmediata "
            f"({consultation.specialty or professional.specialty}).\n"
            f"Tienes 2 minutos para aceptarla desde la app antes de que se reasigne."
        )
        send_whatsapp_message.delay(
            phone=prof_user.phone,
            message=message,
            audience=WhatsAppAudience.PROFESSIONAL.value,
            user_id=professional.user_id,
            related_entity_type="Consultation",
            related_entity_id=consultation.id,
            sent_by="SYSTEM",
        )
        logger.info(f"WhatsApp 'paciente esperando' encolado para profesional {professional.id} (consulta {consultation.id})")


@celery_app.task(name="app.tasks.reminder_tasks.notify_professional_patient_waiting")
def notify_professional_patient_waiting(consultation_id: str):
    """
    Llamar con `.delay(consultation.id)` justo después de crear una
    Consultation con consultation_type=IMMEDIATE, en
    consultations.py::create_consultation (mismo lugar donde hoy se
    dispara `auto_cancel_expired`).
    """
    # asyncio.run() crea un event loop nuevo en cada llamada, pero el
    # pool de conexiones de `engine` es un singleton de módulo pensado
    # para el loop único y persistente de FastAPI. Sin este dispose(),
    # una conexión del pool creada en un loop anterior (ya cerrado)
    # puede reusarse acá y asyncpg tira "attached to a different loop".
    # Ver mismo fix en check_scheduled_appointment_reminders más abajo.
    asyncio.run(_notify_professional_patient_waiting(consultation_id))
    asyncio.run(engine.dispose())


# ── 2. Cron: recordatorios de citas agendadas ──

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

                await _send_reminder_for_rule(db, rule, consultation)

        await db.commit()


async def _send_reminder_for_rule(db, rule: ReminderRule, consultation: Consultation) -> None:
    from app.models.models import User

    pat_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
    patient = pat_result.scalar_one_or_none()
    prof_result = await db.execute(select(Professional).where(Professional.id == consultation.professional_id))
    professional = prof_result.scalar_one_or_none()
    if not patient or not professional:
        return

    targets = []
    if rule.audience in ("PATIENT",):
        user_result = await db.execute(select(User).where(User.id == patient.user_id))
        u = user_result.scalar_one_or_none()
        if u:
            targets.append((u, patient, professional))
    if rule.audience in ("PROFESSIONAL",):
        user_result = await db.execute(select(User).where(User.id == professional.user_id))
        u = user_result.scalar_one_or_none()
        if u:
            targets.append((u, patient, professional))

    scheduled = consultation.scheduled_at
    for user, pat, prof in targets:
        if not user.phone:
            db.add(ReminderLog(
                rule_id=rule.id, user_id=user.id,
                related_entity_type="Consultation", related_entity_id=consultation.id,
                status="SKIPPED", error_detail="Usuario sin teléfono registrado",
            ))
            continue

        message = _fill_template(
            rule.message_template,
            paciente=f"{pat.first_name} {pat.last_name}",
            profesional=f"{prof.first_name} {prof.last_name}",
            especialidad=consultation.specialty or prof.specialty,
            fecha=scheduled.strftime("%d/%m/%Y") if scheduled else "",
            hora=scheduled.strftime("%H:%M") if scheduled else "",
        )

        send_whatsapp_message.delay(
            phone=user.phone,
            message=message,
            audience=rule.audience,
            user_id=user.id,
            related_entity_type="Consultation",
            related_entity_id=consultation.id,
            sent_by="SYSTEM",
        )
        db.add(ReminderLog(
            rule_id=rule.id, user_id=user.id,
            related_entity_type="Consultation", related_entity_id=consultation.id,
            status="SENT",
        ))


@celery_app.task(name="app.tasks.reminder_tasks.check_scheduled_appointment_reminders")
def check_scheduled_appointment_reminders():
    asyncio.run(_check_scheduled_appointment_reminders())
    asyncio.run(engine.dispose())
