"""
app/api/v1/endpoints/consultations.py
Endpoints de consultas médicas.
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.models.models import (
    User, Patient, Professional, Consultation, Payment,
    ConsultationStatus, ConsultationType, PaymentStatus, ProfessionalStatus
)
from app.schemas.schemas import (
    ConsultationCreateRequest, ConsultationResponse,
    QRPaymentResponse, PaymentWebhookRequest
)
from app.services.payment import generate_qr_data, calculate_amounts
from app.core.config import settings

router = APIRouter()

PROFESSIONAL_TIMEOUT_MINUTES = 2   # médico tiene 2 min para aceptar
PAYMENT_TIMEOUT_MINUTES = 5        # paciente tiene 5 min para pagar


# ── Tarea background: cancelar consultas vencidas ────
async def auto_cancel_expired(consultation_id: str, db_url: str):
    """Cancela automáticamente si el médico no acepta o el paciente no paga."""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    await asyncio.sleep(PROFESSIONAL_TIMEOUT_MINUTES * 60)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        result = await db.execute(
            select(Consultation).where(Consultation.id == consultation_id)
        )
        consultation = result.scalar_one_or_none()
        if consultation and consultation.status == ConsultationStatus.WAITING_PROFESSIONAL:
            consultation.status = ConsultationStatus.CANCELLED
            await db.commit()
            logger.info(f"[AUTO-CANCEL] Consulta {consultation_id} cancelada — médico no respondió en {PROFESSIONAL_TIMEOUT_MINUTES} min")
    await engine.dispose()


async def auto_cancel_payment_expired(consultation_id: str, db_url: str):
    """Cancela si el paciente no paga en 5 minutos."""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    await asyncio.sleep(PAYMENT_TIMEOUT_MINUTES * 60)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        result = await db.execute(
            select(Consultation).where(Consultation.id == consultation_id)
        )
        consultation = result.scalar_one_or_none()
        if consultation and consultation.status == ConsultationStatus.WAITING_PAYMENT:
            consultation.status = ConsultationStatus.CANCELLED
            # Cancelar pago pendiente
            pay_result = await db.execute(
                select(Payment).where(
                    Payment.consultation_id == consultation_id,
                    Payment.status == PaymentStatus.PENDING
                )
            )
            payment = pay_result.scalar_one_or_none()
            if payment:
                payment.status = PaymentStatus.REFUNDED_FULL
            await db.commit()
            logger.info(f"[AUTO-CANCEL] Consulta {consultation_id} cancelada — paciente no pagó en {PAYMENT_TIMEOUT_MINUTES} min")
    await engine.dispose()


# ── POST /api/v1/consultations ───────────────────────
@router.post(
    "",
    response_model=ConsultationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear nueva consulta médica"
)
async def create_consultation(
    data: ConsultationCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role.value != "PATIENT":
        raise HTTPException(status_code=403, detail="Solo los pacientes pueden crear consultas")

    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    # Verificar que no haya consulta activa
    active_statuses = [
        ConsultationStatus.WAITING_PROFESSIONAL,
        ConsultationStatus.PROFESSIONAL_ACCEPTED,
        ConsultationStatus.WAITING_PAYMENT,
        ConsultationStatus.PAYMENT_CONFIRMED,
        ConsultationStatus.IN_PROGRESS,
    ]
    existing_result = await db.execute(
        select(Consultation).where(
            Consultation.patient_id == patient.id,
            Consultation.status.in_(active_statuses)
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Ya tienes una consulta activa (ID: {existing.id}). Cancélala antes de crear una nueva."
        )

    prof_result = await db.execute(
        select(Professional).where(Professional.id == data.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="El profesional no está verificado")

    amount = professional.price_general
    if data.consultation_type == ConsultationType.FOLLOW_UP:
        amount = professional.price_follow_up
    amounts = calculate_amounts(amount)

    # ── Nuevo flujo: empieza en WAITING_PROFESSIONAL ──
    consultation = Consultation(
        patient_id=patient.id,
        professional_id=professional.id,
        consultation_type=data.consultation_type,
        status=ConsultationStatus.WAITING_PROFESSIONAL,
        specialty=data.specialty or professional.specialty,
        chief_complaint=data.chief_complaint,
        scheduled_at=data.scheduled_at,
        amount=amounts["amount"],
        platform_fee=amounts["platform_fee"],
        professional_earning=amounts["professional_net"],
    )
    db.add(consultation)
    await db.flush()
    await db.commit()
    await db.refresh(consultation)

    # Auto-cancelar si el médico no responde en 2 min
    background_tasks.add_task(
        auto_cancel_expired,
        consultation.id,
        settings.DATABASE_URL
    )

    logger.info(f"Consulta creada: {consultation.id} → esperando aceptación del profesional")
    return ConsultationResponse.model_validate(consultation)


# ── POST /api/v1/consultations/{id}/accept ──────────
@router.post(
    "/{consultation_id}/accept",
    summary="Profesional acepta la consulta → paciente puede pagar"
)
async def accept_consultation(
    consultation_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verificar que es el profesional de la consulta
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden aceptar consultas")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o ya no está en espera")

    consultation.status = ConsultationStatus.WAITING_PAYMENT
    await db.commit()

    # Auto-cancelar si el paciente no paga en 5 min
    background_tasks.add_task(
        auto_cancel_payment_expired,
        consultation.id,
        settings.DATABASE_URL
    )

    logger.info(f"Consulta {consultation_id} aceptada por profesional {professional.id}")
    return {"status": "accepted", "consultation_id": consultation_id}


# ── POST /api/v1/consultations/{id}/reject ──────────
@router.post(
    "/{consultation_id}/reject",
    summary="Profesional rechaza la consulta"
)
async def reject_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden rechazar consultas")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    consultation.status = ConsultationStatus.CANCELLED
    await db.commit()

    logger.info(f"Consulta {consultation_id} rechazada por profesional {professional.id}")
    return {"status": "rejected", "consultation_id": consultation_id}


# ── POST /api/v1/consultations/{id}/payment/qr ──────
@router.post(
    "/{consultation_id}/payment/qr",
    response_model=QRPaymentResponse,
    summary="Generar QR de pago (solo después de que el médico acepte)"
)
async def generate_payment_qr(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
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
            Consultation.status.in_([
                ConsultationStatus.WAITING_PAYMENT,
                ConsultationStatus.PAYMENT_CONFIRMED,
            ])
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o el médico aún no ha aceptado")

    prof_result = await db.execute(
        select(Professional).where(Professional.id == consultation.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    prof_name = f"Dr(a). {professional.first_name} {professional.last_name}" if professional else "Profesional"

    # Reutilizar pago pendiente si existe
    existing_payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation.id,
            Payment.status == PaymentStatus.PENDING
        )
    )
    existing_payment = existing_payment_result.scalar_one_or_none()

    qr_data = generate_qr_data(
        consultation_id=consultation.id,
        amount=consultation.amount,
        professional_name=prof_name
    )

    if existing_payment:
        # Solo regenerar si el QR ya expiró
        if existing_payment.qr_expires_at and existing_payment.qr_expires_at > datetime.utcnow():
            # QR aún válido — devolver el mismo
            return QRPaymentResponse(
                payment_id=existing_payment.id,
                qr_image_url=f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={existing_payment.qr_code}&format=png",
                amount=consultation.amount,
                expires_at=existing_payment.qr_expires_at,
                consultation_id=consultation.id,
                professional_name=prof_name
            )
        # QR expirado — regenerar
        qr_data = generate_qr_data(
            consultation_id=consultation.id,
            amount=consultation.amount,
            professional_name=prof_name
        )
        existing_payment.qr_code = qr_data["qr_code"]
        existing_payment.qr_expires_at = qr_data["expires_at"]
        await db.commit()
        return QRPaymentResponse(
            payment_id=existing_payment.id,
            qr_image_url=qr_data["qr_image_url"],
            amount=consultation.amount,
            expires_at=qr_data["expires_at"],
            consultation_id=consultation.id,
            professional_name=prof_name
        )

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


# ── POST /api/v1/consultations/{id}/cancel ──────────
@router.post("/{consultation_id}/cancel", summary="Cancelar consulta (antes del pago)")
async def cancel_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
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
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    cancellable = [
        ConsultationStatus.WAITING_PROFESSIONAL,
        ConsultationStatus.WAITING_PAYMENT,
    ]
    if consultation.status not in cancellable:
        raise HTTPException(
            status_code=400,
            detail="No se puede cancelar una consulta ya pagada o en curso."
        )

    consultation.status = ConsultationStatus.CANCELLED

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()
    if payment:
        payment.status = PaymentStatus.REFUNDED_FULL

    await db.commit()
    logger.info(f"Consulta {consultation_id} cancelada por paciente")
    return {"status": "cancelled", "consultation_id": consultation_id}


# ── POST /api/v1/consultations/webhook/payment ──────
@router.post("/webhook/payment", summary="Webhook del banco: confirmar pago QR")
async def payment_webhook(data: PaymentWebhookRequest, db: AsyncSession = Depends(get_db)):
    payment_result = await db.execute(
        select(Payment).where(
            Payment.qr_code == data.qr_code,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()
    if not payment:
        return {"status": "not_found"}

    if payment.qr_expires_at and payment.qr_expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        return {"status": "expired"}

    payment.status = PaymentStatus.CONFIRMED
    payment.bank_tx_id = data.bank_tx_id
    payment.bank_name = data.bank_name
    payment.paid_at = datetime.utcnow()

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
@router.get("/my", summary="Obtener mis consultas")
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
@router.patch("/{consultation_id}/status", summary="Actualizar estado de una consulta")
async def update_consultation_status(
    consultation_id: str,
    new_status: ConsultationStatus,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
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


# ── POST /api/v1/consultations/{id}/simulate-payment ─
@router.post("/{consultation_id}/simulate-payment", summary="[DEV] Simular pago confirmado")
async def simulate_payment(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=403, detail="Solo disponible en entorno de desarrollo")

    cons_result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()

    if payment:
        payment.status = PaymentStatus.CONFIRMED
        payment.bank_tx_id = f"SIM-{consultation_id[:8].upper()}"
        payment.bank_name = "Simulación Local"
        payment.paid_at = datetime.utcnow()
    else:
        patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
        patient = patient_result.scalar_one_or_none()
        if patient:
            db.add(Payment(
                consultation_id=consultation.id,
                patient_id=patient.id,
                amount=consultation.amount,
                platform_fee=consultation.platform_fee,
                professional_net=consultation.professional_earning,
                qr_code=f"SIM-{consultation_id[:8].upper()}",
                status=PaymentStatus.CONFIRMED,
                bank_tx_id=f"SIM-{consultation_id[:8].upper()}",
                bank_name="Simulación Local",
                paid_at=datetime.utcnow(),
            ))

    consultation.status = ConsultationStatus.PAYMENT_CONFIRMED
    await db.commit()
    logger.info(f"[DEV] Pago simulado para consulta {consultation_id}")
    return {"status": "confirmed", "message": "Pago simulado correctamente"}