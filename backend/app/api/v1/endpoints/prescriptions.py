"""
app/api/v1/endpoints/prescriptions.py
Recetas digitales con firma criptográfica y verificación QR.
"""
import hashlib
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user, get_current_professional
from app.models.models import (
    User, Patient, Professional, Consultation, Prescription,
    ConsultationStatus, ProfessionalStatus, PrescriptionStatus
)
from app.schemas.schemas import PrescriptionCreateRequest, PrescriptionResponse, PrescriptionVoidRequest

router = APIRouter()


def _generate_prescription_hash(data: dict) -> str:
    content = (
        f"{data['consultation_id']}"
        f"{data['professional_id']}"
        f"{data['patient_ci']}"
        f"{data['medications']}"
        f"{data['signed_at']}"
    )
    return hashlib.sha256(content.encode()).hexdigest()


def _enrich(prescription: Prescription, professional: Professional | None, patient: Patient | None = None) -> PrescriptionResponse:
    """Convierte Prescription ORM → PrescriptionResponse con datos del médico."""
    base = PrescriptionResponse.model_validate(prescription)
    if professional:
        base.professional_name     = f"Dr. {professional.first_name} {professional.last_name}"
        base.professional_specialty = professional.specialty
        base.professional_sub_specialties = professional.sub_specialties or []
        base.professional_department = professional.department
        base.cmb_matricula          = professional.cmb_matricula
    if patient:
        base.patient_photo_url = patient.photo_url
    return base


