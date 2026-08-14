"""
app/api/v1/endpoints/support_chat.py
Chat directo con soporte: paciente <-> admin y profesional <-> admin.

Separado a propósito del chat interno paciente-profesional
(endpoints/chat.py): acá no hay bloqueo, ni reportes, ni expiración por
ventana de días — es la línea directa con el equipo de MedicBolivia,
pensada para estar siempre disponible. Un solo hilo por usuario (bandeja
compartida: cualquier admin puede verlo y responder).

Este archivo expone tanto los endpoints "de usuario" (mi propia
conversación) como el WebSocket, que es compartido con el lado admin
(ver admin_support_chat.py) — el WS valida el acceso según el rol de
quien se conecta.
"""
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from datetime import datetime
from app.core.timezone import utcnow_naive
from jose import JWTError
from loguru import logger

from app.db.database import get_db, AsyncSessionLocal
from app.core.dependencies import get_current_user
from app.core.security import decode_token, AUTH_COOKIE_NAME
from app.core.redis_client import redis_client
from app.core.support_chat_ws_manager import support_chat_manager
from app.core.config import settings
from app.models.models import User, UserRole, SupportConversation, SupportMessage
from app.schemas.schemas import (
    SupportConversationResponse, SupportMessageResponse, SupportChatConfigResponse,
)
from app.services.support_chat import (
    is_support_chat_enabled, get_or_create_conversation_for_user,
    get_conversation_for_participant, reopen_if_needed, has_unread_messages_from_user,
    build_participant_label,
)
from app.services.storage import upload_chat_attachment_to_r2, get_presigned_url
from app.services.notify import notify_user

router = APIRouter()

ALLOWED_ATTACHMENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


# ─────────────────────────────────────────────────────
# Helpers internos
# ─────────────────────────────────────────────────────

async def _resolve_attachment_url(attachment_key: str | None) -> str | None:
    if not attachment_key:
        return None
    return await get_presigned_url(attachment_key, expires_seconds=3600)


async def _build_message_response(msg: SupportMessage, conv_user_id: str) -> SupportMessageResponse:
    return SupportMessageResponse(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        is_admin_sender=msg.sender_id != conv_user_id,
        content=msg.content,
        attachment_url=await _resolve_attachment_url(msg.attachment_key),
        attachment_content_type=msg.attachment_content_type,
        read_at=msg.read_at,
        created_at=msg.created_at,
    )


async def _notify_admins_of_new_message(conversation_id: str, sender_name: str, preview: str, escalate_whatsapp: bool):
    """Avisa a TODOS los admins que hay un mensaje nuevo esperando
    respuesta. El WhatsApp solo se manda si escalate_whatsapp=True (ver
    llamador: solo en el primer mensaje de una tanda, para no saturar el
    WhatsApp del equipo con cada mensaje individual de una conversación
    activa — mismo criterio que ya usa el chat interno)."""
    async with AsyncSessionLocal() as db:
        admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        admins = admins_result.scalars().all()
        for admin in admins:
            await notify_user(
                db, user_id=admin.id,
                title="Nuevo mensaje de soporte",
                body=f"{sender_name}: {preview[:100]}",
                type_="SUPPORT_CHAT_MESSAGE",
                entity_type="SupportConversation", entity_id=conversation_id,
                send_whatsapp=escalate_whatsapp,
            )
        await db.commit()


# ─────────────────────────────────────────────────────
# REST — mi conversación con soporte
# ─────────────────────────────────────────────────────

@router.get("/config", response_model=SupportChatConfigResponse)
async def get_config(db: AsyncSession = Depends(get_db)):
    """Público para cualquier usuario logueado — el widget flotante lo
    consulta una vez al montarse para decidir si mostrarse o no."""
    return SupportChatConfigResponse(enabled=await is_support_chat_enabled(db))


