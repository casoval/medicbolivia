"""
app/services/chat.py
Lógica de negocio del chat interno paciente-profesional: validación de
bloqueo, reportes al admin, visibilidad integral (Mis Pacientes), rate
limiting y ciclo de vida de la conversación.
"""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, or_, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    ChatConversation, ChatConversationStatus, ChatBlock, ChatBlockOrigin,
    ProfessionalPatientVisibility, Consultation, ConsultationStatus,
    Patient, Professional, User, PlatformSettings,
)
from app.core.config import settings

# ── Rate limiting (ver sección 7 del diseño) ─────────────────────────
# Máximo de acciones de bloqueo/desbloqueo (cualquier scope u origen)
# que un mismo usuario puede hacer en 24h, para evitar que alguien
# bloquee/desbloquee repetidamente como forma de hostigamiento.
MAX_BLOCK_ACTIONS_PER_DAY = 5
# Cooldown entre una acción de bloqueo/desbloqueo y la siguiente SOBRE
# EL MISMO contacto puntual.
BLOCK_SAME_CONTACT_COOLDOWN_HOURS = 24
# Máximo de reportes enviados al admin por usuario en 24h.
MAX_REPORTS_PER_DAY = 3


class RateLimitError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class PendingAppointmentsError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


# ─────────────────────────────────────────────────────
# Configuración de chat (admin-editable, con fallback a env var)
# ─────────────────────────────────────────────────────

async def get_chat_window_days(db: AsyncSession) -> int:
    """Valor vigente HOY de la ventana de chat post-consulta. Se lee de
    PlatformSettings (editable desde el panel admin); si la fila todavía
    no existe, cae al valor de settings.CHAT_WINDOW_DAYS (env var)."""
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "global"))
    row = result.scalar_one_or_none()
    if row is not None:
        return row.chat_window_days
    return settings.CHAT_WINDOW_DAYS


async def get_chat_attachments_enabled(db: AsyncSession, role: str) -> bool:
    """role: 'PATIENT' o 'PROFESSIONAL'."""
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "global"))
    row = result.scalar_one_or_none()
    if row is None:
        return True
    return row.chat_attachments_enabled_patient if role == "PATIENT" else row.chat_attachments_enabled_professional


def _effective_chat_window_days(consultation: Consultation, fallback_days: int) -> int:
    """Usa el snapshot guardado en la consulta si existe (consultas
    creadas después de este cambio); si no, usa el valor global vigente
    como fallback (consultas viejas, sin snapshot)."""
    if consultation.chat_window_days_snapshot is not None:
        return consultation.chat_window_days_snapshot
    return fallback_days


# ─────────────────────────────────────────────────────
# Bloqueo de chat (puntual, scope CONTACT/GLOBAL)
# ─────────────────────────────────────────────────────

async def get_my_active_blocks(db: AsyncSession, my_id: str, other_id: str) -> tuple[bool, bool]:
    """Retorna (bloqueo_contact_activo, bloqueo_global_activo) que YO
    (my_id) tengo activo contra other_id. Usado para que el frontend
    muestre 'Desbloquear' en vez de 'Bloquear' sin llamadas extra."""
    result = await db.execute(
        select(ChatBlock).where(
            ChatBlock.blocker_id == my_id,
            ChatBlock.unblocked_at.is_(None),
            or_(
                and_(ChatBlock.scope == "CONTACT", ChatBlock.blocked_id == other_id),
                ChatBlock.scope == "GLOBAL",
            ),
        )
    )
    rows = result.scalars().all()
    contact = any(r.scope == "CONTACT" for r in rows)
    glob = any(r.scope == "GLOBAL" for r in rows)
    return contact, glob


