"""
app/api/v1/endpoints/faq.py
Preguntas frecuentes de la landing pública.

Resumen del flujo:
- GET /faq: catálogo público (sin auth), solo FAQs activas, ordenadas por
  audience y display_order. Usado por la página principal para pintar las
  pestañas "General / Paciente / Profesional".
- GET /faq/admin: listado completo (incl. inactivas) para el panel admin.
- POST/PUT/DELETE /faq/{id}: CRUD, solo admin. Cada acción queda en
  AuditLog, igual que el resto de operaciones administrativas.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.models.models import FAQ, User, AuditLog
from app.schemas.schemas import FAQResponse, FAQCreateRequest, FAQUpdateRequest

router = APIRouter()


# ── GET /faq — catálogo público ──────────────────────
@router.get(
    "",
    response_model=list[FAQResponse],
    summary="Listar preguntas frecuentes activas (público)"
)
async def list_faqs(
    audience: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Sin autenticación a propósito: esta lista alimenta la landing pública,
    donde entra cualquiera sin haber iniciado sesión.
    """
    query = select(FAQ).where(FAQ.is_active == True)  # noqa: E712
    if audience:
        query = query.where(FAQ.audience == audience.upper())
    query = query.order_by(FAQ.audience, FAQ.display_order, FAQ.created_at)

    result = await db.execute(query)
    return result.scalars().all()


# ── GET /faq/admin — listado completo (admin) ────────
@router.get(
    "/admin",
    response_model=list[FAQResponse],
    summary="Listar todas las FAQ, incl. inactivas (admin)"
)
async def list_faqs_admin(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FAQ).order_by(FAQ.audience, FAQ.display_order, FAQ.created_at)
    )
    return result.scalars().all()


# ── POST /faq — crear (admin) ────────────────────────
@router.post(
    "",
    response_model=FAQResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear una FAQ (admin)"
)
async def create_faq(
    data: FAQCreateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    faq = FAQ(
        question=data.question.strip(),
        answer=data.answer.strip(),
        audience=data.audience,
        display_order=data.display_order,
        is_active=data.is_active,
    )
    db.add(faq)
    await db.flush()

    db.add(AuditLog(
        user_id=current_user.id,
        action="FAQ_CREATED",
        entity_type="FAQ",
        entity_id=faq.id,
        metadata_={"question": faq.question, "audience": faq.audience},
    ))
    await db.commit()
    await db.refresh(faq)
    logger.info(f"FAQ creada: {faq.id} por admin {current_user.id}")
    return faq


# ── PUT /faq/{id} — actualizar (admin) ───────────────
@router.put(
    "/{faq_id}",
    response_model=FAQResponse,
    summary="Actualizar una FAQ (admin)"
)
async def update_faq(
    faq_id: str,
    data: FAQUpdateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FAQ).where(FAQ.id == faq_id))
    faq = result.scalar_one_or_none()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ no encontrada")

    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(faq, field, value.strip() if isinstance(value, str) else value)

    db.add(AuditLog(
        user_id=current_user.id,
        action="FAQ_UPDATED",
        entity_type="FAQ",
        entity_id=faq.id,
        metadata_={"changes": list(changes.keys())},
    ))
    await db.commit()
    await db.refresh(faq)
    return faq


# ── DELETE /faq/{id} — eliminar (admin) ──────────────
@router.delete(
    "/{faq_id}",
    summary="Eliminar una FAQ (admin)"
)
async def delete_faq(
    faq_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(FAQ).where(FAQ.id == faq_id))
    faq = result.scalar_one_or_none()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ no encontrada")

    db.add(AuditLog(
        user_id=current_user.id,
        action="FAQ_DELETED",
        entity_type="FAQ",
        entity_id=faq.id,
        metadata_={"question": faq.question},
    ))
    await db.delete(faq)
    await db.commit()
    return {"status": "deleted", "id": faq_id}
