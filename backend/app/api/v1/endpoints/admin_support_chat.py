"""
app/api/v1/endpoints/admin_support_chat.py
Bandeja del admin para el chat directo con soporte (paciente/profesional
<-> admin). Registrado aparte de admin.py (que ya es un archivo enorme),
mismo criterio que admin_reports.py.

Es una bandeja COMPARTIDA: cualquier admin ve todas las conversaciones y
puede responder cualquiera — no hay asignación 1 a 1 entre un admin y un
usuario. El WebSocket de mensajería en vivo vive en support_chat.py
(compartido con el lado usuario) — este archivo solo trae los endpoints
REST propios del admin (listar, cerrar, reabrir, adjuntar).
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from datetime import datetime

from app.core.timezone import utcnow_naive
from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.core.support_chat_ws_manager import support_chat_manager
from app.core.config import settings
from app.models.models import User, SupportConversation, SupportConversationStatus, SupportMessage
from app.schemas.schemas import (
    SupportConversationResponse, SupportChatParticipantResponse,
    SupportMessageResponse, SupportChatCloseRequest,
)
from app.services.support_chat import (
    list_admin_conversations, build_participant_label, count_admin_unread,
)
from app.services.storage import upload_chat_attachment_to_r2, get_presigned_url

router = APIRouter()

ALLOWED_ATTACHMENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


async def _resolve_attachment_url(attachment_key: str | None) -> str | None:
    if not attachment_key:
        return None
    return await get_presigned_url(attachment_key, expires_seconds=3600)


async def _build_message_response(msg: SupportMessage, conv_user_id: str) -> SupportMessageResponse:
    return SupportMessageResponse(
        id=msg.id, conversation_id=msg.conversation_id, sender_id=msg.sender_id,
        is_admin_sender=msg.sender_id != conv_user_id,
        content=msg.content,
        attachment_url=await _resolve_attachment_url(msg.attachment_key),
        attachment_content_type=msg.attachment_content_type,
        read_at=msg.read_at, created_at=msg.created_at,
    )


@router.get("/conversations", response_model=list[SupportConversationResponse])
async def list_conversations(
    status_filter: str | None = Query(None, alias="status", description="OPEN o CLOSED"),
    role: str | None = Query(None, description="PATIENT o PROFESSIONAL"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    conversations = await list_admin_conversations(db, status_filter=status_filter, role_filter=role)

    responses = []
    for conv in conversations:
        name, photo = await build_participant_label(db, conv.user_id)
        unread = (await db.execute(
            select(SupportMessage).where(
                SupportMessage.conversation_id == conv.id,
                SupportMessage.sender_id == conv.user_id,
                SupportMessage.read_at.is_(None),
            )
        )).scalars().all()
        responses.append(SupportConversationResponse(
            id=conv.id, status=conv.status, last_message_at=conv.last_message_at,
            last_message_preview=conv.last_message_preview, last_message_from=conv.last_message_from,
            created_at=conv.created_at,
            participant=SupportChatParticipantResponse(
                user_id=conv.user_id, full_name=name, photo_url=photo, role=conv.user_role,
            ),
            unread_count=len(unread),
        ))
    return responses


@router.get("/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Total de mensajes de usuarios sin leer, para el badge del botón
    del encabezado del panel admin."""
    return {"unread": await count_admin_unread(db)}


