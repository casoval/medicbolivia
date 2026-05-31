"""
app/api/v1/endpoints/consultations.py
Endpoints de consultas médicas.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from decimal import Decimal
from datetime import datetime
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user, get_current_professional
from app.models.models import (
    User, Patient, Professional, Consultation, Payment,
    ConsultationStatus, ConsultationType, PaymentStatus, ProfessionalStatus
)
from app.schemas.schemas import (
    ConsultationCreateRequest, ConsultationResponse,
    QRPaymentResponse, PaymentWebhookRequest
)
from app.services.payment import generate_qr_data, calculate_amounts

router = APIRouter()


# ── POST /api/v1/consultations ───────────────────────
@router.post(
    "",
    response_model=ConsultationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear nueva consulta médica"
)
async def create_consultation(
    data: ConsultationCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role.value != "PATIENT":
        raise HTTPException(status_code=403, detail="Solo los pacientes pueden crear consultas")

    # Obtener paciente
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    # Obtener profesional y verificar que está aprobado
    prof_result = await db.execute(
        select(Professional).where(Professional.id == data.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="El profesional no está verificado")

    # Calcular montos
    amount = professional.price_general
    if data.consultation_type == ConsultationType.FOLLOW_UP:
        amount = professional.price_follow_up
    amounts = calculate_amounts(amount)

    # Crear consulta
    consultation = Consultation(
        patient_id=patient.id,
        professional_id=professional.id,
        consultation_type=data.consultation_type,
        status=ConsultationStatus.WAITING_PAYMENT,
        specialty=data.specialty or professional.specialty,
        chief_complaint=data.chief_complaint,
        scheduled_at=data.scheduled_at,
        amount=amounts["amount"],
        platform_fee=amounts["platform_fee"],
        professional_earning=amounts["professional_net"],
    )
    db.add(consultation)
    await db.flush()

    logger.info(f"Consulta creada: {consultation.id} | paciente: {patient.id} | profesional: {professional.id}")
    await db.commit()
    await db.refresh(consultation)

    return ConsultationResponse.model_validate(consultation)


# ── POST /api/v1/consultations/{id}/payment/qr ──────
@router.post(
    "/{consultation_id}/payment/qr",
    response_model=QRPaymentResponse,
    summary="Generar QR de pago para una consulta"
)
async def generate_payment_qr(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verificar que la consulta existe y pertenece al paciente
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
            Consultation.status == ConsultationStatus.WAITING_PAYMENT
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o ya pagada")

    # Obtener nombre del profesional
    prof_result = await db.execute(
        select(Professional).where(Professional.id == consultation.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    prof_name = f"Dr(a). {professional.first_name} {professional.last_name}" if professional else "Profesional"

    # Generar datos QR
    qr_data = generate_qr_data(
        consultation_id=consultation.id,
        amount=consultation.amount,
        professional_name=prof_name
    )

    # Crear registro de pago
    payment = Payment(
        consultation_id=consultation.id,
        patient_id=patient.id,
        amount=consultation.amount,
        platform_fee=consultation.platform_fee,
        professional_net=consultation.professional_earning,
        qr_code=qr_data["qr_code"],
        qr_expires_at=qr_data["expires_at"],
        status=PaymentStatus.PENDING,
    )
    db.add(payment)
    await db.commit()

    return QRPaymentResponse(
        payment_id=payment.id,
        qr_image_url=qr_data["qr_image_url"],
        amount=consultation.amount,
        expires_at=qr_data["expires_at"],
        consultation_id=consultation.id,
        professional_name=prof_name
    )


# ── POST /api/v1/consultations/webhook/payment ──────
@router.post(
    "/webhook/payment",
    summary="Webhook del banco: confirmar pago QR"
)
async def payment_webhook(
    data: PaymentWebhookRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Este endpoint es llamado por el banco cuando el paciente paga el QR.
    En producción: validar el token/firma del banco antes de procesar.
    """
    # Buscar el pago por QR code
    payment_result = await db.execute(
        select(Payment).where(
            Payment.qr_code == data.qr_code,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()

    if not payment:
        logger.warning(f"Webhook: pago no encontrado para QR {data.qr_code}")
        return {"status": "not_found"}

    # Verificar que no expiró
    if payment.qr_expires_at and payment.qr_expires_at < datetime.utcnow():
        logger.warning(f"Webhook: QR expirado para pago {payment.id}")
        return {"status": "expired"}

    # Confirmar el pago
    payment.status = PaymentStatus.CONFIRMED
    payment.bank_tx_id = data.bank_tx_id
    payment.bank_name = data.bank_name
    payment.paid_at = datetime.utcnow()

    # Actualizar estado de la consulta
    cons_result = await db.execute(
        select(Consultation).where(Consultation.id == payment.consultation_id)
    )
    consultation = cons_result.scalar_one_or_none()
    if consultation:
        consultation.status = ConsultationStatus.PAYMENT_CONFIRMED

    await db.commit()

    logger.info(f"Pago confirmado: {payment.id} | {data.bank_name} | Bs. {data.amount}")
    return {"status": "confirmed", "payment_id": payment.id}


# ── GET /api/v1/consultations/my ────────────────────
@router.get(
    "/my",
    summary="Obtener mis consultas"
)
async def get_my_consultations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role.value == "PATIENT":
        patient_result = await db.execute(
            select(Patient).where(Patient.user_id == current_user.id)
        )
        patient = patient_result.scalar_one_or_none()
        if not patient:
            return []
        result = await db.execute(
            select(Consultation)
            .where(Consultation.patient_id == patient.id)
            .order_by(Consultation.created_at.desc())
        )
    else:
        prof_result = await db.execute(
            select(Professional).where(Professional.user_id == current_user.id)
        )
        professional = prof_result.scalar_one_or_none()
        if not professional:
            return []
        result = await db.execute(
            select(Consultation)
            .where(Consultation.professional_id == professional.id)
            .order_by(Consultation.created_at.desc())
        )

    consultations = result.scalars().all()
    return [ConsultationResponse.model_validate(c) for c in consultations]


# ── PATCH /api/v1/consultations/{id}/status ─────────
@router.patch(
    "/{consultation_id}/status",
    summary="Actualizar estado de una consulta"
)
async def update_consultation_status(
    consultation_id: str,
    new_status: ConsultationStatus,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Consultation).where(Consultation.id == consultation_id)
    )
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    consultation.status = new_status

    if new_status == ConsultationStatus.IN_PROGRESS:
        consultation.started_at = datetime.utcnow()
    elif new_status == ConsultationStatus.COMPLETED:
        consultation.ended_at = datetime.utcnow()
        if consultation.started_at:
            delta = datetime.utcnow() - consultation.started_at
            consultation.duration_minutes = int(delta.total_seconds() / 60)

    await db.commit()
    return {"status": new_status, "consultation_id": consultation_id}
