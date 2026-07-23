"""
app/api/v1/endpoints/specialties.py
Catálogo de especialidades/subespecialidades + flujo de propuestas.

Resumen del flujo:
- GET /specialties y /specialties/{id}/sub-specialties: catálogo público,
  usado para poblar los selectores del registro/edición de perfil.
- POST /specialties/proposals: un profesional propone una especialidad o
  subespecialidad que no encontró en el catálogo. Queda PENDING.
  - Si propone una SPECIALTY nueva, su Professional.status se fuerza a
    UNDER_REVIEW (igual que un profesional sin verificar): no aparece en
    búsquedas hasta que el admin apruebe o corrija.
  - Si propone una SUB_SPECIALTY nueva, no se toca el status del
    profesional — solo esa subespecialidad queda sin mostrarse hasta
    aprobarse.
- GET/PATCH /specialties/proposals (admin): listar y resolver propuestas.
  Aprobar una propuesta la vuelca al catálogo real (Specialty/SubSpecialty)
  y, si era de tipo SPECIALTY, libera el status del profesional para que
  pueda quedar APPROVED si sus documentos también están en regla.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from app.core.timezone import utcnow_naive
from pydantic import BaseModel
import uuid
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_professional, get_current_admin
from app.models.models import (
    User, Professional, ProfessionalStatus,
    Specialty, SubSpecialty,
    SpecialtyProposal, ProposalType, ProposalStatus,
    AuditLog, Notification,
)
from app.schemas.schemas import (
    SpecialtyResponse, SubSpecialtyResponse,
    ProposalCreateRequest, ProposalReviewRequest, ProposalResponse,
)

router = APIRouter()


# ── Helpers internos ──────────────────────────────────
async def _get_professional_or_404(db: AsyncSession, user_id: str) -> Professional:
    result = await db.execute(select(Professional).where(Professional.user_id == user_id))
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil de profesional no encontrado")
    return professional


def _serialize_proposal(p: SpecialtyProposal, extra: Optional[dict] = None) -> dict:
    base = {
        "id": p.id,
        "professional_id": p.professional_id,
        "type": p.type,
        "proposed_name": p.proposed_name,
        "parent_specialty_id": p.parent_specialty_id,
        "parent_specialty_name": p.parent_specialty.name if p.parent_specialty else None,
        "parent_proposal_id": p.parent_proposal_id,
        "status": p.status,
        "admin_note": p.admin_note,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "reviewed_at": p.reviewed_at.isoformat() if p.reviewed_at else None,
    }
    if extra:
        base.update(extra)
    return base


# ── Schemas para administración del catálogo ──────────
class SpecialtyCreateRequest(BaseModel):
    name: str


class SpecialtyUpdateRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class SubSpecialtyCreateRequest(BaseModel):
    name: str


class SubSpecialtyUpdateRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


def _serialize_specialty_with_subs(s: Specialty) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "is_active": s.is_active,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "sub_specialties": [
            {
                "id": sub.id,
                "name": sub.name,
                "is_active": sub.is_active,
                "specialty_id": sub.specialty_id,
                "created_at": sub.created_at.isoformat() if sub.created_at else None,
            }
            for sub in (s.sub_specialties or [])
        ],
    }


# ── ADMIN: catálogo completo (incluye inactivas) ──────
@router.get(
    "/admin/catalog",
    summary="[Admin] Listar catálogo completo de especialidades y subespecialidades (incluye inactivas)",
)
async def admin_list_catalog(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Specialty)
        .options(selectinload(Specialty.sub_specialties))
        .order_by(Specialty.name)
    )
    specialties = result.scalars().all()
    return [_serialize_specialty_with_subs(s) for s in specialties]


# ── ADMIN: crear especialidad ──────────────────────────
@router.post("/admin/catalog", summary="[Admin] Crear una especialidad nueva en el catálogo")
async def admin_create_specialty(
    data: SpecialtyCreateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")

    existing = await db.execute(select(Specialty).where(Specialty.name == name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya existe una especialidad con ese nombre")

    specialty = Specialty(id=str(uuid.uuid4()), name=name, is_active=True)
    db.add(specialty)

    db.add(AuditLog(
        user_id=current_user.id,
        action="SPECIALTY_CREATED",
        entity_type="Specialty",
        entity_id=specialty.id,
        metadata_={"name": name},
    ))

    await db.commit()
    await db.refresh(specialty, attribute_names=["sub_specialties"])
    logger.info(f"Especialidad creada por admin: {name}")
    return _serialize_specialty_with_subs(specialty)


# ── ADMIN: editar / activar / desactivar especialidad ──
@router.patch("/admin/catalog/{specialty_id}", summary="[Admin] Editar nombre o activar/desactivar una especialidad")
async def admin_update_specialty(
    specialty_id: str,
    data: SpecialtyUpdateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Specialty).options(selectinload(Specialty.sub_specialties)).where(Specialty.id == specialty_id)
    )
    specialty = result.scalar_one_or_none()
    if not specialty:
        raise HTTPException(status_code=404, detail="Especialidad no encontrada")

    changes = {}
    if data.name is not None:
        new_name = data.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        if new_name != specialty.name:
            dup = await db.execute(select(Specialty).where(Specialty.name == new_name))
            if dup.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Ya existe una especialidad con ese nombre")
            changes["name"] = {"old": specialty.name, "new": new_name}
            specialty.name = new_name

    if data.is_active is not None and data.is_active != specialty.is_active:
        changes["is_active"] = {"old": specialty.is_active, "new": data.is_active}
        specialty.is_active = data.is_active

    if changes:
        db.add(AuditLog(
            user_id=current_user.id,
            action="SPECIALTY_UPDATED",
            entity_type="Specialty",
            entity_id=specialty.id,
            metadata_=changes,
        ))
        await db.commit()
        await db.refresh(specialty, attribute_names=["sub_specialties"])

    return _serialize_specialty_with_subs(specialty)


# ── ADMIN: crear subespecialidad ───────────────────────
@router.post(
    "/admin/catalog/{specialty_id}/sub-specialties",
    summary="[Admin] Crear una subespecialidad nueva bajo una especialidad",
)
async def admin_create_sub_specialty(
    specialty_id: str,
    data: SubSpecialtyCreateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    specialty_result = await db.execute(select(Specialty).where(Specialty.id == specialty_id))
    specialty = specialty_result.scalar_one_or_none()
    if not specialty:
        raise HTTPException(status_code=404, detail="Especialidad no encontrada")

    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")

    existing = await db.execute(
        select(SubSpecialty).where(SubSpecialty.specialty_id == specialty_id, SubSpecialty.name == name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Ya existe esa subespecialidad en esta especialidad")

    sub = SubSpecialty(id=str(uuid.uuid4()), specialty_id=specialty_id, name=name, is_active=True)
    db.add(sub)

    db.add(AuditLog(
        user_id=current_user.id,
        action="SUB_SPECIALTY_CREATED",
        entity_type="SubSpecialty",
        entity_id=sub.id,
        metadata_={"name": name, "specialty_id": specialty_id},
    ))

    await db.commit()
    await db.refresh(sub)
    logger.info(f"Subespecialidad creada por admin: {name} (de {specialty.name})")
    return {
        "id": sub.id, "name": sub.name, "is_active": sub.is_active,
        "specialty_id": sub.specialty_id,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


# ── ADMIN: editar / activar / desactivar subespecialidad ──
@router.patch(
    "/admin/catalog/sub-specialties/{sub_id}",
    summary="[Admin] Editar nombre o activar/desactivar una subespecialidad",
)
async def admin_update_sub_specialty(
    sub_id: str,
    data: SubSpecialtyUpdateRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(SubSpecialty).where(SubSpecialty.id == sub_id))
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subespecialidad no encontrada")

    changes = {}
    if data.name is not None:
        new_name = data.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        if new_name != sub.name:
            dup = await db.execute(
                select(SubSpecialty).where(
                    SubSpecialty.specialty_id == sub.specialty_id, SubSpecialty.name == new_name
                )
            )
            if dup.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Ya existe esa subespecialidad en esta especialidad")
            changes["name"] = {"old": sub.name, "new": new_name}
            sub.name = new_name

    if data.is_active is not None and data.is_active != sub.is_active:
        changes["is_active"] = {"old": sub.is_active, "new": data.is_active}
        sub.is_active = data.is_active

    if changes:
        db.add(AuditLog(
            user_id=current_user.id,
            action="SUB_SPECIALTY_UPDATED",
            entity_type="SubSpecialty",
            entity_id=sub.id,
            metadata_=changes,
        ))
        await db.commit()
        await db.refresh(sub)

    return {
        "id": sub.id, "name": sub.name, "is_active": sub.is_active,
        "specialty_id": sub.specialty_id,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


# ── GET /specialties — catálogo público ───────────────
@router.get("", response_model=list[SpecialtyResponse], summary="Listar especialidades activas del catálogo")
async def list_specialties(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Specialty).where(Specialty.is_active == True).order_by(Specialty.name)
    )
    return result.scalars().all()


# ── GET /specialties/{id}/sub-specialties ─────────────
@router.get(
    "/{specialty_id}/sub-specialties",
    response_model=list[SubSpecialtyResponse],
    summary="Listar subespecialidades activas de una especialidad",
)
async def list_sub_specialties(specialty_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SubSpecialty)
        .where(SubSpecialty.specialty_id == specialty_id, SubSpecialty.is_active == True)
        .order_by(SubSpecialty.name)
    )
    return result.scalars().all()


# ── POST /specialties/proposals — crear propuesta ─────
@router.post("/proposals", summary="Proponer una especialidad o subespecialidad nueva")
async def create_proposal(
    data: ProposalCreateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    professional = await _get_professional_or_404(db, current_user.id)

    proposal = SpecialtyProposal(
        professional_id=professional.id,
        type=data.type,
        proposed_name=data.proposed_name,
        parent_specialty_id=data.parent_specialty_id if data.type == ProposalType.SUB_SPECIALTY else None,
        parent_proposal_id=data.parent_proposal_id if data.type == ProposalType.SUB_SPECIALTY else None,
        status=ProposalStatus.PENDING,
    )
    db.add(proposal)

    # Solo una propuesta de especialidad PRINCIPAL bloquea el status del
    # profesional. Una subespecialidad nueva no afecta su visibilidad.
    if data.type == ProposalType.SPECIALTY and professional.status == ProfessionalStatus.APPROVED:
        professional.status = ProfessionalStatus.UNDER_REVIEW

    await db.commit()
    await db.refresh(proposal)

    log = AuditLog(
        user_id=current_user.id,
        action="SPECIALTY_PROPOSAL_CREATED",
        entity_type="SpecialtyProposal",
        entity_id=proposal.id,
        metadata_={"type": data.type.value, "proposed_name": data.proposed_name},
    )
    db.add(log)
    await db.commit()

    logger.info(f"Propuesta de especialidad creada: {proposal.id} por profesional {professional.id}")
    return {
        "message": "Propuesta enviada. Un administrador la revisará pronto.",
        "proposal": _serialize_proposal(proposal),
    }


# ── GET /specialties/proposals — listar (admin) ───────
@router.get("/proposals", summary="[Admin] Listar propuestas de especialidad/subespecialidad")
async def list_proposals(
    status_filter: Optional[str] = Query(None),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(SpecialtyProposal).options(selectinload(SpecialtyProposal.parent_specialty))
    if status_filter:
        query = query.where(SpecialtyProposal.status == status_filter)
    else:
        query = query.where(SpecialtyProposal.status == ProposalStatus.PENDING)
    query = query.order_by(SpecialtyProposal.created_at.asc())

    result = await db.execute(query)
    proposals = result.scalars().all()

    serialized = []
    for p in proposals:
        extra = {}
        # Si depende de otra propuesta de especialidad, avisamos si esa
        # ya fue resuelta o sigue pendiente — así el admin sabe el orden.
        if p.parent_proposal_id:
            parent_result = await db.execute(
                select(SpecialtyProposal).where(SpecialtyProposal.id == p.parent_proposal_id)
            )
            parent = parent_result.scalar_one_or_none()
            extra["depends_on_pending_specialty"] = bool(parent and parent.status == ProposalStatus.PENDING)
            extra["parent_proposal_name"] = parent.proposed_name if parent else None
        serialized.append(_serialize_proposal(p, extra))

    return serialized


# ── PATCH /specialties/proposals/{id} — resolver (admin) ──
@router.patch("/proposals/{proposal_id}", summary="[Admin] Aprobar, corregir o rechazar una propuesta")
async def review_proposal(
    proposal_id: str,
    data: ProposalReviewRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SpecialtyProposal).where(SpecialtyProposal.id == proposal_id)
    )
    proposal = result.scalar_one_or_none()
    if not proposal:
        raise HTTPException(status_code=404, detail="Propuesta no encontrada")
    if proposal.status != ProposalStatus.PENDING:
        raise HTTPException(status_code=400, detail="Esta propuesta ya fue resuelta")

    # Si es subespecialidad y depende de otra propuesta de especialidad
    # todavía pendiente, no se puede aprobar hasta resolver esa primero.
    if data.decision == "APPROVE" and proposal.parent_proposal_id:
        parent_result = await db.execute(
            select(SpecialtyProposal).where(SpecialtyProposal.id == proposal.parent_proposal_id)
        )
        parent = parent_result.scalar_one_or_none()
        if parent and parent.status == ProposalStatus.PENDING:
            raise HTTPException(
                status_code=400,
                detail=f"Resuelve primero la propuesta de especialidad '{parent.proposed_name}'"
            )

    proposal.admin_note = data.admin_note
    proposal.reviewed_by = current_user.id
    proposal.reviewed_at = utcnow_naive()

    professional_result = await db.execute(
        select(Professional).where(Professional.id == proposal.professional_id)
    )
    professional = professional_result.scalar_one_or_none()

    if data.decision == "REJECT":
        proposal.status = ProposalStatus.REJECTED
        log = AuditLog(
            user_id=current_user.id,
            action="SPECIALTY_PROPOSAL_REJECTED",
            entity_type="SpecialtyProposal",
            entity_id=proposal.id,
            metadata_={"admin_note": data.admin_note},
        )
        db.add(log)

        if professional:
            type_label = "especialidad" if proposal.type == ProposalType.SPECIALTY else "subespecialidad"
            db.add(Notification(
                user_id=professional.user_id,
                title=f"Propuesta de {type_label} rechazada",
                body=(
                    f"Tu propuesta '{proposal.proposed_name}' fue rechazada. "
                    f"Motivo: {data.admin_note or 'sin especificar'}. "
                    "Puedes elegir una especialidad del catálogo o enviar una nueva propuesta."
                ),
                type="SPECIALTY_PROPOSAL_REJECTED",
                entity_type="SpecialtyProposal",
                entity_id=proposal.id,
            ))

        await db.commit()
        await db.refresh(proposal)
        logger.info(f"Propuesta rechazada: {proposal.id} por admin {current_user.id}")
        return {"message": "Propuesta rechazada.", "proposal": _serialize_proposal(proposal)}

    # decision == "APPROVE"
    final_name = (data.final_name or proposal.proposed_name).strip()

    if proposal.type == ProposalType.SPECIALTY:
        existing = await db.execute(select(Specialty).where(Specialty.name == final_name))
        specialty = existing.scalar_one_or_none()
        if not specialty:
            specialty = Specialty(name=final_name, is_active=True)
            db.add(specialty)
            await db.flush()

        if professional:
            professional.specialty = final_name
            if professional.status == ProfessionalStatus.UNDER_REVIEW:
                professional.status = ProfessionalStatus.APPROVED

    else:  # SUB_SPECIALTY
        parent_specialty_id = proposal.parent_specialty_id
        if not parent_specialty_id and proposal.parent_proposal_id:
            parent_result = await db.execute(
                select(SpecialtyProposal).where(SpecialtyProposal.id == proposal.parent_proposal_id)
            )
            parent_proposal = parent_result.scalar_one_or_none()
            if parent_proposal and parent_proposal.status == ProposalStatus.APPROVED:
                parent_specialty_result = await db.execute(
                    select(Specialty).where(Specialty.name == parent_proposal.proposed_name)
                )
                parent_specialty_obj = parent_specialty_result.scalar_one_or_none()
                parent_specialty_id = parent_specialty_obj.id if parent_specialty_obj else None

        if not parent_specialty_id:
            raise HTTPException(
                status_code=400,
                detail="No se pudo determinar la especialidad padre. Resuelve esa propuesta primero."
            )

        existing_sub = await db.execute(
            select(SubSpecialty).where(
                SubSpecialty.specialty_id == parent_specialty_id,
                SubSpecialty.name == final_name,
            )
        )
        sub = existing_sub.scalar_one_or_none()
        if not sub:
            sub = SubSpecialty(specialty_id=parent_specialty_id, name=final_name, is_active=True)
            db.add(sub)

        if professional:
            current_subs = list(professional.sub_specialties or [])
            if final_name not in current_subs:
                current_subs.append(final_name)
            professional.sub_specialties = current_subs

    proposal.status = ProposalStatus.APPROVED

    log = AuditLog(
        user_id=current_user.id,
        action="SPECIALTY_PROPOSAL_APPROVED",
        entity_type="SpecialtyProposal",
        entity_id=proposal.id,
        metadata_={"final_name": final_name, "type": proposal.type.value},
    )
    db.add(log)

    if professional:
        type_label = "especialidad" if proposal.type == ProposalType.SPECIALTY else "subespecialidad"
        extra_note = ""
        if proposal.type == ProposalType.SPECIALTY:
            extra_note = " Tu perfil ya está visible nuevamente para los pacientes."
        db.add(Notification(
            user_id=professional.user_id,
            title=f"Propuesta de {type_label} aprobada",
            body=(
                f"Tu propuesta '{proposal.proposed_name}' fue aprobada"
                + (f" como '{final_name}'" if final_name != proposal.proposed_name else "")
                + f".{extra_note}"
            ),
            type="SPECIALTY_PROPOSAL_APPROVED",
            entity_type="SpecialtyProposal",
            entity_id=proposal.id,
        ))

    await db.commit()
    await db.refresh(proposal)

    logger.info(f"Propuesta aprobada: {proposal.id} → '{final_name}' por admin {current_user.id}")
    return {"message": "Propuesta aprobada.", "proposal": _serialize_proposal(proposal)}