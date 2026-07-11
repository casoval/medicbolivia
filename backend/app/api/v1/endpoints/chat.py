"""
app/api/v1/endpoints/chat.py
Chat interno paciente-profesional. Por política, el paciente nunca ve el
número de teléfono del profesional — este es el único canal de mensajería
directa entre ambos dentro de la plataforma (WhatsApp queda reservado a
recordatorios automáticos, ver whatsapp_tasks.py).

Cada conversación está ligada 1 a 1 a una Consultation ya pagada y sigue
activa hasta CHAT_WINDOW_DAYS después de que la consulta termina (ver
app/tasks/chat_tasks.py para el cierre automático).
"""
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from datetime import datetime
from jose import JWTError
from loguru import logger

from app.db.database import get_db, AsyncSessionLocal
from app.core.dependencies import get_current_user
from app.core.security import decode_token
from app.core.chat_ws_manager import chat_manager
from app.core.config import settings
from app.models.models import (
    User, ChatConversation, ChatMessage, ChatBlock, ChatConversationStatus,
    Patient, Professional,
)
from app.schemas.schemas import (
    ChatConversationResponse, ChatParticipantResponse, ChatMessageResponse,
    ChatSendMessageRequest, ChatBlockRequest, ChatBlockResponse,
)
from app.services.chat import (
    is_blocked, get_conversation_for_user, other_participant_id,
    is_conversation_writable,
)
from app.services.storage import upload_chat_attachment_to_r2, get_presigned_url
from app.services.notify import notify_user

router = APIRouter()

ALLOWED_ATTACHMENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


# ─────────────────────────────────────────────────────
# Helpers internos
# ─────────────────────────────────────────────────────

async def _build_participant_response(db: AsyncSession, user_id: str) -> ChatParticipantResponse:
    patient_result = await db.execute(select(Patient).where(Patient.user_id == user_id))
    patient = patient_result.scalar_one_or_none()
    if patient:
        return ChatParticipantResponse(user_id=user_id, full_name=f"{patient.first_name} {patient.last_name}", photo_url=patient.photo_url)

    prof_result = await db.execute(select(Professional).where(Professional.user_id == user_id))
    professional = prof_result.scalar_one_or_none()
    if professional:
        return ChatParticipantResponse(user_id=user_id, full_name=f"Dr(a). {professional.first_name} {professional.last_name}", photo_url=professional.photo_url)

    return ChatParticipantResponse(user_id=user_id, full_name="Usuario", photo_url=None)


async def _resolve_attachment_url(attachment_key: str | None) -> str | None:
    if not attachment_key:
        return None
    return await get_presigned_url(attachment_key, expires_seconds=3600)


async def _build_message_response(msg: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        content=msg.content,
        attachment_url=await _resolve_attachment_url(msg.attachment_key),
        attachment_content_type=msg.attachment_content_type,
        read_at=msg.read_at,
        created_at=msg.created_at,
    )


