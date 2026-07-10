"""
app/api/v1/endpoints/patients.py
Endpoints de pacientes: perfil propio.
"""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.db.database import get_db
from app.core.dependencies import get_current_patient, get_current_professional
from app.models.models import User, Patient, Professional, Consultation, Payment, PaymentStatus
from app.schemas.schemas import PatientUpdateRequest
from app.services.storage import upload_photo_to_r2

router = APIRouter()
logger = logging.getLogger(__name__)


# ── GET /api/v1/patients/me ──────────────────────────
@router.get("/me", summary="Perfil propio del paciente autenticado")
async def get_my_profile(
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    return {
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "ci": patient.ci,
        "birth_date": patient.birth_date.isoformat() if patient.birth_date else None,
        "department": patient.department,
        "gender": patient.gender,
        "email": current_user.email,
        "phone": current_user.phone,
        "photo_url": patient.photo_url,
        "allergies": patient.allergies,
        "chronic_conditions": patient.chronic_conditions,
        "current_medications": patient.current_medications,
    }


# ── POST /api/v1/patients/photo ──────────────────────
# El paciente puede subir (o reemplazar) su foto de perfil, igual que el
# profesional. Es opcional: si no la carga, se sigue mostrando el ícono
# de silueta por defecto en el dashboard.
@router.post("/photo", summary="Subir o actualizar foto de perfil del paciente")
async def upload_patient_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    allowed_types = ["image/jpeg", "image/png", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Solo se aceptan imágenes JPG, PNG o WebP"
        )

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La foto no puede superar 5MB")

    result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    photo_url = await upload_photo_to_r2(
        file_content=content,
        file_name=file.filename or "photo.jpg",
        professional_id=str(patient.id),
        content_type=file.content_type,
    )

    patient.photo_url = photo_url
    await db.commit()

    logger.info(f"Foto de perfil actualizada: paciente {patient.id}")
    return {"photo_url": photo_url, "message": "Foto de perfil actualizada correctamente"}


# ── PATCH /api/v1/patients/me ────────────────────────
# El paciente llena/actualiza su propio historial médico básico (alergias,
# condiciones crónicas, medicación actual). El admin lo ve de solo lectura
# en su panel, así que este es el único lugar donde realmente se llena.
@router.patch("/me", summary="Actualizar datos médicos propios del paciente")
async def update_my_profile(
    data: PatientUpdateRequest,
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    if data.allergies is not None:
        patient.allergies = data.allergies
    if data.chronic_conditions is not None:
        patient.chronic_conditions = data.chronic_conditions
    if data.current_medications is not None:
        patient.current_medications = data.current_medications
    if data.department is not None:
        patient.department = data.department

    await db.commit()
    await db.refresh(patient)

    return {
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "ci": patient.ci,
        "birth_date": patient.birth_date.isoformat() if patient.birth_date else None,
        "department": patient.department,
        "gender": patient.gender,
        "email": current_user.email,
        "phone": current_user.phone,
        "photo_url": patient.photo_url,
        "allergies": patient.allergies,
        "chronic_conditions": patient.chronic_conditions,
        "current_medications": patient.current_medications,
    }


# ── GET /api/v1/patients/{patient_id}/medical-info ───
# El profesional necesita ver esto ADEMÁS de su propia historia clínica:
# alergias, condiciones crónicas y medicación actual que el paciente
# cargó en su perfil. Solo puede verlo si ya tuvo (o tiene) alguna
# consulta con ese paciente — no cualquier profesional puede consultar
# los datos médicos de cualquier paciente por ID.
@router.get("/{patient_id}/medical-info", summary="[Profesional] Datos médicos básicos de un paciente propio")
async def get_patient_medical_info(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Perfil de profesional no encontrado")

    has_relation = await db.execute(
        select(Consultation.id).where(
            Consultation.professional_id == professional.id,
            Consultation.patient_id == patient_id,
        ).limit(1)
    )
    if not has_relation.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="No tienes consultas con este paciente")

    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    return {
        "allergies": patient.allergies or [],
        "chronic_conditions": patient.chronic_conditions or [],
        "current_medications": patient.current_medications or [],
    }


# ── GET /api/v1/patients/me/payments ─────────────────
# Historial de pagos del paciente: qué pagó, cuándo, por qué consulta y en
# qué estado está cada pago (pendiente, confirmado, liberado al profesional,
# reembolsado, en disputa). Incluye un bloque de estadísticas para que el
# paciente entienda de un vistazo cuánto ha gastado en total sin tener que
# sumar cada fila manualmente.
@router.get("/me/payments", summary="Historial y estadísticas de mis pagos")
async def get_my_payments(
    limit: int = Query(100, le=200),
    offset: int = Query(0, ge=0),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    # ── Estadísticas (sobre TODOS los pagos del paciente, sin paginar) ──
    all_result = await db.execute(
        select(Payment, Consultation, Professional)
        .join(Consultation, Payment.consultation_id == Consultation.id, isouter=True)
        .join(Professional, Consultation.professional_id == Professional.id, isouter=True)
        .where(Payment.patient_id == patient.id)
        .order_by(Payment.created_at.desc())
    )
    all_rows = all_result.all()

    total_pagado = 0.0        # Dinero que efectivamente salió de su bolsillo y no volvió
    total_pendiente = 0.0     # QR generado, esperando que pague o se confirme
    total_reembolsado = 0.0   # Le devolvieron el dinero
    total_en_disputa = 0.0    # Congelado mientras el admin resuelve un reclamo
    consultas_pagadas = 0

    for p, c, prof in all_rows:
        amount = float(p.amount)
        if p.status in (PaymentStatus.CONFIRMED, PaymentStatus.RELEASED_TO_PROFESSIONAL):
            total_pagado += amount
            consultas_pagadas += 1
        elif p.status == PaymentStatus.PENDING:
            total_pendiente += amount
        elif p.status in (PaymentStatus.REFUNDED_FULL, PaymentStatus.REFUNDED_PARTIAL):
            refunded = float(p.refunded_amount) if p.refunded_amount is not None else amount
            total_reembolsado += refunded
            # Lo que sí quedó cobrado (monto original menos lo reembolsado) cuenta como pagado
            total_pagado += max(amount - refunded, 0.0)
            if amount - refunded > 0:
                consultas_pagadas += 1
        elif p.status == PaymentStatus.DISPUTED:
            total_en_disputa += amount

    stats = {
        "total_pagado": round(total_pagado, 2),
        "total_pendiente": round(total_pendiente, 2),
        "total_reembolsado": round(total_reembolsado, 2),
        "total_en_disputa": round(total_en_disputa, 2),
        "consultas_pagadas": consultas_pagadas,
        "cantidad_pagos": len(all_rows),
    }

    # ── Listado paginado (con filtro opcional de estado) ────────────────
    query = (
        select(Payment, Consultation, Professional)
        .join(Consultation, Payment.consultation_id == Consultation.id, isouter=True)
        .join(Professional, Consultation.professional_id == Professional.id, isouter=True)
        .where(Payment.patient_id == patient.id)
    )
    if status_filter:
        query = query.where(Payment.status == status_filter)
    query = query.order_by(Payment.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    rows = result.all()

    items = [
        {
            "id": p.id,
            "consultation_id": p.consultation_id,
            "amount": float(p.amount),
            "platform_fee": float(p.platform_fee),
            "professional_net": float(p.professional_net),
            "status": p.status,
            "bank_name": p.bank_name,
            "bank_tx_id": p.bank_tx_id,
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "created_at": p.created_at.isoformat(),
            "released_at": p.released_at.isoformat() if p.released_at else None,
            "refunded_at": p.refunded_at.isoformat() if p.refunded_at else None,
            "refunded_amount": float(p.refunded_amount) if p.refunded_amount is not None else None,
            "refund_note": p.refund_note,
            "disputed_at": p.disputed_at.isoformat() if p.disputed_at else None,
            "dispute_category": p.dispute_category,
            "dispute_reason": p.dispute_reason,
            "resolution_note": p.resolution_note,
            "professional_id": prof.id if prof else None,
            "professional_first_name": prof.first_name if prof else None,
            "professional_last_name": prof.last_name if prof else None,
            "professional_photo_url": prof.photo_url if prof else None,
            "specialty": c.specialty if c else None,
            "consultation_type": c.consultation_type if c else None,
            "consultation_status": c.status if c else None,
            "scheduled_at": c.scheduled_at.isoformat() if c and c.scheduled_at else None,
            "outcome_note": c.outcome_note if c else None,
        }
        for p, c, prof in rows
    ]

    return {"stats": stats, "items": items}