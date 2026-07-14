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


async def has_effective_link(db: AsyncSession, patient_id: str, professional_id: str) -> bool:
    """
    Vínculo "efectivo": true si este paciente debe considerarse vinculado
    a este profesional para efectos de agendamiento directo (membresía) —
    es decir, si aparece en "Mis pacientes" del profesional.

    - Si existe una fila de PatientProfessionalLink (la más reciente
      manda): activa (revoked_at IS NULL) → vinculado; revocada → el
      paciente cortó el vínculo a propósito, no vinculado, aunque haya
      consultas previas.
    - Si NO existe ninguna fila (nunca se vinculó a mano, y la consulta es
      de antes de que existiera el auto-vínculo — ver
      ensure_patient_professional_link), se cae al historial: si tuvo al
      menos una consulta COMPLETED con este profesional, por lógica ya es
      "su paciente" y cuenta como vinculado.
    """
    existing = await db.execute(
        select(PatientProfessionalLink)
        .where(
            PatientProfessionalLink.patient_id == patient_id,
            PatientProfessionalLink.professional_id == professional_id,
        )
        .order_by(PatientProfessionalLink.created_at.desc())
        .limit(1)
    )
    link = existing.scalar_one_or_none()
    if link is not None:
        return link.revoked_at is None

    result = await db.execute(
        select(Consultation.id).where(
            Consultation.patient_id == patient_id,
            Consultation.professional_id == professional_id,
            Consultation.status == ConsultationStatus.COMPLETED,
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


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


async def professionals_with_active_membership(
    db: AsyncSession, professional_ids: list[str], at: datetime | None = None
) -> set[str]:
    """
    Versión en bulk de professional_has_active_membership — para listados
    (ej. el directorio público de profesionales) donde consultar uno por
    uno sería un N+1. Devuelve el subconjunto de IDs que tienen membresía
    activa ahora mismo.

    Misma conversión de hora que _has_active_membership: starts_at/ends_at
    de ProfessionalMembership están en hora de Bolivia, `at` llega en UTC.
    """
    if not professional_ids:
        return set()

    from datetime import timezone
    from sqlalchemy import or_
    from app.core.timezone import BOLIVIA_TZ
    from app.models.models import ProfessionalMembership

    at = at or datetime.utcnow()
    if at.tzinfo is not None:
        at = at.astimezone(timezone.utc).replace(tzinfo=None)
    at_bolivia = (at.replace(tzinfo=timezone.utc)).astimezone(BOLIVIA_TZ).replace(tzinfo=None)

    result = await db.execute(
        select(ProfessionalMembership.professional_id).where(
            ProfessionalMembership.professional_id.in_(professional_ids),
            ProfessionalMembership.active == True,  # noqa: E712
            ProfessionalMembership.starts_at <= at_bolivia,
            or_(ProfessionalMembership.ends_at.is_(None), ProfessionalMembership.ends_at > at_bolivia),
        )
    )
    return {row[0] for row in result.all()}


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
