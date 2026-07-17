"""
app/core/celery_app.py
Instancia de Celery para tareas en segundo plano y programadas
(recordatorios de citas, backups de BD a Gmail).

Usa el Redis que ya corre en el proyecto (ver REDIS_URL en config.py),
pero en índices de base de datos separados para no mezclar keys con el
uso actual de Redis (OTP / rate limiting en auth.py):
  - índice 0: uso actual (auth.py)
  - índice 1: broker de Celery
  - índice 2: result backend de Celery

Cómo correr esto en producción (agregar a ecosystem.config.js, procesos
nuevos junto al backend):
  - Worker:      celery -A app.core.celery_app worker --loglevel=info
  - Beat (cron): celery -A app.core.celery_app beat --loglevel=info
"""
from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "medicbolivia",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.whatsapp_tasks",
        "app.tasks.reminder_tasks",
        "app.tasks.backup_tasks",
        "app.tasks.chat_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/La_Paz",
    enable_utc=True,
    task_track_started=True,
    # Reintentos automáticos ante fallo de red (ej. whatsapp-service caído
    # un instante) — no queremos perder un recordatorio por un timeout.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)

# ── Tareas programadas (Celery Beat) ──────────────────
celery_app.conf.beat_schedule = {
    # Revisa cada minuto citas agendadas próximas y dispara los
    # ReminderRule de tipo SCHEDULED_APPOINTMENT_REMINDER cuyo
    # offset_minutes coincida con el tiempo restante.
    "check-scheduled-appointment-reminders": {
        "task": "app.tasks.reminder_tasks.check_scheduled_appointment_reminders",
        "schedule": 60.0,
    },
    # Recordatorios #6 (profesional) / #2 (paciente): mensajes de chat sin
    # leer. Corre una vez al día a las 20:00 — como `timezone` arriba está
    # en "America/La_Paz", crontab(hour=20) es hora de La Paz, no UTC.
    "send-unread-messages-reminder": {
        "task": "app.tasks.reminder_tasks.send_unread_messages_reminder",
        "schedule": crontab(hour=20, minute=0),
    },
    # Revisa cada hora si hay que correr el backup de BD según
    # DBBackupConfig (frequency + hour_utc).
    "check-db-backup-schedule": {
        "task": "app.tasks.backup_tasks.check_and_run_backup",
        "schedule": crontab(minute=0),
    },
    # Cierra a solo-lectura las conversaciones de chat cuya ventana
    # post-consulta (Consultation.ended_at + CHAT_WINDOW_DAYS) ya venció.
    "expire-chat-conversations": {
        "task": "app.tasks.chat_tasks.expire_chat_conversations",
        "schedule": crontab(minute="*/15"),
    },
}
