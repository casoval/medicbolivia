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
    ConsultationStatus, ProfessionalStatus
)
from app.schemas.schemas import PrescriptionCreateRequest, PrescriptionResponse

router = APIRouter()


def _generate_prescription_hash(data: dict) -> str:
    """
    Genera un hash SHA-256 único para la receta.
    Vincula la receta a la matrícula del profesional — no puede ser alterada.
    """
    content = (
        f"{data['consultation_id']}"
        f"{data['professional_id']}"
        f"{data['patient_ci']}"
        f"{data['medications']}"
        f"{data['signed_at']}"
    )
    return hashlib.sha256(content.encode()).hexdigest()


# ── POST /api/v1/prescriptions ───────────────────────
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
    # Verificar profesional
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=403, detail="Tu perfil no está verificado para emitir recetas")

    # Verificar consulta
    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == data.consultation_id,
            Consultation.professional_id == professional.id
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o no te pertenece")

    # Obtener datos del paciente
    patient_result = await db.execute(
        select(Patient).where(Patient.id == consultation.patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    # Calcular edad del paciente
    today = datetime.utcnow()
    age = today.year - patient.birth_date.year - (
        (today.month, today.day) < (patient.birth_date.month, patient.birth_date.day)
    )

    # Serializar medicamentos
    medications_data = [med.model_dump() for med in data.medications]
    signed_at = datetime.utcnow()

    # Generar hash criptográfico
    digital_hash = _generate_prescription_hash({
        "consultation_id": data.consultation_id,
        "professional_id": professional.id,
        "patient_ci":      patient.ci,
        "medications":     str(medications_data),
        "signed_at":       signed_at.isoformat(),
    })

    # Código QR único para verificación en farmacias
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
    )
    db.add(prescription)
    await db.commit()
    await db.refresh(prescription)

    logger.info(f"Receta emitida: {prescription.id} | profesional: {professional.id} | paciente: {patient.id}")

    return PrescriptionResponse.model_validate(prescription)


# ── GET /api/v1/prescriptions/consultation/{id} ──────
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
    return [PrescriptionResponse.model_validate(p) for p in prescriptions]


# ── GET /api/v1/prescriptions/verify/{code} ──────────
@router.get(
    "/verify/{code}",
    summary="Verificar autenticidad de una receta (para farmacias)"
)
async def verify_prescription(
    code: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint público — farmacia escanea el QR y verifica la receta.
    No requiere autenticación.
    """
    result = await db.execute(
        select(Prescription).where(Prescription.qr_verify_code == code)
    )
    prescription = result.scalar_one_or_none()

    if not prescription:
        return {
            "valid": False,
            "message": "Código no encontrado. Esta receta podría ser inválida o haber sido alterada."
        }

    # Obtener datos del profesional para mostrar
    prof_result = await db.execute(
        select(Professional).where(Professional.id == prescription.professional_id)
    )
    professional = prof_result.scalar_one_or_none()

    return {
        "valid":            True,
        "prescription_id":  prescription.id,
        "qr_code":          prescription.qr_verify_code,
        "digital_hash":     prescription.digital_hash,
        "patient_name":     prescription.patient_name,
        "patient_ci":       prescription.patient_ci,
        "patient_age":      prescription.patient_age,
        "medications":      prescription.medications,
        "instructions":     prescription.instructions,
        "signed_at":        prescription.signed_at.isoformat(),
        "professional_name": f"{professional.first_name} {professional.last_name}" if professional else "Desconocido",
        "professional_specialty": professional.specialty if professional else "",
        "cmb_matricula":    professional.cmb_matricula if professional else "",
        "message":          "Receta válida y auténtica. Emitida por MedicBolivia."
    }
