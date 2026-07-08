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
    summary="Calificar una consulta completada o en progreso"
)
async def create_rating(
    data: RatingCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role.value != "PATIENT":
        raise HTTPException(status_code=403, detail="Solo los pacientes pueden calificar consultas")

    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == data.consultation_id,
            Consultation.patient_id == patient.id,
            Consultation.status.in_([
                ConsultationStatus.COMPLETED,
                ConsultationStatus.IN_PROGRESS
            ])
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(
            status_code=404,
            detail="Consulta no encontrada o no está en progreso/completada"
        )

    if not consultation.professional_id:
        raise HTTPException(status_code=400, detail="La consulta no tiene profesional asignado")

    existing = await db.execute(
        select(Rating).where(Rating.consultation_id == data.consultation_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya calificaste esta consulta")

    rating = Rating(
        consultation_id=data.consultation_id,
        patient_id=patient.id,
        professional_id=consultation.professional_id,
        score=data.score,
        comment=data.comment,
    )
    db.add(rating)
    await db.flush()

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


# ── GET /api/v1/ratings/check/{consultation_id} ──────
@router.get(
    "/check/{consultation_id}",
    summary="Verificar si el paciente ya calificó una consulta"
)
async def check_rating(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Devuelve { rated: bool, rating: RatingResponse | null }"""
    existing = await db.execute(
        select(Rating).where(Rating.consultation_id == consultation_id)
    )
    rating = existing.scalar_one_or_none()
    if rating:
        return {"rated": True, "rating": RatingResponse.model_validate(rating)}
    return {"rated": False, "rating": None}


# ── GET /api/v1/ratings/my ───────────────────────────
@router.get(
    "/my",
    summary="Calificaciones recibidas por el médico logueado"
)
async def get_my_ratings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Solo para profesionales. Devuelve sus calificaciones reales."""
    if current_user.role.value != "PROFESSIONAL":
        raise HTTPException(status_code=403, detail="Solo los profesionales pueden ver sus calificaciones")

    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    result = await db.execute(
        select(Rating, Patient)
        .join(Patient, Patient.id == Rating.patient_id)
        .where(Rating.professional_id == professional.id)
        .order_by(Rating.created_at.desc())
        .limit(50)
    )
    rows = result.all()

    enriched = []
    for rating, patient in rows:
        item = RatingResponse.model_validate(rating)
        item_dict = item.model_dump()
        item_dict["patient_name"] = f"{patient.first_name} {patient.last_name}".strip() or "Paciente"
        enriched.append(item_dict)

    return {
        "ratings": enriched,
        "average": float(professional.average_rating or 0),
        "total": professional.total_ratings or 0,
    }


# ── GET /api/v1/ratings/professional/{id} ────────────
@router.get(
    "/professional/{professional_id}",
    summary="Obtener calificaciones públicas de un profesional"
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