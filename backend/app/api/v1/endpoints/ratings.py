"""
app/api/v1/endpoints/ratings.py
Calificaciones post-consulta de pacientes a profesionales.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.models.models import (
    User, Patient, Consultation, Rating, Professional,
    ConsultationStatus
)
from app.schemas.schemas import RatingCreateRequest, RatingResponse

router = APIRouter()


# ── POST /api/v1/ratings ─────────────────────────────
@router.post(
    "",
    response_model=RatingResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Calificar una consulta completada"
)
async def create_rating(
    data: RatingCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role.value != "PATIENT":
        raise HTTPException(status_code=403, detail="Solo los pacientes pueden calificar consultas")

    # Obtener paciente
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    # Verificar consulta completada
    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == data.consultation_id,
            Consultation.patient_id == patient.id,
            Consultation.status == ConsultationStatus.COMPLETED
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(
            status_code=404,
            detail="Consulta no encontrada o no está completada"
        )

    if not consultation.professional_id:
        raise HTTPException(status_code=400, detail="La consulta no tiene profesional asignado")

    # Verificar si ya calificó
    existing = await db.execute(
        select(Rating).where(Rating.consultation_id == data.consultation_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Ya calificaste esta consulta"
        )

    # Crear calificación
    rating = Rating(
        consultation_id=data.consultation_id,
        patient_id=patient.id,
        professional_id=consultation.professional_id,
        score=data.score,
        comment=data.comment,
    )
    db.add(rating)
    await db.flush()

    # Actualizar promedio del profesional
    avg_result = await db.execute(
        select(func.avg(Rating.score), func.count(Rating.id))
        .where(Rating.professional_id == consultation.professional_id)
    )
    avg_score, total = avg_result.one()

    prof_result = await db.execute(
        select(Professional).where(Professional.id == consultation.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    if professional and avg_score:
        professional.average_rating = round(float(avg_score), 2)
        professional.total_ratings = total

    await db.commit()
    await db.refresh(rating)

    logger.info(f"Calificación: consulta {data.consultation_id} → {data.score}★ por paciente {patient.id}")
    return RatingResponse.model_validate(rating)


# ── GET /api/v1/ratings/professional/{id} ────────────
@router.get(
    "/professional/{professional_id}",
    summary="Obtener calificaciones de un profesional"
)
async def get_professional_ratings(
    professional_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Rating)
        .where(Rating.professional_id == professional_id)
        .order_by(Rating.created_at.desc())
        .limit(20)
    )
    ratings = result.scalars().all()
    return [RatingResponse.model_validate(r) for r in ratings]