# ─────────────────────────────────────────────────────
# REST — listar conversaciones e historial
# ─────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[ChatConversationResponse])
async def list_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista las conversaciones del usuario logueado (paciente o profesional),
    ordenadas por último mensaje."""
    result = await db.execute(
        select(ChatConversation)
        .where(or_(
            ChatConversation.patient_user_id == current_user.id,
            ChatConversation.professional_user_id == current_user.id,
        ))
        .order_by(desc(ChatConversation.last_message_at), desc(ChatConversation.created_at))
    )
    conversations = result.scalars().all()

    responses = []
    for conv in conversations:
        other_id = other_participant_id(conv, current_user.id)
        other = await _build_participant_response(db, other_id)
        responses.append(ChatConversationResponse(
            id=conv.id,
            consultation_id=conv.consultation_id,
            status=conv.status,
            expires_at=conv.expires_at,
            last_message_at=conv.last_message_at,
            last_message_preview=conv.last_message_preview,
            other_participant=other,
            created_at=conv.created_at,
        ))
    return responses


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessageResponse])
async def get_messages(
    conversation_id: str,
    before: datetime | None = Query(None, description="Paginación: trae mensajes anteriores a esta fecha"),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await get_conversation_for_user(db, conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    query = select(ChatMessage).where(ChatMessage.conversation_id == conversation_id)
    if before:
        query = query.where(ChatMessage.created_at < before)
    query = query.order_by(desc(ChatMessage.created_at)).limit(limit)

    result = await db.execute(query)
    messages = list(reversed(result.scalars().all()))
    return [await _build_message_response(m) for m in messages]


# ─────────────────────────────────────────────────────
# REST — adjuntos (sube el archivo Y crea el mensaje en un solo paso,
# a diferencia del patrón de "URL prefirmada" que se usa para fotos de
# perfil: acá el archivo es chico — máx CHAT_MAX_ATTACHMENT_MB — y
# conviene que quede registrado como ChatMessage atómicamente)
# ─────────────────────────────────────────────────────

@router.post("/conversations/{conversation_id}/attachments", response_model=ChatMessageResponse)
async def send_attachment(
    conversation_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await get_conversation_for_user(db, conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    if not is_conversation_writable(conv):
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta conversación ya no admite nuevos mensajes")

    other_id = other_participant_id(conv, current_user.id)
    if await is_blocked(db, current_user.id, other_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No se puede enviar: hay un bloqueo activo entre ambos usuarios")

    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tipo de archivo no permitido. Solo imágenes (JPEG, PNG, WEBP) o PDF")

    content = await file.read()
    max_bytes = settings.CHAT_MAX_ATTACHMENT_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Archivo demasiado grande. Máximo {settings.CHAT_MAX_ATTACHMENT_MB} MB")

    attachment_key = await upload_chat_attachment_to_r2(
        file_content=content,
        file_name=file.filename or "archivo",
        conversation_id=conversation_id,
        content_type=file.content_type,
    )

    msg = ChatMessage(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        attachment_key=attachment_key,
        attachment_content_type=file.content_type,
    )
    db.add(msg)

    conv.last_message_at = datetime.utcnow()
    conv.last_message_preview = "📎 Adjunto"
    await db.flush()

    response = await _build_message_response(msg)

    # Reenvía en vivo por el mismo canal que los mensajes de texto, y
    # notifica in-app (+ WhatsApp, como cualquier otro aviso de la
    # plataforma) por si el otro usuario no está con el chat abierto.
    await chat_manager.broadcast(conversation_id, {"type": "message", **response.model_dump(mode="json")})
    other_name = (await _build_participant_response(db, current_user.id)).full_name
    await notify_user(
        db, user_id=other_id,
        title="Nuevo mensaje",
        body=f"{other_name} te envió un archivo adjunto",
        type_="CHAT_MESSAGE",
        entity_type="ChatConversation", entity_id=conversation_id,
    )

    return response


# ─────────────────────────────────────────────────────
# REST — bloqueo
# ─────────────────────────────────────────────────────

@router.post("/conversations/{conversation_id}/block", response_model=ChatBlockResponse)
async def block(
    conversation_id: str,
    data: ChatBlockRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await get_conversation_for_user(db, conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    other_id = other_participant_id(conv, current_user.id)

    chat_block = ChatBlock(
        blocker_id=current_user.id,
        blocked_id=other_id if data.scope == "CONTACT" else None,
        scope=data.scope,
        reason=data.reason,
    )
    db.add(chat_block)
    await db.flush()

    logger.info(f"🚫 Chat block creado: blocker={current_user.id} scope={data.scope} blocked={other_id if data.scope == 'CONTACT' else 'GLOBAL'}")

    return ChatBlockResponse.model_validate(chat_block)


@router.delete("/conversations/{conversation_id}/block", status_code=status.HTTP_204_NO_CONTENT)
async def unblock(
    conversation_id: str,
    scope: str = Query(..., description='"CONTACT" o "GLOBAL"'),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await get_conversation_for_user(db, conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    other_id = other_participant_id(conv, current_user.id)

    query = select(ChatBlock).where(ChatBlock.blocker_id == current_user.id, ChatBlock.scope == scope)
    if scope == "CONTACT":
        query = query.where(ChatBlock.blocked_id == other_id)
    result = await db.execute(query)
    for b in result.scalars().all():
        await db.delete(b)


# ─────────────────────────────────────────────────────
# WebSocket — mensajería en vivo
# ─────────────────────────────────────────────────────

async def _authenticate_ws(token: str, db: AsyncSession) -> User | None:
    """El navegador no puede mandar headers custom en el handshake del
    WebSocket nativo, así que el JWT viaja por query param (?token=...),
    igual que otros proveedores de chat en tiempo real."""
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


@router.websocket("/ws/{conversation_id}")
async def chat_websocket(websocket: WebSocket, conversation_id: str, token: str = Query(...)):
    async with AsyncSessionLocal() as db:
        current_user = await _authenticate_ws(token, db)
        if not current_user:
            await websocket.close(code=4001, reason="Token inválido o expirado")
            return

        conv = await get_conversation_for_user(db, conversation_id, current_user.id)
        if not conv:
            await websocket.close(code=4004, reason="Conversación no encontrada")
            return

        other_id = other_participant_id(conv, current_user.id)

    await chat_manager.connect(conversation_id, current_user.id, websocket)
    try:
        while True:
            data = await websocket.receive_json()

            async with AsyncSessionLocal() as db:
                # Revalida en cada mensaje: la conversación pudo expirar o
                # bloquearse a mitad de la sesión abierta.
                conv = await get_conversation_for_user(db, conversation_id, current_user.id)
                if not conv or not is_conversation_writable(conv):
                    await websocket.send_json({"type": "error", "code": "conversation_closed"})
                    continue

                if await is_blocked(db, current_user.id, other_id):
                    await websocket.send_json({"type": "error", "code": "blocked"})
                    continue

                content = (data.get("content") or "").strip()
                if not content or len(content) > 4000:
                    await websocket.send_json({"type": "error", "code": "invalid_content"})
                    continue

                msg = ChatMessage(conversation_id=conversation_id, sender_id=current_user.id, content=content)
                db.add(msg)
                conv.last_message_at = datetime.utcnow()
                conv.last_message_preview = content[:300]
                await db.flush()

                response = await _build_message_response(msg)
                await db.commit()

                other_name = (await _build_participant_response(db, current_user.id)).full_name

            await chat_manager.broadcast(conversation_id, {"type": "message", **response.model_dump(mode="json")})

            # Notificación in-app/WhatsApp fuera de la transacción del mensaje,
            # para no bloquear el envío en vivo si notify_user tarda.
            async with AsyncSessionLocal() as notif_db:
                await notify_user(
                    notif_db, user_id=other_id,
                    title="Nuevo mensaje",
                    body=f"{other_name}: {content[:100]}",
                    type_="CHAT_MESSAGE",
                    entity_type="ChatConversation", entity_id=conversation_id,
                )
                await notif_db.commit()

    except WebSocketDisconnect:
        pass
    finally:
        chat_manager.disconnect(conversation_id, current_user.id)
