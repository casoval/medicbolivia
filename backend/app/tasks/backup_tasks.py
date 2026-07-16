"""
app/tasks/backup_tasks.py
Backup automático de la base de datos, enviado por correo a Gmail
(pestaña 4 del panel IA).

Método elegido: `pg_dump` (dump comprimido) + SMTP con contraseña de
aplicación de Gmail. Ver notas de por qué en config.py (GMAIL_APP_PASSWORD).

Si el dump supera BACKUP_MAX_ATTACHMENT_MB, se sube al bucket privado de
R2 (mismo patrón que documentos/adjuntos de chat, ver app/services/storage.py)
y se manda un link firmado (BACKUP_R2_LINK_EXPIRES_HOURS) en el cuerpo del
correo en vez del archivo.
"""
import asyncio
import gzip
import shutil
import smtplib
import subprocess
import tempfile
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

from sqlalchemy import select
from loguru import logger

from app.core.celery_app import celery_app
from app.core.config import settings
from app.db.database import AsyncSessionLocal, engine
from app.models.models import DBBackupConfig, DBBackupLog
from app.services.storage import upload_backup_to_r2, get_presigned_url


def _dump_database(dest_path: Path) -> None:
    """
    Ejecuta pg_dump usando DATABASE_URL_SYNC (formato postgresql://...,
    el mismo que ya existe en config.py para scripts de mantenimiento) y
    comprime el resultado con gzip.
    """
    sql_path = dest_path.with_suffix(".sql")
    result = subprocess.run(
        ["pg_dump", settings.DATABASE_URL_SYNC, "-f", str(sql_path)],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump falló: {result.stderr[:500]}")

    with open(sql_path, "rb") as f_in, gzip.open(dest_path, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    sql_path.unlink(missing_ok=True)


def _send_email_with_attachment(recipients: list[str], subject: str, body: str, attachment_path: Path | None) -> None:
    if not settings.GMAIL_SENDER_ADDRESS or not settings.GMAIL_APP_PASSWORD:
        raise RuntimeError(
            "Faltan GMAIL_SENDER_ADDRESS / GMAIL_APP_PASSWORD en el .env. "
            "Generar la contraseña de aplicación en "
            "https://myaccount.google.com/apppasswords"
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.GMAIL_SENDER_ADDRESS
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    if attachment_path is not None:
        with open(attachment_path, "rb") as f:
            msg.add_attachment(
                f.read(),
                maintype="application",
                subtype="gzip",
                filename=attachment_path.name,
            )

    with smtplib.SMTP(settings.GMAIL_SMTP_HOST, settings.GMAIL_SMTP_PORT) as server:
        server.starttls()
        server.login(settings.GMAIL_SENDER_ADDRESS, settings.GMAIL_APP_PASSWORD)
        server.send_message(msg)


async def _run_backup() -> None:
    async with AsyncSessionLocal() as db:
        config_result = await db.execute(select(DBBackupConfig).where(DBBackupConfig.id == "global"))
        config = config_result.scalar_one_or_none()
        if not config or not config.is_active or not config.recipient_emails:
            return

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        status = "SUCCESS"
        error_detail = None
        file_size = None
        delivery_method = "ATTACHMENT"

        with tempfile.TemporaryDirectory() as tmp_dir:
            dump_path = Path(tmp_dir) / f"medicbolivia_backup_{timestamp}.sql.gz"
            try:
                _dump_database(dump_path)
                file_size = dump_path.stat().st_size
                max_bytes = settings.BACKUP_MAX_ATTACHMENT_MB * 1024 * 1024

                if file_size > max_bytes:
                    # Dump grande: no cabe como adjunto de Gmail (rechaza
                    # ~25MB). Se sube al bucket privado de R2 y se manda
                    # un link firmado en el cuerpo del correo en vez del
                    # archivo — mismo patrón que documentos/adjuntos de
                    # chat (ver app/services/storage.py).
                    delivery_method = "R2_LINK"
                    with open(dump_path, "rb") as f:
                        r2_url = await upload_backup_to_r2(f.read(), dump_path.name)
                    expires_seconds = settings.BACKUP_R2_LINK_EXPIRES_HOURS * 3600
                    download_link = await get_presigned_url(r2_url, expires_seconds=expires_seconds)

                    _send_email_with_attachment(
                        recipients=config.recipient_emails,
                        subject=f"[MedicBolivia] Backup de base de datos — {timestamp}",
                        body=(
                            f"Backup automático generado el {timestamp} (UTC).\n"
                            f"Tamaño: {file_size / 1024 / 1024:.2f} MB "
                            f"(supera el límite de adjunto de {settings.BACKUP_MAX_ATTACHMENT_MB}MB, "
                            "se subió a almacenamiento privado).\n\n"
                            f"Descargar backup (válido por {settings.BACKUP_R2_LINK_EXPIRES_HOURS}h):\n"
                            f"{download_link}\n\n"
                            "Este correo se generó automáticamente desde el panel "
                            "de administración → IA → Automatización."
                        ),
                        attachment_path=None,
                    )
                else:
                    _send_email_with_attachment(
                        recipients=config.recipient_emails,
                        subject=f"[MedicBolivia] Backup de base de datos — {timestamp}",
                        body=(
                            f"Backup automático generado el {timestamp} (UTC).\n"
                            f"Tamaño: {file_size / 1024 / 1024:.2f} MB\n\n"
                            "Este correo se generó automáticamente desde el panel "
                            "de administración → IA → Automatización."
                        ),
                        attachment_path=dump_path,
                    )
                logger.info(f"Backup de BD enviado a {config.recipient_emails} (método: {delivery_method})")
            except Exception as exc:
                status = "FAILED"
                error_detail = str(exc)[:290]
                logger.error(f"Backup de BD falló: {error_detail}")

        db.add(DBBackupLog(
            status=status,
            file_size_bytes=file_size,
            recipients=config.recipient_emails,
            error_detail=error_detail,
            delivery_method=delivery_method,
        ))
        await db.commit()


@celery_app.task(name="app.tasks.backup_tasks.run_backup_now")
def run_backup_now():
    """Disparo manual — botón 'Enviar backup ahora' en la pestaña 4."""
    asyncio.run(_run_backup())
    asyncio.run(engine.dispose())


async def _check_and_run_backup() -> None:
    async with AsyncSessionLocal() as db:
        config_result = await db.execute(select(DBBackupConfig).where(DBBackupConfig.id == "global"))
        config = config_result.scalar_one_or_none()
        if not config or not config.is_active:
            return

        now = datetime.utcnow()
        if now.hour != config.hour_utc:
            return
        if config.frequency == "WEEKLY" and now.weekday() != 0:  # lunes
            return

        # Evita correr dos veces en la misma hora si el beat se reinicia:
        # revisa si ya hay un log de hoy en esta hora.
        last_log_result = await db.execute(
            select(DBBackupLog).order_by(DBBackupLog.created_at.desc()).limit(1)
        )
        last_log = last_log_result.scalar_one_or_none()
        if last_log and last_log.created_at.date() == now.date() and last_log.created_at.hour == now.hour:
            return

    await _run_backup()


@celery_app.task(name="app.tasks.backup_tasks.check_and_run_backup")
def check_and_run_backup():
    asyncio.run(_check_and_run_backup())
    asyncio.run(engine.dispose())
