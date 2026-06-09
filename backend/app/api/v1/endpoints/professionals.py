"""
app/api/v1/endpoints/professionals.py
Endpoints de profesionales: directorio, disponibilidad, precios, documentos.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Optional, List
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user, get_current_professional, get_current_admin
from app.models.models import (
    User, Professional, ProfessionalDoc, ProfessionalStatus,
    AvailabilityMode, DocType, DocStatus
)
from app.schemas.schemas import (
    ProfessionalPublicResponse, ProfessionalUpdateRequest,
    PriceUpdateRequest, AvailabilityUpdateRequest, DocReviewRequest
)
from app.services.storage import upload_document_to_s3

router = APIRouter()


# ── GET /api/v1/professionals ────────────────────────
@router.get(
    "",
    response_model=List[ProfessionalPublicResponse],
    summary="Directorio de profesionales disponibles"
)
async def list_professionals(
    specialty: Optional[str] = Query(None, description="Filtrar por especialidad"),
    available_now: bool = Query(False, description="Solo los disponibles ahora"),
    search: Optional[str] = Query(None, description="Buscar por nombre"),
    db: AsyncSession = Depends(get_db)
):
    conditions = [Professional.status == ProfessionalStatus.APPROVED]

    if specialty:
        from sqlalchemy import func
        conditions.append(
            func.lower(Professional.specialty).contains(specialty.lower())
        )

    if available_now:
        conditions.append(Professional.availability == AvailabilityMode.ONLINE_NOW)

    query = select(Professional).where(and_(*conditions))

    if search:
        from sqlalchemy import or_, func
        search_term = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Professional.first_name).like(search_term),
                func.lower(Professional.last_name).like(search_term),
            )
        )

    query = query.order_by(
        Professional.availability.desc(),
        Professional.average_rating.desc()
    )

    result = await db.execute(query)
    professionals = result.scalars().all()

    return [ProfessionalPublicResponse.model_validate(p) for p in professionals]


# ── PATCH /api/v1/professionals/availability ────────
# ⚠️ DEBE ir ANTES de /{professional_id} para que FastAPI no lo confunda con un ID
@router.patch(
    "/availability",
    summary="Actualizar disponibilidad del profesional"
)
async def update_availability(
    data: AvailabilityUpdateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(
            status_code=403,
            detail="Tu perfil aún no ha sido verificado. No puedes activar disponibilidad."
        )

    professional.availability = data.availability
    await db.commit()

    logger.info(f"Disponibilidad actualizada: {professional.id} → {data.availability}")
    return {"availability": data.availability, "message": "Disponibilidad actualizada"}


# ── PATCH /api/v1/professionals/prices ──────────────
# ⚠️ DEBE ir ANTES de /{professional_id}
@router.patch("/prices", summary="Actualizar precios de consulta")
async def update_prices(
    data: PriceUpdateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    if data.price_general is not None:
        professional.price_general = data.price_general
    if data.price_urgent is not None:
        professional.price_urgent = data.price_urgent
    if data.price_follow_up is not None:
        professional.price_follow_up = data.price_follow_up

    await db.commit()
    return {"message": "Precios actualizados correctamente"}


# ── POST /api/v1/professionals/documents ────────────
# ⚠️ DEBE ir ANTES de /{professional_id}
@router.post(
    "/documents",
    status_code=status.HTTP_201_CREATED,
    summary="Subir documento de verificación"
)
async def upload_document(
    doc_type: DocType = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    allowed_types = ["image/jpeg", "image/png", "application/pdf"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Solo se aceptan archivos JPG, PNG o PDF"
        )

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo no puede superar 10MB")

    result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    file_url = await upload_document_to_s3(
        file_content=content,
        file_name=file.filename,
        professional_id=professional.id,
        doc_type=doc_type.value,
        content_type=file.content_type
    )

    doc = ProfessionalDoc(
        professional_id=professional.id,
        doc_type=doc_type,
        file_url=file_url,
        status=DocStatus.PENDING,
    )
    db.add(doc)
    await db.commit()

    logger.info(f"Documento subido: {doc_type} para profesional {professional.id}")
    return {
        "message": "Documento subido exitosamente. Será revisado en 24-72 horas.",
        "doc_id": doc.id,
        "status": "PENDING"
    }


# ── GET /api/v1/professionals/me ────────────────────
# ⚠️ DEBE ir ANTES de /{professional_id}
@router.get(
    "/me",
    summary="Perfil propio del profesional autenticado"
)
async def get_my_profile(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    return {
        "availability": professional.availability,
        "price_general": professional.price_general,
        "price_urgent": professional.price_urgent,
        "price_follow_up": professional.price_follow_up,
        "status": professional.status,
    }


# ── GET /api/v1/professionals/admin/pending-docs ────
# ⚠️ DEBE ir ANTES de /{professional_id}
@router.get(
    "/admin/pending-docs",
    summary="[Admin] Documentos pendientes de revisión"
)
async def get_pending_docs(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional, ProfessionalDoc)
        .join(ProfessionalDoc, Professional.id == ProfessionalDoc.professional_id)
        .where(ProfessionalDoc.status == DocStatus.PENDING)
    )
    return result.all()


# ── GET /api/v1/professionals/{id} ──────────────────
# ⚠️ Esta ruta dinámica va AL FINAL para no capturar rutas estáticas
@router.get(
    "/{professional_id}",
    response_model=ProfessionalPublicResponse,
    summary="Perfil público de un profesional"
)
async def get_professional(
    professional_id: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(
            and_(
                Professional.id == professional_id,
                Professional.status == ProfessionalStatus.APPROVED
            )
        )
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    return ProfessionalPublicResponse.model_validate(professional)


# ── PATCH /api/v1/professionals/{id}/verify (admin) ─
@router.patch(
    "/{professional_id}/verify",
    summary="[Admin] Aprobar o rechazar un profesional"
)
async def verify_professional(
    professional_id: str,
    new_status: ProfessionalStatus,
    review_note: Optional[str] = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(Professional.id == professional_id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    professional.status = new_status

    if new_status == ProfessionalStatus.APPROVED:
        user_result = await db.execute(
            select(User).where(User.id == professional.user_id)
        )
        user = user_result.scalar_one_or_none()
        if user:
            from app.models.models import UserStatus
            user.status = UserStatus.ACTIVE

    await db.commit()
    logger.info(f"Profesional {professional_id} → {new_status} por admin {current_user.id}")

    return {"message": f"Profesional {new_status.lower()}", "professional_id": professional_id}