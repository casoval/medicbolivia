"""
app/api/v1/endpoints/whatsapp.py
Backend del menú "IA" del panel admin (4 pestañas):
  1. GET  /whatsapp/status                 → monitor del bot
  2. CRUD /whatsapp/reminders               → recordatorios automáticos
  3. GET  /whatsapp/conversations           → inbox + toggle agente
  4. CRUD /whatsapp/backup-config           → automatización BD → Gmail

  + POST /whatsapp/webhook/inbound          → llamado por whatsapp-service
    (Node/whatsapp-web.js) cada vez que llega un mensaje nuevo al número real.
"""
from datetime import datetime, timedelta
from app.core.timezone import utcnow_naive, utc_naive_to_bolivia_naive
from typing import Optional, List
import hmac

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.core.config import settings
from app.core.phone import normalize_bo_phone, InvalidPhoneError
from app.core.redis_client import security_redis_client
from app.services.whatsapp_pause import get_pause_info, set_whatsapp_paused
from app.models.models import (
    User, Patient, Professional, Admin, WhatsAppConversation, WhatsAppMessage, WhatsAppAudience,
    AgentConfig, ReminderRule, ReminderLog, DBBackupConfig, DBBackupLog,
)
from app.tasks.whatsapp_tasks import send_whatsapp_message
from app.tasks.backup_tasks import run_backup_now
from app.services.consultation_actions import (
    ConsultationActionError,
    get_latest_pending_immediate_consultation,
    accept_consultation_core,
    reject_consultation_core,
)

router = APIRouter()


# ═══════════════════════════════════════════════════════
# PESTAÑA 1 — Monitor y edición del bot
# ═══════════════════════════════════════════════════════

@router.get("/status", summary="Estado de conexión del bot de WhatsApp")
async def get_whatsapp_status(current_user: User = Depends(get_current_admin)):
    """
    Consulta al microservicio Node (whatsapp-web.js) su estado real de sesión
    (vinculado / esperando QR / desconectado). Si el microservicio no
    responde, se informa como DOWN en vez de tirar un 500 — el admin
    necesita ver esto como un estado, no como un error de la página.
    """
    pause_info = await get_pause_info()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.WHATSAPP_SERVICE_URL}/status",
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
        if resp.status_code == 200:
            data = resp.json()
            return {"service_reachable": True, "paused": pause_info, **data}
        return {"service_reachable": True, "connection_state": "ERROR", "detail": resp.text[:200], "paused": pause_info}
    except httpx.RequestError as exc:
        logger.warning(f"whatsapp-service no responde: {exc}")
        return {"service_reachable": False, "connection_state": "DOWN", "detail": str(exc), "paused": pause_info}


class PauseRequest(BaseModel):
    reason: Optional[str] = None


@router.get("/pause-status", summary="Estado del kill switch de envíos")
async def get_whatsapp_pause_status(current_user: User = Depends(get_current_admin)):
    info = await get_pause_info()
    return {"paused": info is not None, "info": info}


@router.post("/pause", summary="Kill switch: frena TODO envío de WhatsApp al instante")
async def pause_whatsapp(data: PauseRequest, current_user: User = Depends(get_current_admin)):
    """
    Prende el flag global en Redis (whatsapp_pause.py). Efecto inmediato
    en todos los procesos (uvicorn y Celery worker) sin reiniciar nada:
    los envíos nuevos se cortan en el portón (wait_for_whatsapp_slot) y
    las tareas en curso se reencolan solas cada 60s hasta que se reanude.
    No cancela mensajes ya encolados ni en vuelo — solo evita que salgan
    mientras el switch esté prendido.
    """
    await set_whatsapp_paused(True, reason=data.reason or "", admin_email=current_user.email or "")
    return {"paused": True, "reason": data.reason}


@router.post("/resume", summary="Reanuda los envíos de WhatsApp")
async def resume_whatsapp(current_user: User = Depends(get_current_admin)):
    await set_whatsapp_paused(False, admin_email=current_user.email or "")
    return {"paused": False}


