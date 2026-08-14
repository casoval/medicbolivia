"""
app/services/support_chat.py
Lógica de negocio del chat directo con soporte (paciente/profesional <->
admin). Módulo separado del chat interno paciente-profesional
(app/services/chat.py): acá no hay bloqueo ni expiración — es la línea
directa con el equipo de MedicBolivia, siempre disponible salvo que el
admin apague el interruptor general (PlatformSettings.support_chat_enabled).
"""
from typing import Optional
from datetime import datetime

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezone import utcnow_naive
from app.models.models import (
    SupportConversation, SupportConversationStatus, SupportMessage,
    User, UserRole, Patient, Professional, PlatformSettings,
)


async def is_support_chat_enabled(db: AsyncSession) -> bool:
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "global"))
    row = result.scalar_one_or_none()
    if row is None:
        return True
    return row.support_chat_enabled


async def get_or_create_conversation_for_user(db: AsyncSession, user: User) -> SupportConversation:
    """
    Idempotente por usuario: la primera vez que un paciente o profesional
    abre el chat con soporte, se crea su único hilo; las siguientes veces
    se reusa el mismo (con todo su historial). Si estaba CLOSED (un admin
    la había marcado como resuelta), NO la reabre acá — se reabre sola
    apenas el usuario manda un mensaje nuevo (ver reopen_if_needed más
    abajo), para no confundir "abrir la pantalla" con "escribir de nuevo".
    """
    result = await db.execute(
        select(SupportConversation).where(SupportConversation.user_id == user.id)
    )
    conv = result.scalar_one_or_none()
    if conv:
        return conv

    conv = SupportConversation(
        user_id=user.id,
        user_role=user.role.value if hasattr(user.role, "value") else user.role,
        status=SupportConversationStatus.OPEN.value,
    )
    db.add(conv)
    await db.flush()
    return conv


