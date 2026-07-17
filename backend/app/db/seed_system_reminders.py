"""
app/db/seed_system_reminders.py
Catálogo fijo de los 12 recordatorios "de sistema" (is_system=True) que
define el negocio para Profesionales y Pacientes — no son plantillas
libres que un admin arma desde cero, son la traducción a filas de
`reminder_rules` de la lógica que ya vive en el código (consultations.py,
reminder_tasks.py) para que:
  1. Cada disparo quede loggeado en `reminder_logs` y sea visible en el
     panel Recordatorios como una "nota", igual que las reglas libres.
  2. El admin pueda pausar (is_active) o retocar el texto
     (message_template) de cada una sin tocar código.

Lo que el admin NO puede hacer (bloqueado en whatsapp.py) es borrarlas o
cambiarles trigger_type/audience — eso está atado 1:1 a un hook específico
en el backend (ver dónde se llama `_fire_system_reminder` /
`_check_scheduled_appointment_reminders` / `_send_unread_messages_reminder`
por cada trigger_type).

Se siembra sola al arrancar el backend (ver lifespan en app/main.py) y
también se puede correr a mano:
    python -m app.db.seed_system_reminders
Es idempotente por `id` fijo — si la fila ya existe, no se pisa el texto
que el admin haya editado; solo se crea si falta.
"""
import asyncio

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import ReminderRule, ReminderTriggerType, WhatsAppAudience

PATIENT = WhatsAppAudience.PATIENT.value
PROFESSIONAL = WhatsAppAudience.PROFESSIONAL.value


class SystemReminderID:
    """IDs fijos de las 12 reglas — usar estas constantes desde el código
    de negocio (consultations.py, reminder_tasks.py) en vez de escribir
    el string a mano, para no tipear mal un id y disparar la regla que no es."""
    PROF_IMMEDIATE_WAITING = "00000000-0000-0000-0000-000000000001"
    PROF_IMMEDIATE_PAID = "00000000-0000-0000-0000-000000000002"
    PROF_IMMEDIATE_CANCELLED = "00000000-0000-0000-0000-000000000003"
    PROF_APPOINTMENT_1H = "00000000-0000-0000-0000-000000000004"
    PROF_APPOINTMENT_PAID = "00000000-0000-0000-0000-000000000005"
    PROF_UNREAD_8PM = "00000000-0000-0000-0000-000000000006"
    PROF_RESCHEDULE_PROPOSED = "00000000-0000-0000-0000-000000000007"
    PROF_APPOINTMENT_CANCELLED = "00000000-0000-0000-0000-000000000008"
    PATIENT_APPOINTMENT_1H = "00000000-0000-0000-0000-000000000009"
    PATIENT_UNREAD_8PM = "00000000-0000-0000-0000-000000000010"
    PATIENT_RESCHEDULE_PROPOSED = "00000000-0000-0000-0000-000000000011"
    PATIENT_APPOINTMENT_CANCELLED = "00000000-0000-0000-0000-000000000012"

# Cierre fijo que llevan las 12 plantillas — el admin puede reescribir el
# resto del texto, pero este recordatorio de "todo pasa por la plataforma"
# se repite siempre al final para que WhatsApp nunca reemplace a la app.
CTA = "\n\nRevisa medicbolivia.com para más detalles."

