"""
app/services/chat.py
Lógica de negocio del chat interno paciente-profesional: validación de
bloqueo, acceso a conversaciones y su ciclo de vida.
"""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    ChatConversation, ChatConversationStatus, ChatBlock, Consultation,
    Patient, Professional, User,
)
from app.core.config import settings


async def is_blocked(db: AsyncSession, user_a: str, user_b: str) -> bool:
    """
    True si cualquiera de los dos bloqueó al otro (bloqueo por contacto),
    o si cualquiera de los dos activó el bloqueo global.
    """
    result = await db.execute(
        select(ChatBlock).where(
            or_(
                # Bloqueo global de cualquiera de las dos partes
                and_(ChatBlock.scope == "GLOBAL", ChatBlock.blocker_id.in_([user_a, user_b])),
                # Bloqueo puntual entre ambos, en cualquier dirección
                and_(ChatBlock.scope == "CONTACT", ChatBlock.blocker_id == user_a, ChatBlock.blocked_id == user_b),
                and_(ChatBlock.scope == "CONTACT", ChatBlock.blocker_id == user_b, ChatBlock.blocked_id == user_a),
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def get_conversation_for_user(
    db: AsyncSession, conversation_id: str, user_id: str
) -> Optional[ChatConversation]:
    """Trae la conversación solo si el usuario es uno de los dos participantes."""
    result = await db.execute(
        select(ChatConversation).where(
            and_(
                ChatConversation.id == conversation_id,
                or_(
                    ChatConversation.patient_user_id == user_id,
                    ChatConversation.professional_user_id == user_id,
                ),
            )
        )
    )
    return result.scalar_one_or_none()


def other_participant_id(conversation: ChatConversation, current_user_id: str) -> str:
    return (
        conversation.professional_user_id
        if current_user_id == conversation.patient_user_id
        else conversation.patient_user_id
    )


def is_conversation_writable(conversation: ChatConversation) -> bool:
    """Solo ACTIVE y sin haber vencido expires_at permite escribir."""
    if conversation.status != ChatConversationStatus.ACTIVE.value:
        return False
    if conversation.expires_at and conversation.expires_at < datetime.utcnow():
        return False
    return True


async def get_or_create_conversation_for_consultation(
    db: AsyncSession, consultation_id: str
) -> ChatConversation:
    """
    Idempotente: si ya existe la conversación para esta consulta, la
    retorna; si no, la crea. Se llama desde el momento en que la consulta
    queda PAGADA (no antes) — ver hook en consultations.py.
    expires_at queda en null hasta que la consulta termina (started_at/
    ended_at); mientras la consulta está en curso, el chat no tiene
    fecha de vencimiento todavía.
    """
    existing = await db.execute(
        select(ChatConversation).where(ChatConversation.consultation_id == consultation_id)
    )
    conv = existing.scalar_one_or_none()
    if conv:
        return conv

    result = await db.execute(
        select(Consultation).where(Consultation.id == consultation_id)
    )
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise ValueError("Consulta no encontrada")

    patient_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
    patient = patient_result.scalar_one_or_none()
    professional_result = await db.execute(select(Professional).where(Professional.id == consultation.professional_id))
    professional = professional_result.scalar_one_or_none()

    if not patient or not professional:
        raise ValueError("La consulta no tiene paciente y profesional asignados todavía")

    expires_at = None
    if consultation.ended_at:
        expires_at = consultation.ended_at + timedelta(days=settings.CHAT_WINDOW_DAYS)

    conv = ChatConversation(
        consultation_id=consultation_id,
        patient_user_id=patient.user_id,
        professional_user_id=professional.user_id,
        expires_at=expires_at,
    )
    db.add(conv)
    await db.flush()
    return conv


async def mark_conversation_expiry_on_consultation_end(db: AsyncSession, consultation_id: str) -> None:
    """Llamar cuando una Consultation pasa a ended_at != None, para fijar
    la fecha de vencimiento del chat asociado si ya existía."""
    result = await db.execute(
        select(ChatConversation).where(ChatConversation.consultation_id == consultation_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        return

    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = result.scalar_one_or_none()
    if consultation and consultation.ended_at:
        conv.expires_at = consultation.ended_at + timedelta(days=settings.CHAT_WINDOW_DAYS)