async def get_conversation_for_participant(
    db: AsyncSession, conversation_id: str, current_user: User
) -> Optional[SupportConversation]:
    """Trae la conversación solo si el usuario logueado puede verla: es
    su propio hilo, o es un admin (cualquier admin puede ver cualquier
    conversación — bandeja compartida)."""
    result = await db.execute(
        select(SupportConversation).where(SupportConversation.id == conversation_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        return None
    if current_user.role == UserRole.ADMIN or conv.user_id == current_user.id:
        return conv
    return None


def reopen_if_needed(conv: SupportConversation) -> None:
    """Cualquier mensaje nuevo (de cualquiera de los dos lados) reabre la
    conversación si estaba cerrada. Es importante que el usuario nunca
    quede "trabado" sin poder volver a escribir por una decisión que tomó
    un admin en el pasado — a diferencia del chat interno, acá no hay
    ninguna razón de negocio para impedirlo."""
    if conv.status != SupportConversationStatus.OPEN.value:
        conv.status = SupportConversationStatus.OPEN.value
        conv.closed_by_admin_id = None
        conv.closed_at = None


async def has_unread_messages_from_user(db: AsyncSession, conversation_id: str, user_id: str) -> bool:
    """Usado para decidir si vale la pena escalar por WhatsApp a los
    admins: si ya había mensajes del usuario sin leer, no hace falta
    mandar otro aviso por WhatsApp por cada mensaje nuevo del mismo
    "impulso" de escritura — alcanza con el primero."""
    result = await db.execute(
        select(func.count(SupportMessage.id)).where(
            SupportMessage.conversation_id == conversation_id,
            SupportMessage.sender_id == user_id,
            SupportMessage.read_at.is_(None),
        )
    )
    return (result.scalar_one() or 0) > 0


async def build_participant_label(db: AsyncSession, user_id: str) -> tuple[str, Optional[str]]:
    """(nombre_completo, photo_url) del lado no-admin de la conversación,
    para mostrar en la bandeja del admin. Mismo patrón que
    _build_participant_response en chat.py."""
    patient_result = await db.execute(select(Patient).where(Patient.user_id == user_id))
    patient = patient_result.scalar_one_or_none()
    if patient:
        return f"{patient.first_name} {patient.last_name}", patient.photo_url

    prof_result = await db.execute(select(Professional).where(Professional.user_id == user_id))
    professional = prof_result.scalar_one_or_none()
    if professional:
        return f"Dr(a). {professional.first_name} {professional.last_name}", professional.photo_url

    return "Usuario", None


async def build_participant_labels(db: AsyncSession, user_ids: list[str]) -> dict[str, tuple[str, Optional[str]]]:
    """Versión batch de build_participant_label: resuelve (nombre, photo_url)
    para una lista de user_id con solo 2 queries (IN (...) a patients y a
    professionals), en vez de hasta 2 queries por usuario. Pensada para la
    bandeja del admin, que hace polling cada 20s sobre N conversaciones."""
    if not user_ids:
        return {}

    labels: dict[str, tuple[str, Optional[str]]] = {}

    patients_result = await db.execute(select(Patient).where(Patient.user_id.in_(user_ids)))
    for patient in patients_result.scalars().all():
        labels[patient.user_id] = (f"{patient.first_name} {patient.last_name}", patient.photo_url)

    remaining = [uid for uid in user_ids if uid not in labels]
    if remaining:
        prof_result = await db.execute(select(Professional).where(Professional.user_id.in_(remaining)))
        for professional in prof_result.scalars().all():
            labels[professional.user_id] = (
                f"Dr(a). {professional.first_name} {professional.last_name}", professional.photo_url,
            )

    for uid in user_ids:
        labels.setdefault(uid, ("Usuario", None))

    return labels


async def count_unread_by_conversation(db: AsyncSession, conversation_ids: list[str]) -> dict[str, int]:
    """Versión batch de "contar no leídos por conversación": un solo
    GROUP BY conversation_id con COUNT, en vez de traer todas las filas
    de mensajes no leídos de cada conversación para contarlas con len()
    en Python. Solo cuenta mensajes enviados por el usuario (no por
    admins), igual que el criterio de count_admin_unread."""
    if not conversation_ids:
        return {}

    result = await db.execute(
        select(SupportMessage.conversation_id, func.count(SupportMessage.id))
        .join(SupportConversation, SupportMessage.conversation_id == SupportConversation.id)
        .where(
            SupportMessage.conversation_id.in_(conversation_ids),
            SupportMessage.sender_id == SupportConversation.user_id,
            SupportMessage.read_at.is_(None),
        )
        .group_by(SupportMessage.conversation_id)
    )
    counts = {conv_id: count for conv_id, count in result.all()}
    return {conv_id: counts.get(conv_id, 0) for conv_id in conversation_ids}


async def list_admin_conversations(
    db: AsyncSession,
    status_filter: Optional[str] = None,
    role_filter: Optional[str] = None,
) -> list[SupportConversation]:
    conditions = []
    if status_filter:
        conditions.append(SupportConversation.status == status_filter)
    if role_filter:
        conditions.append(SupportConversation.user_role == role_filter)

    query = select(SupportConversation)
    if conditions:
        query = query.where(and_(*conditions))
    # Prioriza las que quedaron esperando respuesta del lado del usuario
    # (last_message_from='USER') antes que las que ya contestó un admin,
    # y dentro de cada grupo, la más reciente primero.
    query = query.order_by(
        (SupportConversation.last_message_from == "USER").desc(),
        SupportConversation.last_message_at.desc().nulls_last(),
        SupportConversation.created_at.desc(),
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_admin_unread(db: AsyncSession) -> int:
    """Total de mensajes de usuarios (no de admins) sin leer, sumando
    todas las conversaciones — para el badge del botón del encabezado."""
    result = await db.execute(
        select(func.count(SupportMessage.id))
        .join(SupportConversation, SupportMessage.conversation_id == SupportConversation.id)
        .where(
            SupportMessage.sender_id == SupportConversation.user_id,
            SupportMessage.read_at.is_(None),
        )
    )
    return result.scalar_one() or 0