# IDs fijos (no aleatorios) para que el seed sea idempotente entre corridas
# y entornos — así el mismo recordatorio siempre tiene el mismo id en dev,
# staging y prod.
SYSTEM_REMINDER_RULES = [
    # ═══ PROFESIONAL ═══
    {
        "id": SystemReminderID.PROF_IMMEDIATE_WAITING,
        "name": "1. Paciente esperando (consulta inmediata)",
        "trigger_type": ReminderTriggerType.IMMEDIATE_CONSULTATION_WAITING.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        "message_template": (
            "🩺 *Tienes un paciente esperando*\n\n"
            "{paciente} solicitó una consulta inmediata ({especialidad}).\n"
            "Tienes 2 minutos para aceptarla desde la app antes de que se reasigne." + CTA
        ),
    },
    {
        "id": SystemReminderID.PROF_IMMEDIATE_PAID,
        "name": "2. Paciente pagó la consulta inmediata",
        "trigger_type": ReminderTriggerType.IMMEDIATE_CONSULTATION_PAID.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        "message_template": (
            "💰 *Pago confirmado*\n\n"
            "{paciente} ya pagó la consulta inmediata ({especialidad}). Puedes iniciarla desde la app." + CTA
        ),
    },
    {
        "id": SystemReminderID.PROF_IMMEDIATE_CANCELLED,
        "name": "3. Paciente canceló la consulta inmediata",
        "trigger_type": ReminderTriggerType.IMMEDIATE_CONSULTATION_CANCELLED.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        "message_template": "❌ *Consulta cancelada*\n\n{paciente} canceló la consulta inmediata antes de iniciar." + CTA,
    },
    {
        "id": SystemReminderID.PROF_APPOINTMENT_1H,
        "name": "4. Cita agendada — 1 hora antes",
        "trigger_type": ReminderTriggerType.SCHEDULED_APPOINTMENT_REMINDER.value,
        "audience": PROFESSIONAL,
        "offset_minutes": 60,
        "message_template": "🗓️ *Recordatorio de cita*\n\nTienes una cita con {paciente} ({especialidad}) hoy a las {hora}." + CTA,
    },
    {
        "id": SystemReminderID.PROF_APPOINTMENT_PAID,
        "name": "5. Paciente pagó una cita agendada",
        "trigger_type": ReminderTriggerType.SCHEDULED_APPOINTMENT_PAID.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        "message_template": (
            "💰 *Pago confirmado*\n\n"
            "{paciente} pagó su cita del {fecha} a las {hora} ({especialidad}). Confírmala desde la app." + CTA
        ),
    },
    {
        "id": SystemReminderID.PROF_UNREAD_8PM,
        "name": "6. Mensajes sin leer (20:00)",
        "trigger_type": ReminderTriggerType.UNREAD_MESSAGES_8PM.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        # Genérico a propósito — es UN solo aviso por profesional aunque
        # tenga mensajes pendientes de varios pacientes distintos, así
        # que no nombra a nadie en particular (ver _send_unread_messages_reminder).
        "message_template": "💬 *Tienes mensajes sin leer*\n\nTienes mensajes sin leer en el chat de la plataforma." + CTA,
    },
    {
        "id": SystemReminderID.PROF_RESCHEDULE_PROPOSED,
        "name": "7. Paciente propuso reprogramar la cita",
        "trigger_type": ReminderTriggerType.APPOINTMENT_RESCHEDULE_PROPOSED.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        "message_template": (
            "🔄 *Propuesta de reprogramación*\n\n"
            "{paciente} propuso cambiar la cita al {fecha} a las {hora}. Revísala y responde desde la app." + CTA
        ),
    },
    {
        "id": SystemReminderID.PROF_APPOINTMENT_CANCELLED,
        "name": "8. Paciente canceló la cita agendada",
        "trigger_type": ReminderTriggerType.APPOINTMENT_CANCELLED_BY_PATIENT.value,
        "audience": PROFESSIONAL,
        "offset_minutes": None,
        "message_template": "❌ *Cita cancelada*\n\n{paciente} canceló la cita agendada del {fecha} a las {hora}." + CTA,
    },
    # ═══ PACIENTE ═══
    {
        "id": SystemReminderID.PATIENT_APPOINTMENT_1H,
        "name": "1. Cita agendada — 1 hora antes (paciente)",
        "trigger_type": ReminderTriggerType.SCHEDULED_APPOINTMENT_REMINDER.value,
        "audience": PATIENT,
        "offset_minutes": 60,
        "message_template": "🗓️ *Recordatorio de cita*\n\nTienes una cita con {profesional} ({especialidad}) hoy a las {hora}." + CTA,
    },
    {
        "id": SystemReminderID.PATIENT_UNREAD_8PM,
        "name": "2. Mensajes sin leer (20:00) — paciente",
        "trigger_type": ReminderTriggerType.UNREAD_MESSAGES_8PM.value,
        "audience": PATIENT,
        "offset_minutes": None,
        "message_template": "💬 *Tienes mensajes sin leer*\n\nTienes mensajes sin leer en el chat de la plataforma." + CTA,
    },
    {
        "id": SystemReminderID.PATIENT_RESCHEDULE_PROPOSED,
        "name": "3. Profesional propuso reprogramar la cita",
        "trigger_type": ReminderTriggerType.APPOINTMENT_RESCHEDULE_PROPOSED.value,
        "audience": PATIENT,
        "offset_minutes": None,
        "message_template": (
            "🔄 *Propuesta de reprogramación*\n\n"
            "{profesional} propuso cambiar tu cita al {fecha} a las {hora}. Revísala y responde desde la app." + CTA
        ),
    },
    {
        "id": SystemReminderID.PATIENT_APPOINTMENT_CANCELLED,
        "name": "4. Profesional canceló la cita agendada",
        "trigger_type": ReminderTriggerType.APPOINTMENT_CANCELLED_BY_PROFESSIONAL.value,
        "audience": PATIENT,
        "offset_minutes": None,
        "message_template": "❌ *Cita cancelada*\n\nEl Dr(a). {profesional} canceló tu cita agendada del {fecha} a las {hora}." + CTA,
    },
]


async def ensure_system_reminder_rules() -> int:
    """Crea las filas que falten. No pisa ediciones existentes. Devuelve cuántas creó."""
    created = 0
    async with AsyncSessionLocal() as db:
        for spec in SYSTEM_REMINDER_RULES:
            existing = await db.execute(select(ReminderRule).where(ReminderRule.id == spec["id"]))
            if existing.scalar_one_or_none():
                continue
            db.add(ReminderRule(
                id=spec["id"],
                name=spec["name"],
                trigger_type=spec["trigger_type"],
                audience=spec["audience"],
                channel="WHATSAPP",
                offset_minutes=spec["offset_minutes"],
                message_template=spec["message_template"],
                is_active=True,
                is_system=True,
            ))
            created += 1
        if created:
            await db.commit()
    return created


if __name__ == "__main__":
    n = asyncio.run(ensure_system_reminder_rules())
    print(f"✅ Seed de recordatorios de sistema: {n} regla(s) nueva(s) creada(s) (de {len(SYSTEM_REMINDER_RULES)} en el catálogo).")