async def is_blocked(db: AsyncSession, user_a: str, user_b: str) -> bool:
    """
    True si cualquiera de los dos bloqueó al otro (bloqueo por contacto),
    o si cualquiera de los dos activó el bloqueo global. Solo cuentan
    bloqueos ACTIVOS (unblocked_at IS NULL) — un bloqueo desbloqueado
    queda en la tabla como historial, pero deja de aplicar.
    """
    result = await db.execute(
        select(ChatBlock).where(
            and_(
                ChatBlock.unblocked_at.is_(None),
                or_(
                    and_(ChatBlock.scope == "GLOBAL", ChatBlock.blocker_id.in_([user_a, user_b])),
                    and_(ChatBlock.scope == "CONTACT", ChatBlock.blocker_id == user_a, ChatBlock.blocked_id == user_b),
                    and_(ChatBlock.scope == "CONTACT", ChatBlock.blocker_id == user_b, ChatBlock.blocked_id == user_a),
                ),
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _check_rate_limits(
    db: AsyncSession, actor_user_id: str, target_user_id: Optional[str], is_reported: bool,
) -> None:
    """Lanza RateLimitError si el usuario se pasó de los límites definidos
    arriba. Se llama antes de crear cualquier ChatBlock o
    ProfessionalPatientVisibility (bloqueo integral)."""
    since = datetime.utcnow() - timedelta(hours=24)

    total_today = (await db.execute(
        select(func.count(ChatBlock.id)).where(
            ChatBlock.blocker_id == actor_user_id,
            ChatBlock.created_at >= since,
        )
    )).scalar_one()
    if total_today >= MAX_BLOCK_ACTIONS_PER_DAY:
        raise RateLimitError(
            f"Alcanzaste el máximo de {MAX_BLOCK_ACTIONS_PER_DAY} acciones de "
            "bloqueo/desbloqueo por día. Intenta de nuevo mañana."
        )

    if target_user_id:
        recent_same_contact = (await db.execute(
            select(func.count(ChatBlock.id)).where(
                ChatBlock.blocker_id == actor_user_id,
                ChatBlock.blocked_id == target_user_id,
                ChatBlock.created_at >= datetime.utcnow() - timedelta(hours=BLOCK_SAME_CONTACT_COOLDOWN_HOURS),
            )
        )).scalar_one()
        if recent_same_contact > 0:
            raise RateLimitError(
                f"Ya hiciste una acción de bloqueo/desbloqueo con este contacto en las "
                f"últimas {BLOCK_SAME_CONTACT_COOLDOWN_HOURS}h. Espera antes de repetirla."
            )

    if is_reported:
        reports_today = (await db.execute(
            select(func.count(ChatBlock.id)).where(
                ChatBlock.blocker_id == actor_user_id,
                ChatBlock.is_reported.is_(True),
                ChatBlock.created_at >= since,
            )
        )).scalar_one()
        if reports_today >= MAX_REPORTS_PER_DAY:
            raise RateLimitError(
                f"Alcanzaste el máximo de {MAX_REPORTS_PER_DAY} reportes al equipo de "
                "MedicBolivia por día. Intenta de nuevo mañana."
            )


async def create_chat_block(
    db: AsyncSession,
    *,
    blocker_id: str,
    blocked_id: Optional[str],
    scope: str,
    origin: str = ChatBlockOrigin.CHAT_WINDOW.value,
    is_reported: bool = False,
    reason_category: Optional[str] = None,
    reason_text: Optional[str] = None,
) -> ChatBlock:
    """Crea el bloqueo aplicando rate limiting. No hace commit (lo maneja
    el endpoint que llama, para poder combinarlo en una transacción con
    ProfessionalPatientVisibility cuando corresponde)."""
    await _check_rate_limits(db, blocker_id, blocked_id, is_reported)

    block = ChatBlock(
        blocker_id=blocker_id,
        blocked_id=blocked_id,
        scope=scope,
        origin=origin,
        is_reported=is_reported,
        reason_category=reason_category if is_reported else None,
        reason_text=reason_text if is_reported else None,
        admin_notified_at=datetime.utcnow() if is_reported else None,
    )
    db.add(block)
    await db.flush()
    return block


async def unblock_chat(
    db: AsyncSession, *, blocker_id: str, scope: str, blocked_id: Optional[str], unblocked_by_id: str,
) -> None:
    """Soft-delete: marca unblocked_at en vez de borrar, para conservar
    el historial completo de bloqueos/desbloqueos."""
    query = select(ChatBlock).where(
        ChatBlock.blocker_id == blocker_id,
        ChatBlock.scope == scope,
        ChatBlock.unblocked_at.is_(None),
    )
    if scope == "CONTACT":
        query = query.where(ChatBlock.blocked_id == blocked_id)
    result = await db.execute(query)
    rows = result.scalars().all()
    for row in rows:
        row.unblocked_at = datetime.utcnow()
        row.unblocked_by_id = unblocked_by_id
    await db.flush()


# ─────────────────────────────────────────────────────
# Bloqueo INTEGRAL desde "Mis Pacientes" (solo profesional -> paciente)
# ─────────────────────────────────────────────────────

async def assert_no_pending_appointments(db: AsyncSession, professional_id: str, patient_id: str) -> None:
    """Lanza PendingAppointmentsError si hay alguna consulta pendiente
    (no finalizada/cancelada) entre este profesional y este paciente.
    El profesional debe resolverla por los medios normales (cancelar,
    etc.) antes de poder bloquear integralmente al paciente — así se
    evita cualquier ambigüedad sobre qué pasa con una cita ya agendada."""
    finished_statuses = (
        ConsultationStatus.COMPLETED,
        ConsultationStatus.CANCELLED,
        ConsultationStatus.REFUNDED,
    )
    result = await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.professional_id == professional_id,
            Consultation.patient_id == patient_id,
            Consultation.status.not_in(finished_statuses),
        )
    )
    pending_count = result.scalar_one()
    if pending_count > 0:
        raise PendingAppointmentsError(
            "No puedes bloquear a este paciente mientras tengan citas pendientes. "
            "Cancela o resuelve esas citas primero desde tu agenda."
        )


async def get_visibility_block(
    db: AsyncSession, professional_id: str, patient_id: str
) -> Optional[ProfessionalPatientVisibility]:
    result = await db.execute(
        select(ProfessionalPatientVisibility).where(
            ProfessionalPatientVisibility.professional_id == professional_id,
            ProfessionalPatientVisibility.patient_id == patient_id,
            ProfessionalPatientVisibility.restored_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def block_patient_integrally(
    db: AsyncSession,
    *,
    professional_id: str,
    professional_user_id: str,
    patient_id: str,
    patient_user_id: str,
    is_reported: bool,
    reason_category: Optional[str],
    reason_text: Optional[str],
) -> ProfessionalPatientVisibility:
    """Bloqueo integral: visibilidad + chat, todo junto. Precondición:
    sin citas pendientes (ver assert_no_pending_appointments, se llama
    desde el endpoint antes de invocar esta función)."""
    await _check_rate_limits(db, professional_user_id, patient_user_id, is_reported)

    existing = await get_visibility_block(db, professional_id, patient_id)
    if existing:
        return existing  # ya estaba bloqueado, idempotente

    visibility = ProfessionalPatientVisibility(
        professional_id=professional_id,
        patient_id=patient_id,
        hidden=True,
        is_reported=is_reported,
        reason_category=reason_category if is_reported else None,
        reason_text=reason_text if is_reported else None,
        admin_notified_at=datetime.utcnow() if is_reported else None,
    )
    db.add(visibility)

    # Efecto derivado automático: también corta el chat entre ambos.
    db.add(ChatBlock(
        blocker_id=professional_user_id,
        blocked_id=patient_user_id,
        scope="CONTACT",
        origin=ChatBlockOrigin.PATIENT_LIST.value,
        is_reported=is_reported,
        reason_category=reason_category if is_reported else None,
        reason_text=reason_text if is_reported else None,
        admin_notified_at=datetime.utcnow() if is_reported else None,
    ))

    await db.flush()
    return visibility


async def unblock_patient_integrally(
    db: AsyncSession, *, professional_id: str, professional_user_id: str,
    patient_id: str, patient_user_id: str, unblocked_by_id: str,
) -> None:
    """Revierte la visibilidad y el chat derivado juntos. La conversación
    de chat en sí puede seguir sin poder escribirse si su propia ventana
    de 15 días ya venció (ver is_conversation_writable) — eso es
    independiente de este desbloqueo."""
    visibility = await get_visibility_block(db, professional_id, patient_id)
    if visibility:
        visibility.restored_at = datetime.utcnow()
        visibility.restored_by_id = unblocked_by_id

    await unblock_chat(
        db,
        blocker_id=professional_user_id,
        scope="CONTACT",
        blocked_id=patient_user_id,
        unblocked_by_id=unblocked_by_id,
    )
    await db.flush()


async def is_professional_hidden_for_patient(db: AsyncSession, professional_id: str, patient_id: str) -> bool:
    """Para usar en búsqueda/listado de profesionales y en el endpoint de
    agendar cita: True si este profesional está oculto/bloqueado
    integralmente para este paciente puntual."""
    block = await get_visibility_block(db, professional_id, patient_id)
    return block is not None and block.hidden


# ─────────────────────────────────────────────────────
# Conversación: acceso y ciclo de vida
# ─────────────────────────────────────────────────────

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
    Idempotente — pero OJO: idempotente por PAR paciente-profesional, no
    por consulta. Si el mismo paciente y el mismo profesional ya tienen
    un hilo de chat (de una consulta anterior), esta consulta reutiliza
    y reactiva ese mismo hilo en vez de crear uno nuevo; así todo el
    historial de conversación entre ambos queda junto, sin importar
    cuántas consultas distintas hayan tenido.

    Se llama desde el momento en que la consulta queda PAGADA (no antes)
    — ver hook en consultations.py. expires_at queda en null hasta que
    la consulta termina (started_at/ended_at); mientras la consulta está
    en curso, el chat no tiene fecha de vencimiento todavía. Si se
    reutiliza un hilo que había expirado, se reactiva y su expires_at se
    empuja hacia adelante con la ventana de esta nueva consulta.

    Al crear/reactivar, se congela en la consulta el chat_window_days
    vigente HOY (snapshot) si todavía no tenía uno — así, si el admin
    cambia el valor global más adelante, esta consulta no se ve afectada
    retroactivamente.
    """
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

    if consultation.chat_window_days_snapshot is None:
        consultation.chat_window_days_snapshot = await get_chat_window_days(db)

    expires_at = None
    if consultation.ended_at:
        window_days = _effective_chat_window_days(consultation, await get_chat_window_days(db))
        expires_at = consultation.ended_at + timedelta(days=window_days)

    existing = await db.execute(
        select(ChatConversation).where(
            ChatConversation.patient_user_id == patient.user_id,
            ChatConversation.professional_user_id == professional.user_id,
        )
    )
    conv = existing.scalar_one_or_none()
    if conv:
        # Nueva consulta entre el mismo par: el hilo compartido se
        # reactiva (por si estaba EXPIRED/CLOSED por vencimiento natural,
        # no por bloqueo/admin) y su vencimiento se extiende con la
        # ventana de esta consulta más reciente.
        conv.consultation_id = consultation_id
        if conv.status == ChatConversationStatus.EXPIRED.value:
            conv.status = ChatConversationStatus.ACTIVE.value
        if expires_at and (conv.expires_at is None or expires_at > conv.expires_at):
            conv.expires_at = expires_at
        elif expires_at is None:
            conv.expires_at = None
        return conv

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
    la fecha de vencimiento del chat asociado si ya existía. Busca el
    hilo por el par paciente-profesional de la consulta (el hilo es
    compartido entre todas las consultas de ese par), no por
    consultation_id directamente."""
    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = result.scalar_one_or_none()
    if not consultation or not consultation.ended_at:
        return

    patient_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
    patient = patient_result.scalar_one_or_none()
    professional_result = await db.execute(select(Professional).where(Professional.id == consultation.professional_id))
    professional = professional_result.scalar_one_or_none()
    if not patient or not professional:
        return

    result = await db.execute(
        select(ChatConversation).where(
            ChatConversation.patient_user_id == patient.user_id,
            ChatConversation.professional_user_id == professional.user_id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        return

    if consultation.chat_window_days_snapshot is None:
        consultation.chat_window_days_snapshot = await get_chat_window_days(db)
    window_days = _effective_chat_window_days(consultation, await get_chat_window_days(db))
    conv.expires_at = consultation.ended_at + timedelta(days=window_days)