@router.get("/volume-stats", summary="Historial agregado de volumen de envíos (para correlacionar con un incidente)")
async def get_whatsapp_volume_stats(current_user: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """
    Cuenta mensajes salientes (direction='OUT') de whatsapp_messages,
    agregados en dos vistas:
      - Totales de la última hora y de las últimas 24h, por status
        (SENT/FAILED) y por origen (sent_by: SYSTEM/ADMIN/BOT).
      - Un desglose HORA POR HORA de las últimas 24h, para poder mirar
        "¿qué se mandó entre las 23:00 y la 1:00 de anoche?" sin ir a
        buscarlo en logs de Celery — que es justo lo que tuvimos que
        hacer a mano la noche del 13→14 de agosto.

    OJO — lo que esto NO cubre: el envío de OTP (app/services/whatsapp.py)
    no pasa por _log_message, así que no deja fila en whatsapp_messages.
    Si algún día se sospecha que un pico de OTPs contribuyó a un
    bloqueo, este endpoint no lo va a mostrar — habría que sumar un log
    aparte para esa ruta.
    """
    now = utcnow_naive()
    hour_ago = now - timedelta(hours=1)
    day_ago = now - timedelta(hours=24)

    async def _counts_since(cutoff: datetime) -> dict:
        result = await db.execute(
            select(WhatsAppMessage.status, func.count())
            .where(WhatsAppMessage.direction == "OUT", WhatsAppMessage.created_at >= cutoff)
            .group_by(WhatsAppMessage.status)
        )
        by_status = {status: count for status, count in result.all()}
        result = await db.execute(
            select(WhatsAppMessage.sent_by, func.count())
            .where(WhatsAppMessage.direction == "OUT", WhatsAppMessage.created_at >= cutoff)
            .group_by(WhatsAppMessage.sent_by)
        )
        by_sent_by = {(sent_by or "DESCONOCIDO"): count for sent_by, count in result.all()}
        return {
            "total": sum(by_status.values()),
            "sent": by_status.get("SENT", 0),
            "failed": by_status.get("FAILED", 0),
            "by_sent_by": by_sent_by,
        }

    last_hour = await _counts_since(hour_ago)
    last_24h = await _counts_since(day_ago)

    # Desglose hora por hora — se trunca a la hora en UTC (mismo dominio
    # que created_at) y se convierte a hora de Bolivia solo para el label
    # que ve el admin, sin mezclar dominios en la comparación (ver
    # advertencia en app/core/timezone.py).
    hourly_result = await db.execute(
        select(
            func.date_trunc("hour", WhatsAppMessage.created_at).label("hour_bucket"),
            WhatsAppMessage.status,
            func.count(),
        )
        .where(WhatsAppMessage.direction == "OUT", WhatsAppMessage.created_at >= day_ago)
        .group_by("hour_bucket", WhatsAppMessage.status)
        .order_by("hour_bucket")
    )
    hourly_raw: dict[datetime, dict[str, int]] = {}
    for hour_bucket, status, count in hourly_result.all():
        hourly_raw.setdefault(hour_bucket, {"sent": 0, "failed": 0})
        if status == "SENT":
            hourly_raw[hour_bucket]["sent"] = count
        elif status == "FAILED":
            hourly_raw[hour_bucket]["failed"] = count

    hourly = [
        {
            "hour_utc": hour_bucket.isoformat(),
            "hour_bolivia": utc_naive_to_bolivia_naive(hour_bucket).strftime("%H:00"),
            "sent": counts["sent"],
            "failed": counts["failed"],
        }
        for hour_bucket, counts in sorted(hourly_raw.items())
    ]

    return {
        "last_hour": last_hour,
        "last_24h": last_24h,
        "hourly_24h": hourly,
        "note": "No incluye OTP (no se loguea en whatsapp_messages).",
    }


@router.get("/qr", summary="QR pendiente para vincular el número (si aplica)")
async def get_whatsapp_qr(current_user: User = Depends(get_current_admin)):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.WHATSAPP_SERVICE_URL}/qr",
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
        return resp.json()
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="whatsapp-service no disponible")


class TestMessageRequest(BaseModel):
    phone: str
    message: str = "Mensaje de prueba desde el panel de MedicBolivia ✅"


# Cooldown por admin para /test-message. No reemplaza al rate_limit de
# Celery ni al piso global de whatsapp_throttle.py (esos siguen siendo la
# última línea de defensa real contra whatsapp-service) — esto es una
# capa aparte, PREVIA a encolar nada, pensada para el patrón que generó
# el bloqueo de la noche del 13→14: varios admins probando el bot a la
# vez desde el panel, cada click encolando un mensaje real sin ningún
# freno propio. 45s alcanza para no estorbar una prueba genuina ("¿llegó
# el mensaje?") pero corta el reflejo de "no vi nada, clickeo de nuevo".
# Vive en security_redis_client (mismo Redis que OTP/login) y no en el
# Redis de whatsapp_throttle.py, que es compartido con Celery — así un
# incidente en un dominio no ensucia namespaces del otro.
TEST_MESSAGE_COOLDOWN_SECONDS = 45
_TEST_MESSAGE_COOLDOWN_KEY_PREFIX = "whatsapp:test_message:cooldown:"


@router.post("/test-message", summary="Enviar mensaje de prueba (verificar que el bot funciona)")
async def send_test_message(data: TestMessageRequest, current_user: User = Depends(get_current_admin)):
    cooldown_key = f"{_TEST_MESSAGE_COOLDOWN_KEY_PREFIX}{current_user.id}"
    # SET NX: solo escribe si la key no existe. Si ya existía, alguien
    # (este mismo admin) mandó una prueba hace menos de
    # TEST_MESSAGE_COOLDOWN_SECONDS — se corta ANTES de encolar nada.
    acquired = await security_redis_client.set(
        cooldown_key, "1", nx=True, ex=TEST_MESSAGE_COOLDOWN_SECONDS
    )
    if not acquired:
        remaining = await security_redis_client.ttl(cooldown_key)
        remaining = max(remaining, 1)
        logger.info(
            f"whatsapp/test-message: cooldown activo para admin {current_user.id}, "
            f"{remaining}s restantes"
        )
        raise HTTPException(
            status_code=429,
            detail=f"Esperá {remaining}s antes de mandar otro mensaje de prueba.",
        )

    send_whatsapp_message.delay(
        phone=data.phone,
        message=data.message,
        audience=WhatsAppAudience.ADMIN.value,
        sent_by="ADMIN",
    )
    return {
        "status": "queued",
        "note": "El envío puede tardar unos segundos por el límite de velocidad de WhatsApp.",
    }


