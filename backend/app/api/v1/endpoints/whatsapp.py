"""
app/api/v1/endpoints/whatsapp.py
Backend del menú "IA" del panel admin (4 pestañas):
  1. GET  /whatsapp/status                 → monitor del bot
  2. CRUD /whatsapp/reminders               → recordatorios automáticos
  3. GET  /whatsapp/conversations           → inbox + toggle agente
  4. CRUD /whatsapp/backup-config           → automatización BD → Gmail

  + POST /whatsapp/webhook/inbound          → llamado por whatsapp-service
    (Node/Baileys) cada vez que llega un mensaje nuevo al número real.
"""
from datetime import datetime
from typing import Optional, List

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.core.config import settings
from app.core.phone import normalize_bo_phone, InvalidPhoneError
from app.models.models import (
    User, WhatsAppConversation, WhatsAppMessage, WhatsAppAudience,
    AgentConfig, ReminderRule, ReminderLog, DBBackupConfig, DBBackupLog,
)
from app.tasks.whatsapp_tasks import send_whatsapp_message
from app.tasks.backup_tasks import run_backup_now

router = APIRouter()


# ═══════════════════════════════════════════════════════
# PESTAÑA 1 — Monitor y edición del bot
# ═══════════════════════════════════════════════════════

@router.get("/status", summary="Estado de conexión del bot de WhatsApp")
async def get_whatsapp_status(current_user: User = Depends(get_current_admin)):
    """
    Consulta al microservicio Node (Baileys) su estado real de sesión
    (vinculado / esperando QR / desconectado). Si el microservicio no
    responde, se informa como DOWN en vez de tirar un 500 — el admin
    necesita ver esto como un estado, no como un error de la página.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.WHATSAPP_SERVICE_URL}/status",
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
        if resp.status_code == 200:
            data = resp.json()
            return {"service_reachable": True, **data}
        return {"service_reachable": True, "connection_state": "ERROR", "detail": resp.text[:200]}
    except httpx.RequestError as exc:
        logger.warning(f"whatsapp-service no responde: {exc}")
        return {"service_reachable": False, "connection_state": "DOWN", "detail": str(exc)}


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


@router.post("/test-message", summary="Enviar mensaje de prueba (verificar que el bot funciona)")
async def send_test_message(data: TestMessageRequest, current_user: User = Depends(get_current_admin)):
    send_whatsapp_message.delay(
        phone=data.phone,
        message=data.message,
        audience=WhatsAppAudience.ADMIN.value,
        sent_by="ADMIN",
    )
    return {"status": "queued"}


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
    result = await db.execute(select(ReminderRule).order_by(ReminderRule.created_at.desc()))
    rules = result.scalars().all()
    return [
        {
            "id": r.id, "name": r.name, "trigger_type": r.trigger_type,
            "audience": r.audience, "channel": r.channel,
            "offset_minutes": r.offset_minutes, "message_template": r.message_template,
            "is_active": r.is_active, "created_at": r.created_at,
        }
        for r in rules
    ]


@router.post("/reminders", summary="Crear regla de recordatorio")
async def create_reminder_rule(data: ReminderRuleIn, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_admin)):
    rule = ReminderRule(**data.model_dump())
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


# ═══════════════════════════════════════════════════════
# PESTAÑA 3 — Conversaciones + configuración del agente
# ═══════════════════════════════════════════════════════

@router.get("/conversations", summary="Listar conversaciones de WhatsApp (inbox)")
async def list_conversations(
    audience: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    query = select(WhatsAppConversation).order_by(desc(WhatsAppConversation.last_message_at))
    if audience:
        query = query.where(WhatsAppConversation.audience == audience)
    result = await db.execute(query)
    conversations = result.scalars().all()
    return [
        {
            "id": c.id, "phone": c.phone, "contact_name": c.contact_name,
            "audience": c.audience, "agent_enabled": c.agent_enabled,
            "last_message_at": c.last_message_at, "last_message_preview": c.last_message_preview,
            "unread_count": c.unread_count,
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

    return {
        "conversation": {"id": conversation.id, "phone": conversation.phone, "contact_name": conversation.contact_name, "agent_enabled": conversation.agent_enabled},
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
# Webhook interno — llamado por whatsapp-service (Baileys)
# ═══════════════════════════════════════════════════════

class InboundMessagePayload(BaseModel):
    phone: str
    message: str
    contact_name: Optional[str] = None


@router.post("/webhook/inbound", summary="[interno] whatsapp-service reporta un mensaje entrante")
async def receive_inbound_message(
    payload: InboundMessagePayload,
    db: AsyncSession = Depends(get_db),
):
    # Normalizamos acá aunque whatsapp-service ya manda el número con
    # código de país (así es como llegan los JID de WhatsApp): es
    # defensivo por si en algún momento se llama a este webhook desde
    # otro origen (pruebas manuales, otro proveedor, etc.).
    #
    # Si ni siquiera es un número boliviano plausible (ej. un JID interno
    # tipo "@lid" de 15 dígitos que se coló sin resolver), rechazamos acá
    # en vez de guardarlo: guardar basura como "número de conversación"
    # rompe después el envío de la respuesta del bot (no hay a quién
    # mandarle el WhatsApp) y ensucia el inbox con conversaciones fantasma.
    try:
        phone = normalize_bo_phone(payload.phone)
    except InvalidPhoneError as exc:
        logger.warning(
            f"Webhook inbound rechazado: teléfono no válido '{payload.phone}' — {exc}"
        )
        raise HTTPException(status_code=422, detail="Teléfono no reconocido como número boliviano válido")

    # Clasificar el número: ¿es un User registrado? ¿de qué rol?
    # Ver app/core/phone.py: desde que existe el normalizador, todo User
    # nuevo se guarda en formato canónico "591XXXXXXXX". Igual dejamos el
    # fallback al formato local (8 dígitos) para no perder el link con
    # cuentas registradas ANTES de este fix — correr el script de
    # backfill (scripts/normalize_existing_phones.py) elimina la
    # necesidad de este fallback.
    local_format = phone[3:] if phone.startswith("591") and len(phone) == 11 else phone
    user_result = await db.execute(select(User).where(User.phone.in_([phone, local_format])))
    user = user_result.scalar_one_or_none()
    audience = user.role.value if user else WhatsAppAudience.PUBLIC.value

    conv_result = await db.execute(select(WhatsAppConversation).where(WhatsAppConversation.phone == phone))
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        conversation = WhatsAppConversation(
            phone=phone, audience=audience,
            user_id=user.id if user else None,
            contact_name=payload.contact_name,
        )
        db.add(conversation)
        await db.flush()

    conversation.last_message_at = datetime.utcnow()
    conversation.last_message_preview = payload.message[:300]
    conversation.unread_count = (conversation.unread_count or 0) + 1

    db.add(WhatsAppMessage(
        conversation_id=conversation.id,
        direction="IN",
        body=payload.message,
    ))
    await db.commit()

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
        reply_text = await run_whatsapp_agent(conversation.id, payload.message, history)

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