@router.get("/conversation", response_model=SupportConversationResponse)
async def get_my_conversation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == UserRole.ADMIN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Los administradores usan la bandeja de /admin/support-chat")

    conv = await get_or_create_conversation_for_user(db, current_user)
    await db.commit()
    await db.refresh(conv)

    unread_count = (await db.execute(
        select(func.count(SupportMessage.id)).where(
            SupportMessage.conversation_id == conv.id,
            SupportMessage.sender_id != current_user.id,
            SupportMessage.read_at.is_(None),
        )
    )).scalar_one()

    return SupportConversationResponse(
        id=conv.id, status=conv.status, last_message_at=conv.last_message_at,
        last_message_preview=conv.last_message_preview, last_message_from=conv.last_message_from,
        created_at=conv.created_at, participant=None, unread_count=unread_count or 0,
    )


@router.get("/conversation/messages", response_model=list[SupportMessageResponse])
async def get_my_messages(
    before: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await get_or_create_conversation_for_user(db, current_user)
    await db.commit()

    query = select(SupportMessage).where(SupportMessage.conversation_id == conv.id)
    if before:
        query = query.where(SupportMessage.created_at < before)
    query = query.order_by(desc(SupportMessage.created_at)).limit(limit)

    result = await db.execute(query)
    messages = list(reversed(result.scalars().all()))
    return [await _build_message_response(m, conv.user_id) for m in messages]


@router.post("/conversation/read", status_code=status.HTTP_200_OK)
async def mark_my_conversation_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await get_or_create_conversation_for_user(db, current_user)

    result = await db.execute(
        select(SupportMessage).where(
            SupportMessage.conversation_id == conv.id,
            SupportMessage.sender_id != current_user.id,
            SupportMessage.read_at.is_(None),
        )
    )
    unread = result.scalars().all()
    now = utcnow_naive()
    for msg in unread:
        msg.read_at = now
    await db.commit()

    if unread:
        await support_chat_manager.broadcast(conv.id, {
            "type": "read", "reader_id": current_user.id, "read_at": now.isoformat() + "Z",
        })
    return {"marked": len(unread)}


@router.post("/conversation/attachments", response_model=SupportMessageResponse)
async def send_my_attachment(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await is_support_chat_enabled(db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El chat con soporte está deshabilitado en este momento.")

    conv = await get_or_create_conversation_for_user(db, current_user)
    reopen_if_needed(conv)

    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tipo de archivo no permitido. Solo imágenes (JPEG, PNG, WEBP) o PDF")

    content = await file.read()
    max_bytes = settings.CHAT_MAX_ATTACHMENT_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Archivo demasiado grande. Máximo {settings.CHAT_MAX_ATTACHMENT_MB} MB")

    attachment_key = await upload_chat_attachment_to_r2(
        file_content=content, file_name=file.filename or "archivo",
        conversation_id=conv.id, content_type=file.content_type,
    )

    was_unread_already = await has_unread_messages_from_user(db, conv.id, current_user.id)

    msg = SupportMessage(
        conversation_id=conv.id, sender_id=current_user.id,
        attachment_key=attachment_key, attachment_content_type=file.content_type,
    )
    db.add(msg)
    conv.last_message_at = utcnow_naive()
    conv.last_message_preview = "📎 Adjunto"
    conv.last_message_from = "USER"
    await db.flush()

    response = await _build_message_response(msg, conv.user_id)
    await db.commit()

    await support_chat_manager.broadcast(conv.id, {"type": "message", **response.model_dump(mode="json")})

    sender_name, _ = await build_participant_label(db, current_user.id)
    await _notify_admins_of_new_message(
        conv.id, sender_name, "📎 Envió un archivo adjunto",
        escalate_whatsapp=not was_unread_already,
    )

    return response


# ─────────────────────────────────────────────────────
# WebSocket — compartido entre usuario y admin
# ─────────────────────────────────────────────────────

async def _authenticate_ws(token: str | None, db: AsyncSession) -> User | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


_SUPPORT_WS_MAX_MESSAGES = 20
_SUPPORT_WS_WINDOW_SECONDS = 10


async def _support_ws_rate_limit_ok(user_id: str) -> bool:
    key = f"support_chat_ws_rate:{user_id}"
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _SUPPORT_WS_WINDOW_SECONDS)
        return count <= _SUPPORT_WS_MAX_MESSAGES
    except Exception as e:
        logger.warning(f"No se pudo chequear rate limit de support chat WS: {e}")
        return True


@router.websocket("/ws/{conversation_id}")
async def support_chat_websocket(
    websocket: WebSocket,
    conversation_id: str,
    token: str | None = Query(None),
):
    auth_token = websocket.cookies.get(AUTH_COOKIE_NAME) or token
    async with AsyncSessionLocal() as db:
        current_user = await _authenticate_ws(auth_token, db)
        if not current_user:
            await websocket.accept()
            await websocket.close(code=4001, reason="Token inválido o expirado")
            return

        conv = await get_conversation_for_participant(db, conversation_id, current_user)
        if not conv:
            await websocket.accept()
            await websocket.close(code=4004, reason="Conversación no encontrada")
            return

        is_admin = current_user.role == UserRole.ADMIN
        conv_user_id = conv.user_id

    await support_chat_manager.connect(conversation_id, current_user.id, websocket)
    try:
        while True:
            data = await websocket.receive_json()

            if data.get("type") == "typing":
                await support_chat_manager.broadcast(conversation_id, {
                    "type": "typing", "user_id": current_user.id, "is_admin": is_admin,
                })
                continue

            if not await _support_ws_rate_limit_ok(current_user.id):
                await websocket.send_json({"type": "error", "code": "rate_limited"})
                continue

            content = (data.get("content") or "").strip()
            if not content or len(content) > 4000:
                await websocket.send_json({"type": "error", "code": "invalid_content"})
                continue

            async with AsyncSessionLocal() as db:
                if not await is_support_chat_enabled(db) and not is_admin:
                    await websocket.send_json({"type": "error", "code": "support_chat_unavailable"})
                    continue

                conv = await get_conversation_for_participant(db, conversation_id, current_user)
                if not conv:
                    await websocket.send_json({"type": "error", "code": "support_chat_unavailable"})
                    continue

                reopen_if_needed(conv)
                was_unread_already = await has_unread_messages_from_user(db, conv.id, conv.user_id) if not is_admin else False

                msg = SupportMessage(conversation_id=conversation_id, sender_id=current_user.id, content=content)
                db.add(msg)
                conv.last_message_at = utcnow_naive()
                conv.last_message_preview = content[:300]
                conv.last_message_from = "ADMIN" if is_admin else "USER"
                await db.flush()

                response = await _build_message_response(msg, conv.user_id)
                await db.commit()

                if not is_admin:
                    sender_name, _ = await build_participant_label(db, current_user.id)

            await support_chat_manager.broadcast(conversation_id, {"type": "message", **response.model_dump(mode="json")})

            # Notificación fuera de la transacción del mensaje, para no
            # bloquear el envío en vivo si notify_user tarda (mismo
            # criterio que el chat interno, ver endpoints/chat.py).
            if is_admin:
                # El admin le contesta al usuario dueño del hilo — solo in-app,
                # el usuario ya tiene el widget/badge para enterarse.
                async with AsyncSessionLocal() as notif_db:
                    await notify_user(
                        notif_db, user_id=conv_user_id,
                        title="Respuesta de soporte",
                        body=content[:100],
                        type_="SUPPORT_CHAT_MESSAGE",
                        entity_type="SupportConversation", entity_id=conversation_id,
                        send_whatsapp=False,
                    )
                    await notif_db.commit()
            else:
                await _notify_admins_of_new_message(
                    conversation_id, sender_name, content,
                    escalate_whatsapp=not was_unread_already,
                )

    except WebSocketDisconnect:
        pass
    finally:
        support_chat_manager.disconnect(conversation_id, current_user.id, websocket)
