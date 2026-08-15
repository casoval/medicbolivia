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
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import Optional
from app.core.timezone import utcnow_naive
from pydantic import BaseModel, Field
import uuid
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_professional, get_current_admin
from app.services.notify import notify_user
from app.services.professional_approval import check_and_approve_professional
from app.models.models import (
    User, UserRole, Professional, ProfessionalStatus, DocStatus,
    Specialty, SubSpecialty,
    SpecialtyProposal, ProposalType, ProposalStatus,
    AuditLog, Notification,
)
from app.schemas.schemas import (
    SpecialtyResponse, SubSpecialtyResponse,
    ProposalCreateRequest, ProposalReviewRequest, ProposalResponse,
)


async def _notify_all_admins(db: AsyncSession, title: str, body: str, type_: str, entity_id: str) -> None:
    """Avisa a TODOS los admins que hay una especialidad/subespecialidad
    esperando revisión — mismo patrón que _notify_admins_new_review() en
    professionals.py, reimplementado acá para no crear un import cruzado
    entre módulos de endpoints."""
    admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
    for admin in admins_result.scalars().all():
        await notify_user(
            db, user_id=admin.id,
            title=title, body=body, type_=type_,
            entity_type="Professional", entity_id=entity_id,
            send_whatsapp=False,
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
        "final_name": p.final_name,
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

    # Solo se permite UNA especialidad y UNA subespecialidad por
    # profesional — si ya tenía una subespecialidad distinta, esta
    # propuesta la reemplaza (no se acumulan varias).
    if data.type == ProposalType.SUB_SPECIALTY and not professional.specialty:
        raise HTTPException(status_code=400, detail="Primero necesitas tener una especialidad para poder agregar una subespecialidad")

    proposed_name_clean = data.proposed_name.strip()
    if not proposed_name_clean:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")

    # ── Resolución server-side de la especialidad padre ─────────────
    # El frontend NUNCA manda parent_specialty_id ni parent_proposal_id
    # cuando el profesional usa "no está en la lista" para subespecialidad
    # (ver saveSubSpecialty en professional/profile/page.tsx) — solo manda
    # proposed_name. Si confiáramos en data.parent_specialty_id, esta
    # propuesta quedaría sin padre y sería imposible de aprobar más
    # adelante (review_proposal exige uno de los dos). Por eso lo resolvemos
    # acá mismo, a partir del valor real que ya tiene el profesional en
    # professional.specialty (que a esta altura sabemos que existe, por el
    # chequeo de arriba):
    #   1) si ya es una especialidad real del catálogo -> parent_specialty_id
    #   2) si todavía es solo una propuesta pendiente del mismo profesional
    #      -> parent_proposal_id
    # Preferimos lo resuelto acá sobre lo que mande el cliente porque el
    # cliente no tiene forma confiable de saber cuál es el registro final
    # (podría estar desactualizado o directamente no mandarlo, como hoy).
    resolved_parent_specialty_id: Optional[str] = None
    resolved_parent_proposal_id: Optional[str] = None
    if data.type == ProposalType.SUB_SPECIALTY:
        parent_specialty_result = await db.execute(
            select(Specialty).where(
                func.lower(Specialty.name) == professional.specialty.strip().lower(),
                Specialty.is_active == True,
            )
        )
        parent_specialty_obj = parent_specialty_result.scalar_one_or_none()
        if parent_specialty_obj:
            resolved_parent_specialty_id = parent_specialty_obj.id
        else:
            parent_proposal_result = await db.execute(
                select(SpecialtyProposal).where(
                    SpecialtyProposal.professional_id == professional.id,
                    SpecialtyProposal.type == ProposalType.SPECIALTY,
                    SpecialtyProposal.status == ProposalStatus.PENDING,
                    func.lower(SpecialtyProposal.proposed_name) == professional.specialty.strip().lower(),
                )
            )
            parent_proposal_obj = parent_proposal_result.scalar_one_or_none()
            if parent_proposal_obj:
                resolved_parent_proposal_id = parent_proposal_obj.id
        # Caso borde: si professional.specialty no coincide con ningún
        # Specialty activo ni con ninguna propuesta PENDING del propio
        # profesional (ej. la propuesta de especialidad ya fue rechazada
        # pero el campo todavía no se limpió, o quedó en un estado raro),
        # no dejamos crear una subespecialidad que después nadie podría
        # aprobar — mejor fallar acá con un mensaje claro.
        if not resolved_parent_specialty_id and not resolved_parent_proposal_id:
            raise HTTPException(
                status_code=400,
                detail="No se pudo vincular la subespecialidad a tu especialidad actual. "
                       "Vuelve a guardar tu especialidad e intenta de nuevo.",
            )

    # ── Guard anti-duplicados ──────────────────────────────────────
    # Antes de crear una propuesta (pensada solo para lo que NO está en
    # el catálogo), nos fijamos si el nombre ya existe ahí — comparación
    # case-insensitive porque "cardiología" y "Cardiología" son la misma
    # especialidad para un humano aunque no para un string exacto. Si ya
    # existe, tratamos esto como si el profesional hubiera usado
    # /specialties/select (mismo resultado: PENDING de confirmación, SIN
    # generar una fila nueva en specialty_proposals ni marcar el badge
    # "Nuevo en catálogo" para el admin, que sería engañoso). Esto evita
    # el caso real detectado: alguien elige "No está en la lista" por
    # error y tipea a mano un nombre que ya existía.
    if data.type == ProposalType.SPECIALTY:
        dup_result = await db.execute(
            select(Specialty).where(
                func.lower(Specialty.name) == proposed_name_clean.lower(),
                Specialty.is_active == True,
            )
        )
        existing_specialty = dup_result.scalar_one_or_none()
        if existing_specialty:
            professional.specialty = existing_specialty.name
            professional.specialty_status = DocStatus.PENDING
            professional.specialty_review_note = None
            if professional.status == ProfessionalStatus.APPROVED:
                professional.status = ProfessionalStatus.UNDER_REVIEW

            db.add(AuditLog(
                user_id=current_user.id,
                action="SPECIALTY_SELECTED_FROM_CATALOG",
                entity_type="Professional",
                entity_id=professional.id,
                metadata_={
                    "type": data.type.value,
                    "catalog_id": existing_specialty.id,
                    "note": "Redirigido desde /proposals: el nombre propuesto ya existía en el catálogo",
                },
            ))
            await _notify_all_admins(
                db,
                title="Especialidad para confirmar",
                body=f"{professional.first_name} {professional.last_name} eligió '{existing_specialty.name}' del catálogo — pendiente de confirmación.",
                type_="SPECIALTY_CATALOG_PICK",
                entity_id=professional.id,
            )
            await db.commit()
            logger.info(f"Propuesta redirigida a catálogo existente: '{proposed_name_clean}' -> {existing_specialty.id} (profesional {professional.id})")
            return {
                "message": f"'{existing_specialty.name}' ya está en el catálogo — se guardó como selección directa, pendiente de confirmación de un administrador.",
                "proposal": None,
            }
    else:  # SUB_SPECIALTY — solo se puede chequear contra el catálogo si
        # la especialidad padre YA es real (resolved_parent_specialty_id).
        # Si el padre es a su vez otra propuesta pendiente
        # (resolved_parent_proposal_id), no hay nada en el catálogo
        # todavía contra qué comparar.
        if resolved_parent_specialty_id:
            dup_result = await db.execute(
                select(SubSpecialty).where(
                    SubSpecialty.specialty_id == resolved_parent_specialty_id,
                    func.lower(SubSpecialty.name) == proposed_name_clean.lower(),
                    SubSpecialty.is_active == True,
                )
            )
            existing_sub = dup_result.scalar_one_or_none()
            if existing_sub:
                professional.sub_specialty = existing_sub.name
                professional.sub_specialty_status = DocStatus.PENDING
                professional.sub_specialty_review_note = None

                db.add(AuditLog(
                    user_id=current_user.id,
                    action="SPECIALTY_SELECTED_FROM_CATALOG",
                    entity_type="Professional",
                    entity_id=professional.id,
                    metadata_={
                        "type": data.type.value,
                        "catalog_id": existing_sub.id,
                        "note": "Redirigido desde /proposals: el nombre propuesto ya existía en el catálogo",
                    },
                ))
                await _notify_all_admins(
                    db,
                    title="Subespecialidad para confirmar",
                    body=f"{professional.first_name} {professional.last_name} eligió '{existing_sub.name}' del catálogo — pendiente de confirmación.",
                    type_="SPECIALTY_CATALOG_PICK",
                    entity_id=professional.id,
                )
                await db.commit()
                logger.info(f"Propuesta redirigida a catálogo existente: '{proposed_name_clean}' -> {existing_sub.id} (profesional {professional.id})")
                return {
                    "message": f"'{existing_sub.name}' ya está en el catálogo — se guardó como selección directa, pendiente de confirmación de un administrador.",
                    "proposal": None,
                }

    proposal = SpecialtyProposal(
        professional_id=professional.id,
        type=data.type,
        proposed_name=proposed_name_clean,
        parent_specialty_id=resolved_parent_specialty_id if data.type == ProposalType.SUB_SPECIALTY else None,
        parent_proposal_id=resolved_parent_proposal_id if data.type == ProposalType.SUB_SPECIALTY else None,
        status=ProposalStatus.PENDING,
    )
    db.add(proposal)

    # Asignamos el valor propuesto de inmediato (queda PENDING hasta que
    # un admin lo apruebe o rechace) — así el profesional ve en su perfil
    # lo que propuso, en vez de tener que esperar sin feedback visual.
    if data.type == ProposalType.SPECIALTY:
        professional.specialty = proposed_name_clean
        professional.specialty_status = DocStatus.PENDING
        professional.specialty_review_note = None
        # Solo una especialidad PRINCIPAL bloquea la visibilidad de un
        # profesional que YA estaba aprobado (si recién se está
        # registrando, su status ya es PENDING_DOCS y esto no aplica —
        # de todos modos no podrá quedar APPROVED hasta que se resuelva,
        # ver check_and_approve_professional).
        if professional.status == ProfessionalStatus.APPROVED:
            professional.status = ProfessionalStatus.UNDER_REVIEW
    else:
        professional.sub_specialty = proposed_name_clean
        professional.sub_specialty_status = DocStatus.PENDING
        professional.sub_specialty_review_note = None

    await db.commit()
    await db.refresh(proposal)

    log = AuditLog(
        user_id=current_user.id,
        action="SPECIALTY_PROPOSAL_CREATED",
        entity_type="SpecialtyProposal",
        entity_id=proposal.id,
        metadata_={"type": data.type.value, "proposed_name": proposed_name_clean},
    )
    db.add(log)

    # Avisar a TODOS los admins — antes esto no pasaba nunca, la única
    # forma de enterarse era entrar manualmente a la cola de propuestas.
    type_label = "especialidad" if data.type == ProposalType.SPECIALTY else "subespecialidad"
    await _notify_all_admins(
        db,
        title=f"Nueva propuesta de {type_label}",
        body=f"{professional.first_name} {professional.last_name} propuso '{proposed_name_clean}' — pendiente de revisión.",
        type_="SPECIALTY_PROPOSAL_CREATED",
        entity_id=proposal.id,
    )

    await db.commit()

    logger.info(f"Propuesta de especialidad creada: {proposal.id} por profesional {professional.id}")
    return {
        "message": "Propuesta enviada. Un administrador la revisará pronto.",
        "proposal": _serialize_proposal(proposal),
    }


# ── POST /specialties/select — elegir del catálogo (sin propuesta) ───
class SelectCatalogRequest(BaseModel):
    type: ProposalType
    catalog_id: str  # Specialty.id o SubSpecialty.id según el type


@router.post("/select", summary="Elegir una especialidad/subespecialidad YA existente en el catálogo")
async def select_from_catalog(
    data: SelectCatalogRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    """A diferencia de /proposals (para lo que NO está en el catálogo),
    acá el profesional elige algo que ya existe en la lista. Igual queda
    PENDING: aunque el nombre ya esté en el catálogo, un admin todavía
    tiene que confirmar que corresponde a este profesional en particular
    (mismo criterio que el resto de sus datos de verificación)."""
    professional = await _get_professional_or_404(db, current_user.id)

    if data.type == ProposalType.SPECIALTY:
        result = await db.execute(select(Specialty).where(Specialty.id == data.catalog_id, Specialty.is_active == True))
        specialty = result.scalar_one_or_none()
        if not specialty:
            raise HTTPException(status_code=404, detail="Especialidad no encontrada en el catálogo")
        professional.specialty = specialty.name
        professional.specialty_status = DocStatus.PENDING
        professional.specialty_review_note = None
        if professional.status == ProfessionalStatus.APPROVED:
            professional.status = ProfessionalStatus.UNDER_REVIEW
    else:
        if not professional.specialty:
            raise HTTPException(status_code=400, detail="Primero necesitas tener una especialidad para poder agregar una subespecialidad")
        result = await db.execute(select(SubSpecialty).where(SubSpecialty.id == data.catalog_id, SubSpecialty.is_active == True))
        sub = result.scalar_one_or_none()
        if not sub:
            raise HTTPException(status_code=404, detail="Subespecialidad no encontrada en el catálogo")
        professional.sub_specialty = sub.name
        professional.sub_specialty_status = DocStatus.PENDING
        professional.sub_specialty_review_note = None

    db.add(AuditLog(
        user_id=current_user.id,
        action="SPECIALTY_SELECTED_FROM_CATALOG",
        entity_type="Professional",
        entity_id=professional.id,
        metadata_={"type": data.type.value, "catalog_id": data.catalog_id},
    ))

    type_label = "especialidad" if data.type == ProposalType.SPECIALTY else "subespecialidad"
    await _notify_all_admins(
        db,
        title=f"{type_label.capitalize()} para confirmar",
        body=f"{professional.first_name} {professional.last_name} eligió '{specialty.name if data.type == ProposalType.SPECIALTY else sub.name}' del catálogo — pendiente de confirmación.",
        type_="SPECIALTY_CATALOG_PICK",
        entity_id=professional.id,
    )

    await db.commit()
    return {"message": "Selección guardada. Un administrador la confirmará pronto."}


# ── PATCH /specialties/professionals/{id}/confirm-catalog-pick (admin) ──
class ConfirmCatalogPickRequest(BaseModel):
    type: ProposalType
    decision: str = Field(..., pattern="^(APPROVE|REJECT)$")
    review_note: Optional[str] = None


@router.patch(
    "/professionals/{professional_id}/confirm-catalog-pick",
    summary="[Admin] Confirmar o rechazar una especialidad/subespecialidad elegida del catálogo",
)
async def confirm_catalog_pick(
    professional_id: str,
    data: ConfirmCatalogPickRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if data.decision == "REJECT" and not (data.review_note or "").strip():
        raise HTTPException(status_code=400, detail="El motivo de rechazo es obligatorio")

    result = await db.execute(select(Professional).where(Professional.id == professional_id))
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    is_specialty = data.type == ProposalType.SPECIALTY
    current_value = professional.specialty if is_specialty else professional.sub_specialty
    if not current_value:
        raise HTTPException(status_code=400, detail="El profesional no tiene nada cargado en este campo")

    type_label = "especialidad" if is_specialty else "subespecialidad"
    professional_approved_now = False

    if data.decision == "APPROVE":
        if is_specialty:
            professional.specialty_status = DocStatus.APPROVED
            professional.specialty_review_note = None
            # check_and_approve_professional revisa TODOS los requisitos
            # (no solo este) antes de decidir si pasa a APPROVED de nuevo.
            professional_approved_now = await check_and_approve_professional(db, professional)
        else:
            professional.sub_specialty_status = DocStatus.APPROVED
            professional.sub_specialty_review_note = None
            professional_approved_now = await check_and_approve_professional(db, professional)

        await notify_user(
            db, user_id=professional.user_id,
            title=f"{type_label.capitalize()} confirmada",
            body=f"Tu {type_label} '{current_value}' fue confirmada por un administrador.",
            type_="SPECIALTY_CATALOG_PICK_APPROVED",
            entity_type="Professional", entity_id=professional.id,
            send_whatsapp=False,
        )
    else:
        # Rechazo: se limpia el campo para que el profesional vuelva a
        # elegir del catálogo (o proponga una nueva) sin quedar con un
        # dato huérfano ni tener que re-registrarse — mismo patrón que un
        # documento rechazado que se puede resubir.
        if is_specialty:
            professional.specialty = None
            professional.specialty_status = DocStatus.PENDING
            professional.specialty_review_note = data.review_note
            if professional.status == ProfessionalStatus.UNDER_REVIEW:
                professional.status = ProfessionalStatus.PENDING_DOCS
            # La subespecialidad ahora se puede cargar ANTES de que la
            # especialidad esté aprobada (el profesional ya no tiene que
            # esperar). Eso significa que si la especialidad se rechaza,
            # cualquier subespecialidad que hubiera cargado quedaría
            # huérfana — conceptualmente ligada a una especialidad que ya
            # no existe (ej. "Electrofisiología cardíaca" sin "Cardiología"
            # detrás). Se limpia acá para forzar al profesional a elegir
            # de nuevo una vez que tenga una especialidad válida.
            if professional.sub_specialty:
                professional.sub_specialty = None
                professional.sub_specialty_status = None
                professional.sub_specialty_review_note = "Se limpió automáticamente: la especialidad de la que dependía fue rechazada."
        else:
            professional.sub_specialty = None
            professional.sub_specialty_status = None
            professional.sub_specialty_review_note = data.review_note

        await notify_user(
            db, user_id=professional.user_id,
            title=f"{type_label.capitalize()} rechazada",
            body=f"Tu {type_label} '{current_value}' fue rechazada. Motivo: {data.review_note}. Elige otra del catálogo o propone una nueva desde tu perfil.",
            type_="SPECIALTY_CATALOG_PICK_REJECTED",
            entity_type="Professional", entity_id=professional.id,
            send_whatsapp=False,
        )

    db.add(AuditLog(
        user_id=current_user.id,
        action=f"SPECIALTY_CATALOG_PICK_{data.decision}",
        entity_type="Professional",
        entity_id=professional.id,
        metadata_={"type": data.type.value, "review_note": data.review_note},
    ))
    await db.commit()

    return {"message": f"{type_label.capitalize()} {data.decision.lower()}", "professional_approved_now": professional_approved_now}


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
            # Limpiamos el campo en vez de dejarlo con el texto que se
            # acaba de rechazar (antes quedaba "huérfano": ni en el
            # catálogo, ni corregible por nadie). Así el profesional puede
            # volver a elegir del catálogo o proponer otra cosa desde su
            # perfil sin re-registrarse — mismo patrón que un documento
            # rechazado que se puede resubir.
            if proposal.type == ProposalType.SPECIALTY:
                professional.specialty = None
                professional.specialty_status = DocStatus.PENDING
                professional.specialty_review_note = data.admin_note
                # Antes esto revertía a APPROVED — pero ya no puede ser
                # APPROVED sin especialidad (ver check_and_approve_professional),
                # así que vuelve a PENDING_DOCS: sigue sin ser visible para
                # pacientes hasta que elija otra especialidad válida.
                if professional.status == ProfessionalStatus.UNDER_REVIEW:
                    professional.status = ProfessionalStatus.PENDING_DOCS
                # Misma limpieza que en confirm_catalog_pick: la
                # subespecialidad se puede cargar antes de que la
                # especialidad esté aprobada, así que si esta propuesta de
                # especialidad se rechaza, cualquier subespecialidad
                # cargada quedaría huérfana. Se limpia para forzar a
                # elegir de nuevo con la especialidad definitiva.
                if professional.sub_specialty:
                    professional.sub_specialty = None
                    professional.sub_specialty_status = None
                    professional.sub_specialty_review_note = "Se limpió automáticamente: la especialidad de la que dependía fue rechazada."
            else:
                professional.sub_specialty = None
                professional.sub_specialty_status = None
                professional.sub_specialty_review_note = data.admin_note

            type_label = "especialidad" if proposal.type == ProposalType.SPECIALTY else "subespecialidad"
            await notify_user(
                db, user_id=professional.user_id,
                title=f"Propuesta de {type_label} rechazada",
                body=(
                    f"Tu propuesta '{proposal.proposed_name}' fue rechazada. "
                    f"Motivo: {data.admin_note or 'sin especificar'}. "
                    "Puedes elegir una especialidad del catálogo o enviar una nueva propuesta."
                ),
                type_="SPECIALTY_PROPOSAL_REJECTED",
                entity_type="SpecialtyProposal",
                entity_id=proposal.id,
                # Solo in-app: caso poco frecuente y de menor urgencia, el
                # profesional lo revisa la próxima vez que entra a la app.
                send_whatsapp=False,
            )

        await db.commit()
        await db.refresh(proposal)
        logger.info(f"Propuesta rechazada: {proposal.id} por admin {current_user.id}")
        return {"message": "Propuesta rechazada.", "proposal": _serialize_proposal(proposal)}

    # decision == "APPROVE"
    final_name = (data.final_name or proposal.proposed_name).strip()
    proposal.final_name = final_name

    if proposal.type == ProposalType.SPECIALTY:
        existing = await db.execute(select(Specialty).where(Specialty.name == final_name))
        specialty = existing.scalar_one_or_none()
        if not specialty:
            specialty = Specialty(name=final_name, is_active=True)
            db.add(specialty)
            await db.flush()

        if professional:
            professional.specialty = final_name
            professional.specialty_status = DocStatus.APPROVED
            professional.specialty_review_note = None

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
            professional.sub_specialty = final_name
            professional.sub_specialty_status = DocStatus.APPROVED
            professional.sub_specialty_review_note = None

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
        await notify_user(
            db, user_id=professional.user_id,
            title=f"Propuesta de {type_label} aprobada",
            body=(
                f"Tu propuesta '{proposal.proposed_name}' fue aprobada"
                + (f" como '{final_name}'" if final_name != proposal.proposed_name else "")
                + f".{extra_note}"
            ),
            type_="SPECIALTY_PROPOSAL_APPROVED",
            entity_type="SpecialtyProposal",
            entity_id=proposal.id,
            # Solo in-app, mismo criterio que el rechazo de arriba.
            send_whatsapp=False,
        )

    professional_approved_now = False
    if professional:
        professional_approved_now = await check_and_approve_professional(db, professional)

    await db.commit()
    await db.refresh(proposal)

    logger.info(f"Propuesta aprobada: {proposal.id} → '{final_name}' por admin {current_user.id}")
    return {
        "message": "Propuesta aprobada.",
        "proposal": _serialize_proposal(proposal),
        "professional_approved_now": professional_approved_now,
    }