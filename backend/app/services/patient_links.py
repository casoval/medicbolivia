"""
app/services/patient_links.py
Vínculo "Mis pacientes" (PatientProfessionalLink) + helpers de membresía.

Reglas de negocio (definidas junto al usuario):
- Solo el PACIENTE puede crear el vínculo.
- Solo el PACIENTE puede revocarlo.
- No se puede revocar si queda alguna consulta activa (no completada,
  cancelada o reembolsada) entre ambos.
- El agendamiento libre / pago en efectivo (professional-schedule) requiere
  vínculo activo Y membresía activa del profesional — el vínculo por sí
  solo no da ningún privilegio si no hay membresía.
"""
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PatientProfessionalLink, Consultation, ConsultationStatus
from app.services.commission import _has_active_membership

# Estados que cuentan como "consulta activa" para bloquear la desvinculación.
# Mismo criterio que ya usa create_consultation para detectar choques de horario.
_ACTIVE_CONSULTATION_STATUSES = [
    ConsultationStatus.AGENT_TRIAGING,
    ConsultationStatus.WAITING_PROFESSIONAL,
    ConsultationStatus.PROFESSIONAL_ACCEPTED,
    ConsultationStatus.WAITING_PAYMENT,
    ConsultationStatus.PAYMENT_CONFIRMED,
    ConsultationStatus.IN_PROGRESS,
]


async def get_active_link(db: AsyncSession, patient_id: str, professional_id: str) -> PatientProfessionalLink | None:
    result = await db.execute(
        select(PatientProfessionalLink).where(
            PatientProfessionalLink.patient_id == patient_id,
            PatientProfessionalLink.professional_id == professional_id,
            PatientProfessionalLink.revoked_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def has_pending_consultations_between(db: AsyncSession, patient_id: str, professional_id: str) -> bool:
    result = await db.execute(
        select(Consultation.id).where(
            Consultation.patient_id == patient_id,
            Consultation.professional_id == professional_id,
            Consultation.status.in_(_ACTIVE_CONSULTATION_STATUSES),
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def professional_has_active_membership(db: AsyncSession, professional_id: str, at: datetime | None = None) -> bool:
    """Wrapper público — el resto de la app no debería importar el helper
    privado de commission.py directamente."""
    return await _has_active_membership(db, professional_id, at or datetime.utcnow())


async def ensure_patient_professional_link(db: AsyncSession, patient_id: str, professional_id: str) -> None:
    """
    Auto-vínculo: se llama cuando una consulta real termina en COMPLETED
    (cualquier tipo — inmediata, agendada o seguimiento), para que el
    paciente aparezca automáticamente en "Mis pacientes" del profesional
    sin tener que vincularse a mano desde la búsqueda.

    Idempotente: si ya existe un vínculo activo, no hace nada. Si el único
    vínculo que existe está revocado (el paciente se desvinculó antes), NO
    lo reactiva — eso sería ignorar una decisión explícita del paciente;
    en ese caso se crea un vínculo nuevo solo si no hay ninguno activo Y
    el paciente no lo revocó explícitamente. (Por ahora: si hay un
    revocado, se respeta y no se re-crea automáticamente).

    No aplica a consultas marcadas COMPLETED por no-show del paciente
    (nunca hubo un encuentro real) — ese caso no llama a esta función.
    """
    existing = await db.execute(
        select(PatientProfessionalLink).where(
            PatientProfessionalLink.patient_id == patient_id,
            PatientProfessionalLink.professional_id == professional_id,
        ).order_by(PatientProfessionalLink.created_at.desc()).limit(1)
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        return  # ya existe (activo o revocado a propósito) — no tocar

    db.add(PatientProfessionalLink(patient_id=patient_id, professional_id=professional_id))