# ── POST /prescriptions ──────────────────────────────
@router.post(
    "",
    response_model=PrescriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Emitir receta digital firmada"
)
async def create_prescription(
    data: PrescriptionCreateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=403, detail="Tu perfil no está verificado para emitir recetas")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == data.consultation_id,
            Consultation.professional_id == professional.id
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o no te pertenece")

    # Si esta receta reemplaza a una anulada, validar que exista, sea tuya
    # y esté efectivamente anulada (no se puede "reemplazar" una vigente).
    if data.replaces_prescription_id:
        orig_result = await db.execute(
            select(Prescription).where(
                Prescription.id == data.replaces_prescription_id,
                Prescription.professional_id == professional.id
            )
        )
        original = orig_result.scalar_one_or_none()
        if not original:
            raise HTTPException(status_code=404, detail="Receta original a reemplazar no encontrada o no te pertenece")
        if original.status != PrescriptionStatus.VOIDED.value:
            raise HTTPException(status_code=400, detail="Solo puedes reemplazar una receta que ya haya sido anulada")

    # GAP 3: la receta se puede emitir DURANTE la videollamada (IN_PROGRESS)
    # o justo después de terminarla (COMPLETED), para que el médico no
    # dependa de acordarse después. Fuera de esos estados (consulta aún
    # no iniciada, cancelada, etc.) no tiene sentido emitir receta.
    if consultation.status not in (ConsultationStatus.IN_PROGRESS, ConsultationStatus.COMPLETED):
        raise HTTPException(
            status_code=400,
            detail="Solo puedes emitir una receta mientras la videollamada está en curso o recién finalizada."
        )

    patient_result = await db.execute(
        select(Patient).where(Patient.id == consultation.patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    today = datetime.utcnow()
    age = today.year - patient.birth_date.year - (
        (today.month, today.day) < (patient.birth_date.month, patient.birth_date.day)
    )

    medications_data = [med.model_dump() for med in data.medications]
    signed_at = datetime.utcnow()

    digital_hash = _generate_prescription_hash({
        "consultation_id": data.consultation_id,
        "professional_id": professional.id,
        "patient_ci":      patient.ci,
        "medications":     str(medications_data),
        "signed_at":       signed_at.isoformat(),
    })

    qr_verify_code = f"MB-RX-{uuid.uuid4().hex[:12].upper()}"

    prescription = Prescription(
        consultation_id=data.consultation_id,
        professional_id=professional.id,
        patient_name=f"{patient.first_name} {patient.last_name}",
        patient_ci=patient.ci,
        patient_age=age,
        medications=medications_data,
        instructions=data.instructions,
        digital_hash=digital_hash,
        qr_verify_code=qr_verify_code,
        signed_at=signed_at,
        replaces_prescription_id=data.replaces_prescription_id,
    )
    db.add(prescription)
    await db.commit()
    await db.refresh(prescription)

    logger.info(f"Receta emitida: {prescription.id} | profesional: {professional.id} | paciente: {patient.id}")
    return _enrich(prescription, professional)


# ── POST /prescriptions/{id}/void ────────────────────
@router.post(
    "/{prescription_id}/void",
    response_model=PrescriptionResponse,
    summary="Anular una receta firmada (para corregirla, se debe reemitir una nueva)"
)
async def void_prescription(
    prescription_id: str,
    data: PrescriptionVoidRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    rx_result = await db.execute(
        select(Prescription).where(
            Prescription.id == prescription_id,
            Prescription.professional_id == professional.id
        )
    )
    prescription = rx_result.scalar_one_or_none()
    if not prescription:
        raise HTTPException(status_code=404, detail="Receta no encontrada o no te pertenece")

    if prescription.status == PrescriptionStatus.VOIDED.value:
        raise HTTPException(status_code=400, detail="Esta receta ya está anulada")

    prescription.status = PrescriptionStatus.VOIDED.value
    prescription.voided_at = datetime.utcnow()
    prescription.void_reason = data.reason
    await db.commit()
    await db.refresh(prescription)

    logger.info(f"Receta anulada: {prescription.id} | profesional: {professional.id}")
    return _enrich(prescription, professional)


# ── GET /prescriptions/my ────────────────────────────
@router.get(
    "/my",
    response_model=list[PrescriptionResponse],
    summary="Recetas emitidas por el profesional logueado"
)
async def get_my_prescriptions(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    result = await db.execute(
        select(Prescription, Patient)
        .join(Consultation, Prescription.consultation_id == Consultation.id, isouter=True)
        .join(Patient, Consultation.patient_id == Patient.id, isouter=True)
        .where(Prescription.professional_id == professional.id)
        .order_by(Prescription.created_at.desc())
    )
    rows = result.all()
    return [_enrich(p, professional, pat) for p, pat in rows]


# ── GET /prescriptions/patient/my ───────────────────
@router.get(
    "/patient/my",
    response_model=list[PrescriptionResponse],
    summary="Recetas del paciente logueado"
)
async def get_my_patient_prescriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    result = await db.execute(
        select(Prescription)
        .join(Consultation, Prescription.consultation_id == Consultation.id)
        .where(Consultation.patient_id == patient.id)
        .order_by(Prescription.created_at.desc())
    )
    prescriptions = result.scalars().all()

    # Enriquecer con datos del médico de cada receta
    enriched = []
    for p in prescriptions:
        prof_result = await db.execute(
            select(Professional).where(Professional.id == p.professional_id)
        )
        prof = prof_result.scalar_one_or_none()
        enriched.append(_enrich(p, prof))
    return enriched


# ── GET /prescriptions/patient/{patient_id}/mine ─────
# Recetas que YO (el profesional logueado) emití para un paciente
# específico, sin importar en qué consulta. Pensado para que el médico
# pueda repasar el historial propio de ese paciente antes de atenderlo
# (por ejemplo, desde la cita agendada en el dashboard).
@router.get(
    "/patient/{patient_id}/mine",
    response_model=list[PrescriptionResponse],
    summary="[Profesional] Recetas que yo emití para un paciente específico"
)
async def get_my_prescriptions_for_patient(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    result = await db.execute(
        select(Prescription, Patient)
        .join(Consultation, Prescription.consultation_id == Consultation.id)
        .join(Patient, Consultation.patient_id == Patient.id, isouter=True)
        .where(
            Prescription.professional_id == professional.id,
            Consultation.patient_id == patient_id,
        )
        .order_by(Prescription.created_at.desc())
    )
    rows = result.all()
    return [_enrich(p, professional, pat) for p, pat in rows]


# ── GET /prescriptions/consultation/{id} ────────────
@router.get(
    "/consultation/{consultation_id}",
    response_model=list[PrescriptionResponse],
    summary="Obtener recetas de una consulta"
)
async def get_by_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Prescription).where(Prescription.consultation_id == consultation_id)
    )
    prescriptions = result.scalars().all()

    enriched = []
    for p in prescriptions:
        prof_result = await db.execute(
            select(Professional).where(Professional.id == p.professional_id)
        )
        prof = prof_result.scalar_one_or_none()
        enriched.append(_enrich(p, prof))
    return enriched


# ── GET /prescriptions/verify/{code} ────────────────
@router.get(
    "/verify/{code}",
    summary="Verificar autenticidad de una receta (para farmacias)"
)
async def verify_prescription(
    code: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Prescription).where(Prescription.qr_verify_code == code)
    )
    prescription = result.scalar_one_or_none()

    if not prescription:
        return {
            "valid": False,
            "message": "Código no encontrado. Esta receta podría ser inválida o haber sido alterada."
        }

    prof_result = await db.execute(
        select(Professional).where(Professional.id == prescription.professional_id)
    )
    professional = prof_result.scalar_one_or_none()

    if prescription.status == PrescriptionStatus.VOIDED.value:
        return {
            "valid":            False,
            "status":           "VOIDED",
            "prescription_id":  prescription.id,
            "voided_at":        prescription.voided_at.isoformat() if prescription.voided_at else None,
            "void_reason":      prescription.void_reason,
            "message":          "Esta receta fue ANULADA por el médico que la emitió y ya no es válida. "
                                 "Si el paciente presenta una receta nueva, verifica ese código en su lugar."
        }

    return {
        "valid":                  True,
        "status":                 "ACTIVE",
        "prescription_id":        prescription.id,
        "qr_code":                prescription.qr_verify_code,
        "digital_hash":           prescription.digital_hash,
        "patient_name":           prescription.patient_name,
        "patient_ci":             prescription.patient_ci,
        "patient_age":            prescription.patient_age,
        "medications":            prescription.medications,
        "instructions":           prescription.instructions,
        "signed_at":              prescription.signed_at.isoformat(),
        "professional_name":      f"Dr. {professional.first_name} {professional.last_name}" if professional else "Desconocido",
        "professional_specialty": professional.specialty if professional else "",
        "cmb_matricula":          professional.cmb_matricula if professional else "",
        "message":                "Receta válida y auténtica. Emitida por MedicBolivia."
    }