# ═══════════════════════════════════════════════════════
# PESTAÑA 2 — Recordatorios automáticos
# ═══════════════════════════════════════════════════════

class ReminderRuleIn(BaseModel):
    name: str
    trigger_type: str
    audience: str          # PATIENT | PROFESSIONAL | ADMIN
    channel: str = "WHATSAPP"
    offset_minutes: Optional[int] = None
    message_template: str
    is_active: bool = True


@router.get("/reminders", summary="Listar reglas de recordatorio")
async def list_reminder_rules(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(ReminderRule).order_by(ReminderRule.is_system.desc(), ReminderRule.created_at.desc()))
    rules = result.scalars().all()
    return [
        {
            "id": r.id, "name": r.name, "trigger_type": r.trigger_type,
            "audience": r.audience, "channel": r.channel,
            "offset_minutes": r.offset_minutes, "message_template": r.message_template,
            "is_active": r.is_active, "is_system": r.is_system, "created_at": r.created_at,
        }
        for r in rules
    ]


@router.post("/reminders", summary="Crear regla de recordatorio")
async def create_reminder_rule(data: ReminderRuleIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    rule = ReminderRule(**data.model_dump())  # is_system siempre False acá — las de sistema solo las crea el seed
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return {"id": rule.id, "status": "created"}


@router.put("/reminders/{rule_id}", summary="Editar regla de recordatorio")
async def update_reminder_rule(rule_id: str, data: ReminderRuleIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(ReminderRule).where(ReminderRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    if rule.is_system and (data.trigger_type != rule.trigger_type or data.audience != rule.audience):
        # Las 12 reglas del catálogo fijo están atadas 1:1 a un hook
        # específico en consultations.py/reminder_tasks.py (ver
        # SystemReminderID) — cambiarles el trigger_type o la audiencia
        # rompería ese hook sin que el admin lo note. Sí se puede editar
        # el texto, el offset y pausarla (is_active).
        raise HTTPException(
            status_code=400,
            detail="Esta es una regla de sistema: no se puede cambiar su disparador ni su audiencia. "
                   "Puedes editar el mensaje o desactivarla."
        )
    for key, value in data.model_dump().items():
        setattr(rule, key, value)
    await db.commit()
    return {"status": "updated"}


@router.delete("/reminders/{rule_id}", summary="Eliminar regla de recordatorio")
async def delete_reminder_rule(rule_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(ReminderRule).where(ReminderRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    if rule.is_system:
        raise HTTPException(
            status_code=400,
            detail="Esta es una regla de sistema y no se puede eliminar — desactívala con el switch si no la quieres usar."
        )
    await db.delete(rule)
    await db.commit()
    return {"status": "deleted"}


@router.get("/reminders/{rule_id}/logs", summary="Historial de envíos de una regla")
async def get_reminder_logs(rule_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(
        select(ReminderLog).where(ReminderLog.rule_id == rule_id).order_by(ReminderLog.sent_at.desc()).limit(100)
    )
    logs = result.scalars().all()
    return [
        {"id": l.id, "status": l.status, "error_detail": l.error_detail, "sent_at": l.sent_at,
         "related_entity_type": l.related_entity_type, "related_entity_id": l.related_entity_id}
        for l in logs
    ]


@router.get("/reminders/stats", summary="Contadores de recordatorios para el panel (hoy + últimos 7 días)")
async def get_reminder_stats(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    """
    Todo lo que el admin necesita para saber "¿esto está funcionando?" sin
    tener que entrar regla por regla:
      - per_rule: contador de HOY (enviado/fallido/omitido) por cada regla,
        para el badge que se muestra en cada card del catálogo.
      - today: el mismo desglose pero global, y por audiencia (para ver de
        un vistazo si, por ejemplo, todos los recordatorios a PROFESSIONAL
        están fallando — señal de que algo se rompió, no un caso aislado).
      - last_7_days: serie diaria (para un mini gráfico) + total de la
        semana, para detectar caídas de volumen día a día.
    """
    now = utcnow_naive()
    today_start = datetime(now.year, now.month, now.day)
    week_start = today_start - timedelta(days=6)

    # ── Por regla, solo hoy (lo que se pinta en cada card) ──
    per_rule_result = await db.execute(
        select(ReminderLog.rule_id, ReminderLog.status, func.count(ReminderLog.id))
        .where(ReminderLog.sent_at >= today_start)
        .group_by(ReminderLog.rule_id, ReminderLog.status)
    )
    per_rule: dict = {}
    for rule_id, status_, count in per_rule_result.all():
        bucket = per_rule.setdefault(rule_id, {"SENT": 0, "FAILED": 0, "SKIPPED": 0})
        bucket[status_] = count

    # ── Global de hoy, desglosado por audiencia (join contra la regla) ──
    today_audience_result = await db.execute(
        select(ReminderRule.audience, ReminderLog.status, func.count(ReminderLog.id))
        .join(ReminderRule, ReminderRule.id == ReminderLog.rule_id)
        .where(ReminderLog.sent_at >= today_start)
        .group_by(ReminderRule.audience, ReminderLog.status)
    )
    today_totals = {"SENT": 0, "FAILED": 0, "SKIPPED": 0}
    today_by_audience: dict = {}
    for audience, status_, count in today_audience_result.all():
        today_totals[status_] = today_totals.get(status_, 0) + count
        bucket = today_by_audience.setdefault(audience, {"SENT": 0, "FAILED": 0, "SKIPPED": 0})
        bucket[status_] = count

    # ── Serie diaria de los últimos 7 días (para el mini gráfico) ──
    week_result = await db.execute(
        select(func.date(ReminderLog.sent_at), ReminderLog.status, func.count(ReminderLog.id))
        .where(ReminderLog.sent_at >= week_start)
        .group_by(func.date(ReminderLog.sent_at), ReminderLog.status)
    )
    by_day: dict = {}
    for day, status_, count in week_result.all():
        day_key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        bucket = by_day.setdefault(day_key, {"SENT": 0, "FAILED": 0, "SKIPPED": 0})
        bucket[status_] = count
    # Completar los días sin ningún envío con ceros, para que el gráfico
    # no tenga huecos.
    last_7_days = []
    for i in range(7):
        day = (week_start + timedelta(days=i)).date().isoformat()
        counts = by_day.get(day, {"SENT": 0, "FAILED": 0, "SKIPPED": 0})
        last_7_days.append({"date": day, **counts})

    return {
        "per_rule": per_rule,
        "today": {"totals": today_totals, "by_audience": today_by_audience},
        "last_7_days": last_7_days,
        "week_total_sent": sum(d["SENT"] for d in last_7_days),
    }


@router.get("/reminders/feed", summary="Feed en vivo de recordatorios enviados (mensaje real + estado real de entrega)")
async def get_reminder_feed(
    since: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """
    A propósito NO lee de ReminderLog: esa tabla se escribe en el momento
    de ENCOLAR el envío (status="SENT" ahí solo significa "se mandó a la
    cola de Celery"), no cuando WhatsApp realmente confirma o rechaza el
    mensaje — eso pasa después, de forma async, y puede fallar (ver
    incidente 13→14 ago: 28 mensajes quedaron "SENT" en ReminderLog pero
    en realidad dieron 503 whatsapp-service). El texto del mensaje
    tampoco se guarda en ReminderLog.

    Ambas cosas SÍ están en WhatsAppMessage, escrito por _log_message()
    una sola vez, al final, con el resultado definitivo. `sent_by="SYSTEM"`
    es el marcador que usa fire_system_reminder() para todo recordatorio
    automático — lo distingue de "BOT" (agente IA) y "ADMIN" (respuesta
    manual desde el panel), así que filtrar por eso alcanza sin tocar
    ReminderRule/ReminderLog para nada.

    `since` = cursor de polling (mismo criterio que el resto del feed:
    el frontend manda el `created_at` de lo último que ya tiene y acá se
    devuelve solo lo nuevo, para no relampaguear la lista completa).
    """
    query = (
        select(WhatsAppMessage, WhatsAppConversation.phone, WhatsAppConversation.contact_name,
               WhatsAppConversation.user_id, WhatsAppConversation.audience)
        .join(WhatsAppConversation, WhatsAppConversation.id == WhatsAppMessage.conversation_id)
        .where(WhatsAppMessage.direction == "OUT", WhatsAppMessage.sent_by == "SYSTEM")
    )
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
        except ValueError:
            raise HTTPException(status_code=422, detail="`since` debe ser un datetime ISO válido")
        query = query.where(WhatsAppMessage.created_at > since_dt).order_by(WhatsAppMessage.created_at.asc()).limit(min(limit, 200))
    else:
        query = query.order_by(WhatsAppMessage.created_at.desc()).limit(min(limit, 200))

    result = await db.execute(query)
    rows = result.all()
    if not since:
        rows = list(reversed(rows))  # el frontend siempre pinta más nuevo arriba; reversa acá simplifica ese lado

    user_ids = [uid for _, _, _, uid, _ in rows if uid]
    names = await _resolve_platform_names(db, user_ids)

    return [
        {
            "id": msg.id,
            "recipient_name": names.get(user_id) or contact_name,
            "phone": phone,
            "audience": audience,
            "body": msg.body,
            "status": msg.status,
            "error_detail": msg.error_detail,
            "related_entity_type": msg.related_entity_type,
            "created_at": msg.created_at.isoformat(),
        }
        for msg, phone, contact_name, user_id, audience in rows
    ]


# ═══════════════════════════════════════════════════════
# PESTAÑA 3 — Conversaciones + configuración del agente
# ═══════════════════════════════════════════════════════

async def _resolve_platform_names(db: AsyncSession, user_ids: List[str]) -> dict:
    """
    Nombre real de la persona en la plataforma (Patient/Professional/Admin),
    a partir de su user_id. Se prioriza sobre el nombre de WhatsApp
    (contact_name / pushname) porque es el dato que el admin realmente
    reconoce y no depende de que el usuario tenga configurado un nombre
    de perfil en WhatsApp.
    """
    user_ids = [uid for uid in set(user_ids) if uid]
    if not user_ids:
        return {}

    names: dict = {}

    patients = await db.execute(
        select(Patient.user_id, Patient.first_name, Patient.last_name)
        .where(Patient.user_id.in_(user_ids))
    )
    for uid, first, last in patients.all():
        names[uid] = f"{first} {last}".strip()

    professionals = await db.execute(
        select(Professional.user_id, Professional.first_name, Professional.last_name)
        .where(Professional.user_id.in_(user_ids))
    )
    for uid, first, last in professionals.all():
        names[uid] = f"{first} {last}".strip()

    admins = await db.execute(
        select(Admin.user_id, Admin.name).where(Admin.user_id.in_(user_ids))
    )
    for uid, name in admins.all():
        names[uid] = name

    return names


def _display_name(platform_name: Optional[str], contact_name: Optional[str], phone: str) -> str:
    """Prioridad: nombre registrado en la plataforma > nombre de WhatsApp > número.
    Si no hay ninguno de los dos y `phone` es en realidad un JID crudo (@lid,
    contacto con privacidad de número activada — ver WhatsAppConversation.
    is_resolved_phone), mostrar el ID interno tal cual sería confuso para el
    admin en el inbox, así que se usa un texto genérico en su lugar."""
    if platform_name or contact_name:
        return platform_name or contact_name
    if "@" in phone:
        return "Contacto con número oculto (WhatsApp)"
    return phone


@router.get("/conversations", summary="Listar conversaciones de WhatsApp (inbox)")
async def list_conversations(
    audience: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    query = select(WhatsAppConversation).order_by(
        desc(WhatsAppConversation.needs_admin_attention), desc(WhatsAppConversation.last_message_at)
    )
    if audience:
        query = query.where(WhatsAppConversation.audience == audience)
    result = await db.execute(query)
    conversations = result.scalars().all()

    platform_names = await _resolve_platform_names(db, [c.user_id for c in conversations])

    return [
        {
            "id": c.id, "phone": c.phone, "contact_name": c.contact_name,
            "display_name": _display_name(platform_names.get(c.user_id), c.contact_name, c.phone),
            "audience": c.audience, "agent_enabled": c.agent_enabled,
            "last_message_at": c.last_message_at, "last_message_preview": c.last_message_preview,
            "unread_count": c.unread_count,
            "needs_admin_attention": c.needs_admin_attention,
            "escalation_reason": c.escalation_reason,
        }
        for c in conversations
    ]


@router.get("/conversations/{conversation_id}/messages", summary="Historial de mensajes de una conversación")
async def get_conversation_messages(
    conversation_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)
):
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    conversation.unread_count = 0
    msg_result = await db.execute(
        select(WhatsAppMessage).where(WhatsAppMessage.conversation_id == conversation_id)
        .order_by(WhatsAppMessage.created_at)
    )
    messages = msg_result.scalars().all()
    await db.commit()

    platform_names = await _resolve_platform_names(db, [conversation.user_id])
    display_name = _display_name(platform_names.get(conversation.user_id), conversation.contact_name, conversation.phone)

    return {
        "conversation": {
            "id": conversation.id, "phone": conversation.phone, "contact_name": conversation.contact_name,
            "display_name": display_name, "agent_enabled": conversation.agent_enabled,
            "needs_admin_attention": conversation.needs_admin_attention,
            "escalation_reason": conversation.escalation_reason,
        },
        "messages": [
            {"id": m.id, "direction": m.direction, "body": m.body, "sent_by": m.sent_by,
             "status": m.status, "created_at": m.created_at}
            for m in messages
        ],
    }


class SendMessageRequest(BaseModel):
    message: str


@router.post("/conversations/{conversation_id}/send", summary="Responder manualmente desde el panel (toma control del chat)")
async def send_manual_message(
    conversation_id: str, data: SendMessageRequest,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin),
):
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    send_whatsapp_message.delay(
        phone=conversation.phone,
        message=data.message,
        audience=conversation.audience,
        user_id=conversation.user_id,
        sent_by="ADMIN",
        # Aunque lo tipeó un humano real, sigue siendo el mismo número/
        # sesión de whatsapp-web.js que manda las respuestas del agente —
        # que nunca salga con latencia cero es parte del mismo patrón de
        # comportamiento que cuidamos para el bot (ver human_delay en
        # whatsapp_tasks.py).
        human_delay=True,
    )
    return {"status": "queued"}


class ConversationAgentToggle(BaseModel):
    agent_enabled: bool


@router.patch("/conversations/{conversation_id}/agent", summary="Activar/desactivar el agente IA para esta conversación puntual")
async def toggle_conversation_agent(
    conversation_id: str, data: ConversationAgentToggle,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin),
):
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    conversation.agent_enabled = data.agent_enabled
    await db.commit()
    return {"status": "updated", "agent_enabled": conversation.agent_enabled}


@router.patch("/conversations/{conversation_id}/resolve-escalation", summary="Marcar como resuelta la derivación a administración")
async def resolve_conversation_escalation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin),
):
    result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    conversation.needs_admin_attention = False
    conversation.escalation_reason = None
    await db.commit()
    return {"status": "updated", "needs_admin_attention": conversation.needs_admin_attention}


class AgentConfigIn(BaseModel):
    is_active: bool
    auto_reply_public: bool
    auto_reply_patients: bool
    auto_reply_professionals: bool
    business_hours_only: bool


@router.get("/agent-config", summary="Configuración global del agente IA")
async def get_agent_config(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(AgentConfig).where(AgentConfig.id == "global"))
    config = result.scalar_one_or_none()
    if config is None:
        config = AgentConfig(id="global")
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return {
        "is_active": config.is_active,
        "guardrail_diagnosis_locked": config.guardrail_diagnosis_locked,
        "auto_reply_public": config.auto_reply_public,
        "auto_reply_patients": config.auto_reply_patients,
        "auto_reply_professionals": config.auto_reply_professionals,
        "business_hours_only": config.business_hours_only,
    }


@router.put("/agent-config", summary="Actualizar configuración global del agente IA")
async def update_agent_config(data: AgentConfigIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(AgentConfig).where(AgentConfig.id == "global"))
    config = result.scalar_one_or_none()
    if config is None:
        config = AgentConfig(id="global")
        db.add(config)
    for key, value in data.model_dump().items():
        setattr(config, key, value)
    await db.commit()
    return {"status": "updated"}


# ═══════════════════════════════════════════════════════
# Webhook interno — llamado por whatsapp-service (whatsapp-web.js)
# ═══════════════════════════════════════════════════════

class InboundMessagePayload(BaseModel):
    phone: Optional[str] = None
    # JID crudo de WhatsApp (msg.from), ej. "157445045391462@lid" o
    # "59172345678@c.us" — siempre presente. Se usa como respaldo cuando
    # `phone` no resuelve a un número boliviano real (caso @lid, ver
    # docstring de WhatsAppConversation en app/models/models.py).
    whatsapp_id: Optional[str] = None
    message: str
    contact_name: Optional[str] = None


# Palabras/números que un profesional puede responder al aviso de "paciente
# esperando" para aceptar o rechazar sin salir de WhatsApp. Se compara el
# mensaje completo (recortado y en minúsculas), no una subcadena — así
# "no puedo ahora, disculpa" no dispara un rechazo por casualidad.
_ACCEPT_REPLIES = {"1", "aceptar", "acepto", "si", "sí", "acepta"}
_REJECT_REPLIES = {"2", "rechazar", "rechazo", "no", "no puedo", "no acepto"}


def _classify_immediate_reply(text: str) -> Optional[str]:
    normalized = text.strip().lower().rstrip(".!¡¿?")
    if normalized in _ACCEPT_REPLIES:
        return "ACCEPT"
    if normalized in _REJECT_REPLIES:
        return "REJECT"
    return None


@router.post("/webhook/inbound", summary="[interno] whatsapp-service reporta un mensaje entrante")
async def receive_inbound_message(
    payload: InboundMessagePayload,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    x_internal_secret: str = Header(default=""),
):
    # Sin esto, cualquiera en internet que conozca esta URL podía simular un
    # mensaje de WhatsApp con CUALQUIER número de teléfono (incluido el de
    # un profesional real) y disparar el agente de IA gratis, o incluso
    # aceptar/rechazar consultas inmediatas suplantando a un profesional
    # (ver _classify_immediate_reply más abajo). whatsapp-service ya manda
    # este header en sus propias rutas expuestas; acá faltaba exigirlo.
    if not settings.WHATSAPP_SERVICE_INTERNAL_SECRET or not hmac.compare_digest(
        x_internal_secret, settings.WHATSAPP_SERVICE_INTERNAL_SECRET
    ):
        raise HTTPException(status_code=401, detail="No autorizado")

    # Normalizamos acá aunque whatsapp-service ya manda el número con
    # código de país (así es como llegan los JID de WhatsApp): es
    # defensivo por si en algún momento se llama a este webhook desde
    # otro origen (pruebas manuales, otro proveedor, etc.).
    #
    # CASO @lid — WhatsApp oculta el número real de contactos con
    # privacidad activada; en ese caso payload.phone puede venir vacío o
    # con un ID interno de 14-15 dígitos que normalize_bo_phone() rechaza
    # correctamente (no es un número boliviano). Antes esto se cortaba acá
    # con un 422 y el mensaje se perdía sin más (ver incidente ago-2026:
    # decenas de mensajes de pacientes/profesionales/público nunca
    # generaron respuesta). Ahora, si no hay número real pero SÍ tenemos
    # el JID crudo (whatsapp_id, siempre presente porque WhatsApp lo
    # entrega para cualquier mensaje), lo usamos como identificador de la
    # conversación en su lugar — no es un teléfono real (is_resolved=False,
    # no se linkea a ningún User, no se muestra como número en la UI), pero
    # SÍ se le puede seguir respondiendo: WhatsApp permite enviar
    # directo a ese JID sin necesitar el número humano detrás.
    is_resolved = True
    try:
        phone = normalize_bo_phone(payload.phone) if payload.phone else ""
        if not phone:
            raise InvalidPhoneError("teléfono vacío")
    except InvalidPhoneError as exc:
        if not payload.whatsapp_id:
            logger.warning(
                f"Webhook inbound rechazado: sin teléfono válido ni whatsapp_id de respaldo "
                f"('{payload.phone}') — {exc}"
            )
            raise HTTPException(status_code=422, detail="Teléfono no reconocido como número boliviano válido")
        logger.info(
            f"Teléfono no resuelto ('{payload.phone}'), usando JID crudo como identificador: "
            f"{payload.whatsapp_id}"
        )
        phone = payload.whatsapp_id
        is_resolved = False

    # Clasificar el número: ¿es un User registrado? ¿de qué rol? Solo
    # tiene sentido buscar coincidencia si `phone` es un número real — un
    # JID crudo (@lid) nunca va a matchear con User.phone.
    # Ver app/core/phone.py: desde que existe el normalizador, todo User
    # nuevo se guarda en formato canónico "591XXXXXXXX". Igual dejamos el
    # fallback al formato local (8 dígitos) para no perder el link con
    # cuentas registradas ANTES de este fix — correr el script de
    # backfill (scripts/normalize_existing_phones.py) elimina la
    # necesidad de este fallback.
    user = None
    if is_resolved:
        local_format = phone[3:] if phone.startswith("591") and len(phone) == 11 else phone
        user_result = await db.execute(select(User).where(User.phone.in_([phone, local_format])))
        user = user_result.scalar_one_or_none()
    audience = user.role.value if user else WhatsAppAudience.PUBLIC.value

    conv_result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.phone == phone))
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        conversation = WhatsAppConversation(
            is_resolved_phone=is_resolved,
            phone=phone, audience=audience,
            user_id=user.id if user else None,
            contact_name=payload.contact_name,
        )
        db.add(conversation)
        await db.flush()
    elif not conversation.contact_name and payload.contact_name:
        # El primer mensaje pudo llegar sin pushname resuelto (WhatsApp no
        # siempre lo manda de entrada); si en un mensaje posterior sí viene,
        # lo completamos para no dejar la conversación identificada solo
        # por número.
        conversation.contact_name = payload.contact_name

    conversation.last_message_at = utcnow_naive()
    conversation.last_message_preview = payload.message[:300]
    conversation.unread_count = (conversation.unread_count or 0) + 1

    db.add(WhatsAppMessage(
        conversation_id=conversation.id,
        direction="IN",
        body=payload.message,
    ))
    await db.commit()

    # ── Aceptar/rechazar una consulta inmediata directo desde WhatsApp ──
    # Si quien escribe es un profesional CON una consulta inmediata
    # esperando su aceptación, y el mensaje es "1"/"2" (o "aceptar"/
    # "rechazar"), se resuelve acá mismo — sin pasar por el agente IA ni
    # pedirle que abra la app. El resto de la conversación sigue normal.
    #
    # Nota: whatsapp-web.js es una librería no oficial; los botones
    # interactivos de WhatsApp (Cloud API oficial de Meta) no se soportan
    # de forma confiable acá, por eso la interacción es por texto plano.
    if user and audience == WhatsAppAudience.PROFESSIONAL.value:
        intent = _classify_immediate_reply(payload.message)
        if intent:
            prof_result = await db.execute(select(Professional).where(Professional.user_id == user.id))
            professional = prof_result.scalar_one_or_none()
            pending = (
                await get_latest_pending_immediate_consultation(db, professional.id)
                if professional else None
            )
            if professional and pending:
                try:
                    if intent == "ACCEPT":
                        await accept_consultation_core(db, professional, pending, background_tasks)
                        reply_text = (
                            "✅ Aceptaste la consulta. Avisamos al paciente para que pague — "
                            "en cuanto confirme el pago, te llega otro WhatsApp para que la inicies desde la app."
                        )
                    else:
                        await reject_consultation_core(db, professional, pending)
                        reply_text = "❌ Rechazaste la consulta. El paciente verá que no está disponible en este momento."
                except ConsultationActionError as exc:
                    reply_text = f"⚠️ No se pudo procesar: {exc.message}"

                send_whatsapp_message.delay(
                    phone=conversation.phone,
                    message=reply_text,
                    audience=audience,
                    user_id=conversation.user_id,
                    related_entity_type="Consultation",
                    related_entity_id=pending.id,
                    sent_by="BOT",
                    human_delay=True,
                )
                conversation.unread_count = 0
                await db.commit()
                return {"status": "received", "conversation_id": conversation.id}
            elif not pending:
                # Escribió "1"/"2" pero no tiene ninguna consulta inmediata
                # esperando (ya se aceptó, se venció el timeout, o nunca
                # hubo una) — no interceptamos: dejamos que siga a la
                # conversación normal / agente, un "1" suelto también puede
                # ser el inicio de una charla con el bot.
                pass

    # Responder con el agente IA si está habilitado (global + por conversación).
    agent_config_result = await db.execute(select(AgentConfig).where(AgentConfig.id == "global"))
    agent_config = agent_config_result.scalar_one_or_none()
    should_auto_reply = (
        conversation.agent_enabled
        and agent_config is not None and agent_config.is_active
        and {
            "PATIENT": agent_config.auto_reply_patients,
            "PROFESSIONAL": agent_config.auto_reply_professionals,
        }.get(audience, agent_config.auto_reply_public)
    )

    if should_auto_reply:
        history_result = await db.execute(
            select(WhatsAppMessage)
            .where(WhatsAppMessage.conversation_id == conversation.id)
            .order_by(WhatsAppMessage.created_at.desc())
            .limit(10)
        )
        recent = list(reversed(history_result.scalars().all()))
        history = [
            {"role": "assistant" if m.direction == "OUT" else "user", "content": m.body}
            for m in recent
        ]

        from app.agents.coordinator import run_whatsapp_agent

        platform_names = await _resolve_platform_names(db, [conversation.user_id])
        display_name = _display_name(platform_names.get(conversation.user_id), conversation.contact_name, conversation.phone)

        result = await run_whatsapp_agent(
            conversation.id, payload.message, history,
            contact_name=display_name if display_name != conversation.phone else None,
            audience=audience,
            db=db,
        )
        reply_text = result["message"]

        if result["escalate"]:
            conversation.needs_admin_attention = True
            conversation.escalation_reason = result["escalation_reason"]
            await db.commit()
            from app.tasks.whatsapp_tasks import notify_admin_of_whatsapp_escalation
            notify_admin_of_whatsapp_escalation.delay(conversation_id=conversation.id)

        # No se inserta el WhatsAppMessage acá: send_whatsapp_message ya
        # deja el registro OUT al efectivamente mandarlo (ver
        # app/tasks/whatsapp_tasks.py::_send_and_log), para no duplicar
        # la fila si el envío llegara a fallar.
        send_whatsapp_message.delay(
            phone=conversation.phone,
            message=reply_text,
            audience=audience,
            user_id=conversation.user_id,
            related_entity_type="WhatsAppConversation",
            related_entity_id=conversation.id,
            sent_by="BOT",
            human_delay=True,
        )

    return {"status": "received", "conversation_id": conversation.id}


# ═══════════════════════════════════════════════════════
# PESTAÑA 4 — Automatización de base de datos → Gmail
# ═══════════════════════════════════════════════════════

class BackupConfigIn(BaseModel):
    is_active: bool
    frequency: str  # DAILY | WEEKLY
    hour_utc: int
    recipient_emails: List[str]
    include_full_dump: bool = True


@router.get("/backup-config", summary="Configuración de backups automáticos")
async def get_backup_config(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(DBBackupConfig).where(DBBackupConfig.id == "global"))
    config = result.scalar_one_or_none()
    if config is None:
        config = DBBackupConfig(id="global")
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return {
        "is_active": config.is_active, "frequency": config.frequency,
        "hour_utc": config.hour_utc, "recipient_emails": config.recipient_emails,
        "include_full_dump": config.include_full_dump,
    }


@router.put("/backup-config", summary="Actualizar configuración de backups automáticos")
async def update_backup_config(data: BackupConfigIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(DBBackupConfig).where(DBBackupConfig.id == "global"))
    config = result.scalar_one_or_none()
    if config is None:
        config = DBBackupConfig(id="global")
        db.add(config)
    for key, value in data.model_dump().items():
        setattr(config, key, value)
    await db.commit()
    return {"status": "updated"}


@router.post("/backup-config/send-now", summary="Disparar un backup manual inmediato")
async def trigger_backup_now(current_user: User = Depends(get_current_admin)):
    run_backup_now.delay()
    return {"status": "queued"}


@router.get("/backup-logs", summary="Historial de backups enviados")
async def get_backup_logs(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    result = await db.execute(select(DBBackupLog).order_by(DBBackupLog.created_at.desc()).limit(50))
    logs = result.scalars().all()
    return [
        {"id": l.id, "status": l.status, "file_size_bytes": l.file_size_bytes,
         "recipients": l.recipients, "error_detail": l.error_detail,
         "delivery_method": l.delivery_method, "created_at": l.created_at}
        for l in logs
    ]