@router.get("/conversations/{conversation_id}/messages", response_model=list[SupportMessageResponse])
async def get_messages(
    conversation_id: str,
    before: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    conv = (await db.execute(select(SupportConversation).where(SupportConversation.id == conversation_id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    query = select(SupportMessage).where(SupportMessage.conversation_id == conversation_id)
    if before:
        query = query.where(SupportMessage.created_at < before)
    query = query.order_by(desc(SupportMessage.created_at)).limit(limit)

    result = await db.execute(query)
    messages = list(reversed(result.scalars().all()))
    return [await _build_message_response(m, conv.user_id) for m in messages]


@router.post("/conversations/{conversation_id}/read")
async def mark_read(
    conversation_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    conv = (await db.execute(select(SupportConversation).where(SupportConversation.id == conversation_id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    result = await db.execute(
        select(SupportMessage).where(
            SupportMessage.conversation_id == conversation_id,
            SupportMessage.sender_id == conv.user_id,
            SupportMessage.read_at.is_(None),
        )
    )
    unread = result.scalars().all()
    now = utcnow_naive()
    for msg in unread:
        msg.read_at = now
    await db.commit()

    if unread:
        await support_chat_manager.broadcast(conversation_id, {
            "type": "read", "reader_id": current_user.id, "read_at": now.isoformat() + "Z",
        })
    return {"marked": len(unread)}


@router.post("/conversations/{conversation_id}/attachments", response_model=SupportMessageResponse)
async def send_attachment(
    conversation_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    conv = (await db.execute(select(SupportConversation).where(SupportConversation.id == conversation_id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tipo de archivo no permitido. Solo imágenes (JPEG, PNG, WEBP) o PDF")

    content = await file.read()
    max_bytes = settings.CHAT_MAX_ATTACHMENT_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Archivo demasiado grande. Máximo {settings.CHAT_MAX_ATTACHMENT_MB} MB")

    attachment_key = await upload_chat_attachment_to_r2(
        file_content=content, file_name=file.filename or "archivo",
        conversation_id=conversation_id, content_type=file.content_type,
    )

    # Cualquier respuesta del admin reabre la conversación si estaba cerrada.
    conv.status = SupportConversationStatus.OPEN.value
    conv.closed_by_admin_id = None
    conv.closed_at = None

    msg = SupportMessage(
        conversation_id=conversation_id, sender_id=current_user.id,
        attachment_key=attachment_key, attachment_content_type=file.content_type,
    )
    db.add(msg)
    conv.last_message_at = utcnow_naive()
    conv.last_message_preview = "📎 Adjunto"
    conv.last_message_from = "ADMIN"
    await db.flush()

    response = await _build_message_response(msg, conv.user_id)
    await db.commit()

    await support_chat_manager.broadcast(conversation_id, {"type": "message", **response.model_dump(mode="json")})

    from app.services.notify import notify_user
    await notify_user(
        db, user_id=conv.user_id,
        title="Respuesta de soporte",
        body="El equipo de MedicBolivia te envió un archivo adjunto",
        type_="SUPPORT_CHAT_MESSAGE",
        entity_type="SupportConversation", entity_id=conversation_id,
        send_whatsapp=False,
    )
    await db.commit()

    return response


@router.post("/conversations/{conversation_id}/close", response_model=SupportConversationResponse)
async def close_conversation(
    conversation_id: str,
    data: SupportChatCloseRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Marca la conversación como resuelta. No es un bloqueo — el usuario
    puede seguir escribiendo en cualquier momento y el hilo se reabre
    solo (ver reopen_if_needed en services/support_chat.py)."""
    conv = (await db.execute(select(SupportConversation).where(SupportConversation.id == conversation_id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    conv.status = SupportConversationStatus.CLOSED.value
    conv.closed_by_admin_id = current_user.id
    conv.closed_at = utcnow_naive()
    await db.commit()
    await db.refresh(conv)

    return SupportConversationResponse(
        id=conv.id, status=conv.status, last_message_at=conv.last_message_at,
        last_message_preview=conv.last_message_preview, last_message_from=conv.last_message_from,
        created_at=conv.created_at, unread_count=0,
    )


@router.post("/conversations/{conversation_id}/reopen", response_model=SupportConversationResponse)
async def reopen_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    conv = (await db.execute(select(SupportConversation).where(SupportConversation.id == conversation_id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")

    conv.status = SupportConversationStatus.OPEN.value
    conv.closed_by_admin_id = None
    conv.closed_at = None
    await db.commit()
    await db.refresh(conv)

    return SupportConversationResponse(
        id=conv.id, status=conv.status, last_message_at=conv.last_message_at,
        last_message_preview=conv.last_message_preview, last_message_from=conv.last_message_from,
        created_at=conv.created_at, unread_count=0,
    )
