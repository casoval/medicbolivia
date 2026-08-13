"""
app/services/professional_approval.py
Punto único que decide si un profesional ya cumple TODOS los requisitos
obligatorios y puede pasar a ProfessionalStatus.APPROVED (visible/agendable
para pacientes).

Antes esta lógica vivía solo dentro de review_document() en admin.py y
solo miraba documentos. Ahora hay más ítems obligatorios que no son
documentos-archivo (especialidad, matrícula como texto), cada uno con su
propio ciclo PENDING/APPROVED/REJECTED — así que el chequeo se centraliza
acá y se llama desde los tres lugares que pueden completar el último
requisito pendiente:
  - review_document()      (admin.py)      — documentos
  - review_item()           (admin.py)      — universidad/años exp./matrícula
  - review_proposal()       (specialties.py) — especialidad/subespecialidad

Documentos obligatorios: CI_FRONT, CI_BACK, PROFESSIONAL_TITLE,
HEALTH_MINISTRY, SELFIE_WITH_CI, SIGNATURE.
Información obligatoria (no-archivo): specialty_status, sub_specialty_status
(solo si se cargó una subespecialidad), professional_license_status.
Universidad y años de experiencia son OPCIONALES: si el profesional nunca
los cargó, no bloquean la aprobación (solo bloquean si los cargó y quedó
REJECTED sin corregir — ver _optional_item_blocks).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from app.models.models import Professional, ProfessionalDoc, DocStatus, ProfessionalStatus, User, UserStatus
from app.services.notify import notify_user

REQUIRED_DOC_TYPES = {
    "CI_FRONT", "CI_BACK", "PROFESSIONAL_TITLE",
    "HEALTH_MINISTRY", "SELFIE_WITH_CI", "SIGNATURE",
}


def _optional_item_blocks(status: DocStatus, has_value: bool) -> bool:
    """Un ítem opcional (universidad, años de experiencia) solo bloquea la
    aprobación si el profesional SÍ cargó un valor y ese valor quedó
    rechazado sin que lo haya corregido todavía (status volvería a PENDING
    al corregirlo). Si nunca cargó nada, no bloquea."""
    return has_value and status == DocStatus.REJECTED


async def check_and_approve_professional(db: AsyncSession, professional: Professional) -> bool:
    """Si el profesional ya cumple todo lo obligatorio, lo pasa a APPROVED
    (y activa su User). Devuelve True si recién ahora quedó aprobado (para
    que el caller decida si notificar el "¡Perfil verificado!")."""
    if professional.status == ProfessionalStatus.APPROVED:
        return False

    docs = (await db.execute(
        select(ProfessionalDoc).where(ProfessionalDoc.professional_id == professional.id)
    )).scalars().all()
    approved_doc_types = {d.doc_type.value for d in docs if d.status == DocStatus.APPROVED}
    if not REQUIRED_DOC_TYPES.issubset(approved_doc_types):
        return False

    if professional.specialty_status != DocStatus.APPROVED:
        return False
    if professional.sub_specialty and professional.sub_specialty_status != DocStatus.APPROVED:
        return False
    if professional.professional_license_status != DocStatus.APPROVED:
        return False

    if _optional_item_blocks(professional.university_status, bool(professional.university)):
        return False
    if _optional_item_blocks(professional.years_experience_status, professional.years_experience is not None):
        return False

    professional.status = ProfessionalStatus.APPROVED
    user_result = await db.execute(select(User).where(User.id == professional.user_id))
    user = user_result.scalar_one_or_none()
    if user:
        user.status = UserStatus.ACTIVE

    logger.info(f"Profesional aprobado automáticamente (todos los requisitos cumplidos): {professional.id}")

    await notify_user(
        db, user_id=professional.user_id,
        title="¡Perfil verificado!",
        body="Todos tus datos y documentos fueron aprobados. Ya podés activar tu disponibilidad y recibir pacientes.",
        type_="PROFESSIONAL_APPROVED",
        entity_type="Professional",
        entity_id=professional.id,
        send_whatsapp=False,
    )
    return True
