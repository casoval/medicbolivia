"""
app/api/v1/endpoints/professionals.py
Endpoints de profesionales: directorio, disponibilidad, precios, documentos, foto de perfil.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Optional, List
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user, get_current_professional, get_current_admin, get_current_user_optional
from app.models.models import (
    User, UserRole, Professional, ProfessionalDoc, ProfessionalStatus,
    AvailabilityMode, DocType, DocStatus, AuditLog, Notification,
    Consultation, ConsultationStatus, ConsultationType, Schedule,
    Payment, PaymentStatus, Patient, ProfessionalPatientVisibility
)
from app.schemas.schemas import (
    ProfessionalPublicResponse, ProfessionalUpdateRequest,
    PriceUpdateRequest, AvailabilityUpdateRequest, DocReviewRequest,
    ScheduleSetRequest, ScheduleResponse, PatientBlockRequest, PatientBlockResponse,
    PatientLinkResponse,
)
from app.services.storage import upload_document_to_r2, upload_photo_to_r2
from app.services.commission import get_professional_commission_summary
from app.services.patient_links import professional_has_active_membership
from app.models.models import PatientProfessionalLink, ProfessionalMembership
from app.services.chat import (
    assert_no_pending_appointments, block_patient_integrally,
    unblock_patient_integrally, get_visibility_block, PendingAppointmentsError,
    RateLimitError,
)

router = APIRouter()

BOLIVIA_TZ = ZoneInfo("America/La_Paz")

# Margen mínimo de anticipación para agendar una cita. Si el paciente
# necesita atención antes de eso, debe usar una consulta inmediata —
# agendar a tan poco tiempo no deja margen para que el profesional
# acepte/rechace, el paciente pague el QR (5 min) y ambos se preparen.
MIN_SCHEDULING_LEAD_MINUTES = 60


def _schedule_day_of_week(now: datetime) -> int:
    """Convierte datetime.weekday() (0=Lunes..6=Domingo) al formato usado en
    Schedule (0=Domingo..6=Sábado)."""
    return (now.weekday() + 1) % 7


def _compute_effective_availability(
    professional: Professional,
    busy_ids: set[str],
    now: datetime,
) -> AvailabilityMode:
    """
    Calcula la disponibilidad "real" de un profesional para mostrar en el
    directorio:
    1. Si está EN una consulta activa (video llamada en curso) → OFFLINE,
       sin importar lo que diga su configuración manual o automática.
    2. Si tiene activado el modo automático → se calcula según sus bloques
       de horario (Schedule) para el día/hora actual.
    3. Si no → se respeta lo que el profesional eligió manualmente.
    """
    if professional.id in busy_ids:
        return AvailabilityMode.OFFLINE

    if not professional.auto_availability:
        return professional.availability

    today = _schedule_day_of_week(now)
    current_time = now.strftime("%H:%M")
    for block in (professional.schedules or []):
        if block.is_blocked or block.day_of_week != today:
            continue
        if block.start_time <= current_time < block.end_time:
            return AvailabilityMode.ONLINE_NOW
    return AvailabilityMode.OFFLINE


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
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db)
):
    from sqlalchemy.orm import selectinload

    conditions = [Professional.status == ProfessionalStatus.APPROVED]

    if specialty:
        from sqlalchemy import func
        conditions.append(
            func.lower(Professional.specialty).contains(specialty.lower())
        )

    # NOTA: el filtro por disponibilidad ya NO se hace en SQL — se calcula
    # en Python con _compute_effective_availability, porque depende del modo
    # automático (horario) y de si está en una llamada activa ahora mismo.
    query = select(Professional).where(and_(*conditions)).options(selectinload(Professional.schedules))

    if search:
        from sqlalchemy import or_, func
        search_term = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Professional.first_name).like(search_term),
                func.lower(Professional.last_name).like(search_term),
            )
        )

    result = await db.execute(query)
    professionals = result.scalars().all()

    # Si quien consulta es un paciente logueado, excluir los profesionales
    # que lo bloquearon integralmente desde "Mis Pacientes" (ver
    # ProfessionalPatientVisibility / services/chat.py). Para visitantes
    # anónimos o profesionales/admin logueados, no aplica ningún filtro.
    if current_user and current_user.role == UserRole.PATIENT:
        patient_row = (await db.execute(select(Patient).where(Patient.user_id == current_user.id))).scalar_one_or_none()
        if patient_row:
            hidden_result = await db.execute(
                select(ProfessionalPatientVisibility.professional_id).where(
                    ProfessionalPatientVisibility.patient_id == patient_row.id,
                    ProfessionalPatientVisibility.hidden.is_(True),
                    ProfessionalPatientVisibility.restored_at.is_(None),
                )
            )
            hidden_ids = {row[0] for row in hidden_result.all()}
            if hidden_ids:
                professionals = [p for p in professionals if p.id not in hidden_ids]

    # Profesionales con una consulta EN CURSO ahora mismo (inmediata o
    # agendada) — no deben recibir nuevas solicitudes inmediatas mientras
    # están en llamada.
    busy_result = await db.execute(
        select(Consultation.professional_id).where(
            Consultation.status == ConsultationStatus.IN_PROGRESS,
            Consultation.professional_id.isnot(None),
        )
    )
    busy_ids = {row[0] for row in busy_result.all()}

    now = datetime.now(BOLIVIA_TZ)

    # Membresía activa, en bulk (un solo query para todo el directorio) —
    # el botón "Vincularme" del paciente solo tiene sentido si el
    # profesional tiene membresía activa (ver app/services/patient_links.py).
    from app.services.patient_links import professionals_with_active_membership
    membership_ids = await professionals_with_active_membership(db, [p.id for p in professionals], now)

    enriched = []
    for p in professionals:
        effective = _compute_effective_availability(p, busy_ids, now)
        # IMPORTANTE: no mutamos p.availability (el objeto ORM) — eso quedaría
        # "sucio" en la sesión y get_db lo persistiría por error al hacer
        # commit al final de la petición. Calculamos sobre la respuesta ya
        # serializada en su lugar.
        resp = ProfessionalPublicResponse.model_validate(p)
        resp.availability = effective
        resp.has_active_membership = p.id in membership_ids
        enriched.append(resp)

    if available_now:
        enriched = [r for r in enriched if r.availability == AvailabilityMode.ONLINE_NOW]

    enriched.sort(
        key=lambda r: (r.availability != AvailabilityMode.ONLINE_NOW, -float(r.average_rating or 0))
    )

    return enriched


# ── PATCH /api/v1/professionals/availability ────────
@router.patch("/availability", summary="Actualizar disponibilidad del profesional")
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

    if data.auto_availability is not None:
        professional.auto_availability = data.auto_availability
    if data.availability is not None:
        professional.availability = data.availability
    await db.commit()

    logger.info(
        f"Disponibilidad actualizada: {professional.id} → "
        f"manual={data.availability} auto={data.auto_availability}"
    )
    return {
        "availability": professional.availability,
        "auto_availability": professional.auto_availability,
        "message": "Disponibilidad actualizada",
    }


# ── PATCH /api/v1/professionals/prices ──────────────
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
@router.post(
    "/documents",
    status_code=status.HTTP_201_CREATED,
    summary="Subir o reemplazar documento de verificación"
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

    file_url = await upload_document_to_r2(
        file_content=content,
        file_name=file.filename or "document",
        professional_id=str(professional.id),
        doc_type=doc_type.value,
        content_type=file.content_type,
    )

    # UPSERT: si ya existe un doc de ese tipo para este profesional, actualizarlo
    existing = await db.execute(
        select(ProfessionalDoc).where(
            and_(
                ProfessionalDoc.professional_id == professional.id,
                ProfessionalDoc.doc_type == doc_type,
            )
        )
    )
    doc = existing.scalar_one_or_none()

    if doc:
        # Reemplazar: nueva URL, vuelve a PENDING y se limpia la revisión anterior
        # (si no se limpia review_note, el profesional seguiría viendo el motivo
        # de un rechazo que ya corrigió)
        doc.file_url = file_url
        doc.status = DocStatus.PENDING
        doc.review_note = None
        doc.reviewed_at = None
        doc.reviewed_by = None
        logger.info(f"Documento reemplazado: {doc_type} para profesional {professional.id}")
        action = "reemplazado"
    else:
        # Primera vez: insertar
        doc = ProfessionalDoc(
            professional_id=professional.id,
            doc_type=doc_type,
            file_url=file_url,
            status=DocStatus.PENDING,
        )
        db.add(doc)
        logger.info(f"Documento subido: {doc_type} para profesional {professional.id}")
        action = "subido"

    # Auditoría — visible en /admin/logs filtrando por "DOC"
    db.add(AuditLog(
        user_id=current_user.id,
        action=f"DOC_{action.upper()}",
        entity_type="ProfessionalDoc",
        entity_id=doc.id,
        metadata_={"doc_type": doc_type.value, "professional_id": professional.id},
    ))

    await db.commit()
    await db.refresh(doc)

    return {
        "message": f"Documento {action} exitosamente. Será revisado en 24-72 horas.",
        "doc_id": doc.id,
        "status": "PENDING",
        "action": action,
    }


# ── POST /api/v1/professionals/photo ────────────────
@router.post(
    "/photo",
    summary="Subir o actualizar foto de perfil"
)
async def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_professional),
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
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    photo_url = await upload_photo_to_r2(
        file_content=content,
        file_name=file.filename or "photo.jpg",
        professional_id=str(professional.id),
        content_type=file.content_type,
    )

    professional.photo_url = photo_url
    await db.commit()

    logger.info(f"Foto de perfil actualizada: profesional {professional.id}")
    return {"photo_url": photo_url, "message": "Foto de perfil actualizada correctamente"}


# ── PATCH /api/v1/professionals/profile ─────────────
@router.patch(
    "/profile",
    summary="Actualizar datos del perfil público (bio, idiomas, experiencia)"
)
async def update_profile(
    bio: Optional[str] = Form(None),
    languages: Optional[str] = Form(None),
    years_experience: Optional[int] = Form(None),
    appointment_duration_minutes: Optional[int] = Form(None),
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    if bio is not None:
        professional.bio = bio
    if languages is not None:
        professional.languages = [l.strip() for l in languages.split(",") if l.strip()]
    if years_experience is not None:
        professional.years_experience = years_experience
    if appointment_duration_minutes is not None:
        if not (10 <= appointment_duration_minutes <= 240):
            raise HTTPException(status_code=400, detail="La duración debe estar entre 10 y 240 minutos")
        professional.appointment_duration_minutes = appointment_duration_minutes

    await db.commit()
    return {"message": "Perfil actualizado correctamente"}


# ── GET /api/v1/professionals/me ────────────────────
@router.get("/me", summary="Perfil propio del profesional autenticado")
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

    # % de comisión vigente ahora mismo para este profesional (individual >
    # promo global > default) — para que el profesional vea con total
    # transparencia cuánto le llega neto por cada tipo de consulta antes de
    # que se le cobre nada. Ver app/services/commission.py.
    commission_info = await get_professional_commission_summary(db, professional.id)
    commission_percent = commission_info["percent"]

    def _net(price):
        if price is None:
            return None
        return (price - (price * commission_percent / 100)).quantize(Decimal("0.01"))

    return {
        "first_name": professional.first_name,
        "last_name": professional.last_name,
        "ci": professional.ci,
        "birth_date": professional.birth_date.isoformat() if professional.birth_date else None,
        "department": professional.department,
        "gender": professional.gender,
        "specialty": professional.specialty,
        "sub_specialties": professional.sub_specialties or [],
        "email": current_user.email,
        "phone": current_user.phone,
        "status": professional.status,
        "availability": professional.availability,
        "auto_availability": professional.auto_availability,
        "appointment_duration_minutes": professional.appointment_duration_minutes,
        "price_general": professional.price_general,
        "price_urgent": professional.price_urgent,
        "price_follow_up": professional.price_follow_up,
        # Transparencia de comisión: % vigente ahora mismo y cuánto le
        # llegaría neto por cada tipo de consulta con los precios actuales.
        # source: "PROFESSIONAL" (promo individual), "GLOBAL_PROMO"
        # (promo de toda la plataforma) o "DEFAULT" (comisión estándar).
        "commission": {
            "percent": commission_info["percent"],
            "source": commission_info["source"],
            "label": commission_info["label"],
            "ends_at": commission_info["ends_at"].isoformat() if commission_info["ends_at"] else None,
            "net_price_general": _net(professional.price_general),
            "net_price_urgent": _net(professional.price_urgent),
            "net_price_follow_up": _net(professional.price_follow_up),
        },
        "photo_url": professional.photo_url,
        "bio": professional.bio,
        "languages": ", ".join(professional.languages) if professional.languages else "Español",
        "years_experience": professional.years_experience,
        "cmb_matricula": professional.cmb_matricula,
        "sedes_number": professional.sedes_number,
        "average_rating": professional.average_rating,
        "total_ratings": professional.total_ratings,
        "total_consultations": professional.total_consultations,
        "created_at": professional.created_at.isoformat() if professional.created_at else None,
    }


# ── GET /api/v1/professionals/me/earnings ───────────
# Historial de pagos RECIBIDOS por el profesional: por cada consulta cobrada,
# cuánto pagó el paciente, cuánto se quedó la plataforma (comisión) y cuánto
# le corresponde a él. Distingue claramente entre dinero YA liberado a su
# favor (RELEASED_TO_PROFESSIONAL) y dinero todavía retenido en garantía
# (CONFIRMED, pendiente de liberación tras el período de espera post-consulta),
# para que el profesional nunca tenga dudas de cuánto puede considerar suyo.
@router.get("/me/earnings", summary="Historial y estadísticas de mis pagos recibidos")
async def get_my_earnings(
    limit: int = Query(100, le=200),
    offset: int = Query(0, ge=0),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    # ── Estadísticas (sobre TODOS sus pagos, sin paginar) ───────────────
    all_result = await db.execute(
        select(Payment, Consultation, Patient)
        .join(Consultation, Payment.consultation_id == Consultation.id)
        .join(Patient, Consultation.patient_id == Patient.id, isouter=True)
        .where(Consultation.professional_id == professional.id)
        .order_by(Payment.created_at.desc())
    )
    all_rows = all_result.all()

    total_recibido = 0.0      # Ya liberado a su favor — es suyo, disponible
    total_retenido = 0.0      # Pagado por el paciente, pero aún en garantía (no liberado)
    total_en_disputa = 0.0    # Congelado mientras el admin resuelve un reclamo
    total_comision_plataforma = 0.0
    consultas_cobradas = 0

    for p, c, pat in all_rows:
        net = float(p.professional_net)
        if p.status == PaymentStatus.RELEASED_TO_PROFESSIONAL:
            total_recibido += net
            total_comision_plataforma += float(p.platform_fee)
            consultas_cobradas += 1
        elif p.status == PaymentStatus.CONFIRMED:
            total_retenido += net
        elif p.status == PaymentStatus.DISPUTED:
            total_en_disputa += net
        elif p.status in (PaymentStatus.REFUNDED_PARTIAL,) and p.refunded_amount is not None:
            # En un reembolso parcial, la parte no reembolsada sigue
            # correspondiendo (proporcionalmente) al profesional una vez liberada.
            if p.released_at:
                remainder_net = max(net - float(p.refunded_amount), 0.0)
                total_recibido += remainder_net
                consultas_cobradas += 1

    stats = {
        "total_recibido": round(total_recibido, 2),
        "total_retenido": round(total_retenido, 2),
        "total_en_disputa": round(total_en_disputa, 2),
        "total_comision_plataforma": round(total_comision_plataforma, 2),
        "consultas_cobradas": consultas_cobradas,
        "cantidad_pagos": len(all_rows),
    }

    # ── Listado paginado (con filtro opcional de estado) ────────────────
    query = (
        select(Payment, Consultation, Patient)
        .join(Consultation, Payment.consultation_id == Consultation.id)
        .join(Patient, Consultation.patient_id == Patient.id, isouter=True)
        .where(Consultation.professional_id == professional.id)
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
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "created_at": p.created_at.isoformat(),
            "released_at": p.released_at.isoformat() if p.released_at else None,
            "refunded_at": p.refunded_at.isoformat() if p.refunded_at else None,
            "refunded_amount": float(p.refunded_amount) if p.refunded_amount is not None else None,
            "disputed_at": p.disputed_at.isoformat() if p.disputed_at else None,
            "dispute_category": p.dispute_category,
            "resolution_note": p.resolution_note,
            "patient_id": pat.id if pat else None,
            "patient_first_name": pat.first_name if pat else None,
            "patient_last_name": pat.last_name if pat else None,
            "patient_photo_url": pat.photo_url if pat else None,
            "specialty": c.specialty if c else None,
            "consultation_type": c.consultation_type if c else None,
            "consultation_status": c.status if c else None,
            "scheduled_at": c.scheduled_at.isoformat() if c and c.scheduled_at else None,
            "outcome_note": c.outcome_note if c else None,
        }
        for p, c, pat in rows
    ]

    return {"stats": stats, "items": items}


# ── GET /api/v1/professionals/me/documents ──────────
@router.get("/me/documents", summary="Ver mis propios documentos de verificación, con su estado")
async def get_my_documents(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    docs_result = await db.execute(
        select(ProfessionalDoc).where(ProfessionalDoc.professional_id == professional.id)
    )
    docs = docs_result.scalars().all()

    from app.services.storage import get_presigned_url
    doc_list = []
    for d in docs:
        try:
            is_remote = d.file_url.startswith("r2://") or d.file_url.startswith("s3://")
            url = await get_presigned_url(d.file_url) if is_remote else d.file_url
        except Exception as e:
            logger.error(f"No se pudo firmar URL del documento propio {d.id}: {e}")
            url = None
        doc_list.append({
            "id":          d.id,
            "doc_type":    d.doc_type,
            "status":      d.status,
            "url":         url,
            "review_note": d.review_note,
            "reviewed_at": d.reviewed_at.isoformat() if d.reviewed_at else None,
            "created_at":  d.created_at.isoformat(),
        })
    return doc_list


# ── GET /api/v1/professionals/me/notifications ──────
@router.get("/me/notifications", summary="Mis notificaciones (campanita)")
async def get_my_notifications(
    unread_only: bool = Query(False),
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import Notification
    conditions = [Notification.user_id == current_user.id]
    if unread_only:
        conditions.append(Notification.read_at.is_(None))

    result = await db.execute(
        select(Notification)
        .where(and_(*conditions))
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    notifications = result.scalars().all()
    return [
        {
            "id":          n.id,
            "title":       n.title,
            "body":        n.body,
            "type":        n.type,
            "entity_type": n.entity_type,
            "entity_id":   n.entity_id,
            "read":        n.read_at is not None,
            "created_at":  n.created_at.isoformat(),
        }
        for n in notifications
    ]


# ── PATCH /api/v1/professionals/me/notifications/{id}/read ─
@router.patch("/me/notifications/{notification_id}/read", summary="Marcar notificación como leída")
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import Notification
    from datetime import datetime as dt
    result = await db.execute(
        select(Notification).where(
            and_(Notification.id == notification_id, Notification.user_id == current_user.id)
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")

    notif.read_at = dt.utcnow()
    await db.commit()
    return {"message": "Notificación marcada como leída"}


# ── PATCH /api/v1/professionals/me/notifications/read-all ─
@router.patch("/me/notifications/read-all", summary="Marcar todas mis notificaciones como leídas")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import Notification
    from datetime import datetime as dt
    result = await db.execute(
        select(Notification).where(
            and_(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        )
    )
    for n in result.scalars().all():
        n.read_at = dt.utcnow()
    await db.commit()
    return {"message": "Notificaciones marcadas como leídas"}
# ── GET /api/v1/professionals/schedule ──────────────
# IMPORTANTE: esta ruta y la de abajo (PUT) deben quedar registradas ANTES
# de "GET /{professional_id}" más abajo en este archivo — si no, FastAPI
# intentaría interpretar "schedule" como un professional_id.
@router.get(
    "/schedule",
    response_model=List[ScheduleResponse],
    summary="Ver mis bloques de horario semanal"
)
async def get_my_schedule(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = (await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )).scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    result = await db.execute(
        select(Schedule)
        .where(Schedule.professional_id == professional.id)
        .order_by(Schedule.day_of_week, Schedule.start_time)
    )
    return [ScheduleResponse.model_validate(b) for b in result.scalars().all()]


# ── PUT /api/v1/professionals/schedule ──────────────
@router.put(
    "/schedule",
    response_model=List[ScheduleResponse],
    summary="Reemplazar mis bloques de horario semanal"
)
async def set_my_schedule(
    data: ScheduleSetRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    professional = (await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )).scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    # Validar que los bloques del mismo día no se superpongan entre sí
    by_day: dict[int, list] = {}
    for b in data.blocks:
        by_day.setdefault(b.day_of_week, []).append(b)
    for day, blocks in by_day.items():
        blocks_sorted = sorted(blocks, key=lambda b: b.start_time)
        for i in range(len(blocks_sorted) - 1):
            if blocks_sorted[i].end_time > blocks_sorted[i + 1].start_time:
                raise HTTPException(
                    status_code=400,
                    detail=f"Bloques superpuestos el día {day}: "
                           f"{blocks_sorted[i].start_time}-{blocks_sorted[i].end_time} y "
                           f"{blocks_sorted[i+1].start_time}-{blocks_sorted[i+1].end_time}"
                )

    # Reemplazo total: se borran los bloques anteriores y se crean los nuevos
    await db.execute(
        Schedule.__table__.delete().where(Schedule.professional_id == professional.id)
    )
    new_blocks = [
        Schedule(
            professional_id=professional.id,
            day_of_week=b.day_of_week,
            start_time=b.start_time,
            end_time=b.end_time,
            is_blocked=b.is_blocked,
        )
        for b in data.blocks
    ]
    db.add_all(new_blocks)
    await db.commit()

    result = await db.execute(
        select(Schedule)
        .where(Schedule.professional_id == professional.id)
        .order_by(Schedule.day_of_week, Schedule.start_time)
    )
    logger.info(f"Horario actualizado: profesional {professional.id} → {len(new_blocks)} bloques")
    return [ScheduleResponse.model_validate(b) for b in result.scalars().all()]


# ── GET /api/v1/professionals/{id}/schedule ─────────
# Pública: el paciente la usa para ver los horarios SUGERIDOS por el
# profesional al momento de agendar una cita. No restringe el horario que
# el paciente puede elegir — solo orienta. La decisión final es del
# profesional al aceptar o rechazar la solicitud.
@router.get(
    "/{professional_id}/schedule",
    response_model=List[ScheduleResponse],
    summary="Ver los horarios sugeridos por un profesional (público)"
)
async def get_professional_schedule(
    professional_id: str,
    db: AsyncSession = Depends(get_db)
):
    professional = (await db.execute(
        select(Professional).where(Professional.id == professional_id)
    )).scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    result = await db.execute(
        select(Schedule)
        .where(Schedule.professional_id == professional_id, Schedule.is_blocked == False)
        .order_by(Schedule.day_of_week, Schedule.start_time)
    )
    return [ScheduleResponse.model_validate(b) for b in result.scalars().all()]


async def compute_available_slots(
    db: AsyncSession,
    professional: Professional,
    target_date,  # datetime.date
) -> list[datetime]:
    """
    Calcula los horarios concretos (fecha+hora) en que el paciente puede
    solicitar una cita con este profesional, según:
    1. Sus bloques de Schedule no bloqueados para ese día de la semana,
       cortados en intervalos de appointment_duration_minutes.
    2. Excluyendo horarios ya ocupados por otra cita agendada que siga viva
       (pendiente de aceptación, aceptada, o en curso).
    3. Si la fecha es hoy, excluyendo horarios que ya pasaron.
    El profesional decide igual si acepta o rechaza — esto solo evita que el
    paciente pida un horario fuera de lo que el profesional indicó.
    """
    duration = timedelta(minutes=professional.appointment_duration_minutes or 30)

    # Usar medianoche en hora Bolivia para calcular el día correcto
    day_start_bo = datetime(target_date.year, target_date.month, target_date.day,
                            0, 0, 0, tzinfo=BOLIVIA_TZ)
    day_of_week = _schedule_day_of_week(day_start_bo)

    schedules_result = await db.execute(
        select(Schedule).where(
            Schedule.professional_id == professional.id,
            Schedule.day_of_week == day_of_week,
            Schedule.is_blocked == False,
        )
    )
    blocks = schedules_result.scalars().all()
    if not blocks:
        return []

    # scheduled_at se guarda como hora local de Bolivia, naive (sin tzinfo) —
    # ver consultations.py, donde se compara directamente contra
    # datetime.now(ZoneInfo("America/La_Paz")).replace(tzinfo=None).
    # Por lo tanto aquí NO se convierte a UTC: se trabaja todo en hora Bolivia naive.
    day_start_naive = day_start_bo.replace(tzinfo=None)
    day_end_naive   = day_start_naive + timedelta(days=1)

    occupied_result = await db.execute(
        select(Consultation).where(
            Consultation.professional_id == professional.id,
            Consultation.consultation_type == ConsultationType.SCHEDULED,
            Consultation.status.in_([
                ConsultationStatus.WAITING_PROFESSIONAL,
                ConsultationStatus.WAITING_PAYMENT,
                ConsultationStatus.PAYMENT_CONFIRMED,
                ConsultationStatus.IN_PROGRESS,
            ]),
            Consultation.scheduled_at >= day_start_naive,
            Consultation.scheduled_at < day_end_naive,
        )
    )
    occupied_ranges = [
        (c.scheduled_at, c.scheduled_at + duration) for c in occupied_result.scalars().all()
    ]

    now_bo = datetime.now(BOLIVIA_TZ)
    min_lead_time_bo = now_bo + timedelta(minutes=MIN_SCHEDULING_LEAD_MINUTES)
    min_lead_time_naive = min_lead_time_bo.replace(tzinfo=None)

    slots = []
    for block in blocks:
        h, m = map(int, block.start_time.split(":"))
        slot_start = day_start_naive.replace(hour=h, minute=m)
        h, m = map(int, block.end_time.split(":"))
        block_end  = day_start_naive.replace(hour=h, minute=m)

        while slot_start + duration <= block_end:
            slot_end = slot_start + duration

            is_too_soon       = slot_start < min_lead_time_naive
            overlaps_occupied = any(slot_start < oe and os_ < slot_end
                                    for os_, oe in occupied_ranges)
            if not is_too_soon and not overlaps_occupied:
                slots.append(slot_start)
            slot_start = slot_end

    return slots


# ─────────────────────────────────────────────────────
# "MIS PACIENTES" — pacientes que se vincularon a este profesional.
# El vínculo lo crea/revoca siempre el paciente (ver /patients/links).
# Esto es solo lectura para el profesional, más el estado de su propia
# membresía (para que el frontend sepa si mostrar el botón "Agendar").
#
# IMPORTANTE: estas rutas literales (/my-patients, /my-membership)
# deben registrarse ANTES que /{professional_id} y
# /{professional_id}/available-slots más abajo. FastAPI/Starlette
# matchea rutas en el orden en que se registran, y /{professional_id}
# captura CUALQUIER segmento único de path — incluido literalmente
# "my-patients" o "my-membership" — si se registra primero. Eso causaba
# que ambos endpoints devolvieran 500 (asyncpg intentando castear
# "my-membership" a UUID) en vez de ejecutarse.
# ─────────────────────────────────────────────────────

@router.get(
    "/my-patients",
    response_model=list[PatientLinkResponse],
    summary="Listar mis vínculos con pacientes (incluye revocados)",
)
async def list_my_linked_patients(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    # OJO: ya no filtramos revoked_at IS NULL. El frontend necesita saber
    # también cuáles se desvincularon explícitamente, para no ofrecer
    # "Agendar cita" a un paciente que ya tuvo consulta pero luego se
    # desvinculó (ver groupByPatient en professional/patients/page.tsx).
    # Nos quedamos con la fila MÁS RECIENTE por paciente — si se vinculó,
    # se desvinculó y se volvió a vincular, manda el estado actual.
    rows = (await db.execute(
        select(PatientProfessionalLink, Patient)
        .join(Patient, Patient.id == PatientProfessionalLink.patient_id)
        .where(PatientProfessionalLink.professional_id == professional.id)
        .order_by(PatientProfessionalLink.created_at.desc())
    )).all()

    latest_by_patient: dict[str, tuple] = {}
    for link, patient in rows:
        if link.patient_id not in latest_by_patient:
            latest_by_patient[link.patient_id] = (link, patient)

    return [
        PatientLinkResponse(
            id=link.id, patient_id=link.patient_id, professional_id=link.professional_id,
            created_at=link.created_at, revoked_at=link.revoked_at,
            patient_first_name=patient.first_name, patient_last_name=patient.last_name,
            patient_photo_url=patient.photo_url,
        )
        for link, patient in latest_by_patient.values()
    ]



@router.get(
    "/my-membership",
    summary="Estado y detalle de mi membresía (habilitada/deshabilitada por el admin)",
)
async def get_my_membership_status(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    active = await professional_has_active_membership(db, professional.id)

    # Detalle completo para que el profesional vea, en su propio perfil,
    # exactamente qué tiene vigente y su historial (todo lo habilita/
    # deshabilita un admin manualmente, ver ProfessionalMembership).
    rows = (await db.execute(
        select(ProfessionalMembership)
        .where(ProfessionalMembership.professional_id == professional.id)
        .order_by(ProfessionalMembership.starts_at.desc())
    )).scalars().all()

    def _serialize(m: ProfessionalMembership) -> dict:
        now_bolivia = datetime.now(BOLIVIA_TZ).replace(tzinfo=None)
        is_current = (
            m.active
            and m.starts_at <= now_bolivia
            and (m.ends_at is None or m.ends_at > now_bolivia)
        )
        return {
            "id": m.id,
            "period_label": m.period_label,
            "starts_at": m.starts_at.isoformat() if m.starts_at else None,
            "ends_at": m.ends_at.isoformat() if m.ends_at else None,
            "active": m.active,
            "note": m.note,
            "is_current": is_current,
        }

    serialized = [_serialize(m) for m in rows]
    current = next((m for m in serialized if m["is_current"]), None)

    return {
        "active": active,
        "current": current,
        "history": serialized,
    }


# ── GET /api/v1/professionals/{id}/available-slots ──
# Pública: horarios concretos que el paciente puede elegir para agendar.
# Solo se pueden pedir horarios de esta lista — el profesional definió estos
# bloques, y aun así debe aceptar la solicitud para confirmarla.
@router.get(
    "/{professional_id}/available-slots",
    summary="Horarios disponibles de un profesional para una fecha (para agendar)"
)
async def get_available_slots(
    professional_id: str,
    target_date: str = Query(..., alias="date", description="Formato YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db)
):
    from datetime import date as date_cls
    try:
        parsed_date = date_cls.fromisoformat(target_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Usa YYYY-MM-DD")

    professional = (await db.execute(
        select(Professional).where(Professional.id == professional_id)
    )).scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    today = datetime.now(BOLIVIA_TZ).date()
    if parsed_date < today:
        return {"slots": []}

    slots = await compute_available_slots(db, professional, parsed_date)
    return {
        "date": target_date,
        "appointment_duration_minutes": professional.appointment_duration_minutes,
        "slots": [s.isoformat() for s in slots],
    }


@router.get("/admin/pending-docs", summary="[Admin] Documentos pendientes de revisión")
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

    resp = ProfessionalPublicResponse.model_validate(professional)
    resp.has_active_membership = await professional_has_active_membership(db, professional.id)
    return resp


# ── PATCH /api/v1/professionals/{id}/verify (admin) ─
@router.patch("/{professional_id}/verify", summary="[Admin] Aprobar o rechazar un profesional")
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


# ─────────────────────────────────────────────────────
# "Mis Pacientes" — bloqueo INTEGRAL (solo profesional -> paciente)
#
# A diferencia del bloqueo puntual dentro de la ventana de chat (que
# solo corta la mensajería, ver endpoints/chat.py), este bloqueo es
# integral: el profesional desaparece de las búsquedas/listados de ESE
# paciente puntual, no puede agendar nuevas citas con él, y el chat
# también queda cortado — todo junto, como un solo efecto. El historial
# clínico ya generado (recetas, notas) nunca se oculta.
#
# Precondición: no puede haber citas pendientes entre ambos — el
# profesional debe cancelarlas primero por los medios normales.
# ─────────────────────────────────────────────────────

@router.get(
    "/patients/{patient_id}/block",
    summary="[Profesional] Ver si tengo bloqueado integralmente a este paciente",
)
async def get_patient_block_status(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil profesional no encontrado")

    block = await get_visibility_block(db, professional.id, patient_id)
    if not block:
        return {"blocked": False}
    return {"blocked": True, **PatientBlockResponse.model_validate(block).model_dump()}


@router.post(
    "/patients/{patient_id}/block",
    response_model=PatientBlockResponse,
    summary="[Profesional] Bloquear integralmente a un paciente propio (opcionalmente reportar)",
)
async def block_patient(
    patient_id: str,
    data: PatientBlockRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil profesional no encontrado")

    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paciente no encontrado")

    try:
        await assert_no_pending_appointments(db, professional.id, patient_id)
    except Exception as e:
        # PendingAppointmentsError trae el mensaje ya listo para el usuario.
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))

    try:
        visibility = await block_patient_integrally(
            db,
            professional_id=professional.id,
            professional_user_id=current_user.id,
            patient_id=patient_id,
            patient_user_id=patient.user_id,
            is_reported=data.is_reported,
            reason_category=data.reason_category,
            reason_text=data.reason_text,
        )
    except RateLimitError as e:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, e.message)

    await db.commit()
    await db.refresh(visibility)

    logger.info(
        f"🚫 Bloqueo integral creado: profesional={professional.id} paciente={patient_id} "
        f"reported={data.is_reported}"
    )
    if data.is_reported:
        from app.tasks.chat_tasks import notify_admin_of_patient_visibility_report
        notify_admin_of_patient_visibility_report.delay(visibility.id)

    return PatientBlockResponse.model_validate(visibility)


@router.delete(
    "/patients/{patient_id}/block",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="[Profesional] Desbloquear a un paciente previamente bloqueado de forma integral",
)
async def unblock_patient(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db),
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil profesional no encontrado")

    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Paciente no encontrado")

    # Nota: a diferencia del desbloqueo de chat puntual, acá SÍ se permite
    # desbloquear aunque la última conversación haya vencido — restaura
    # la visibilidad y permite agendar una cita nueva, que generará su
    # propia conversación con su propia ventana de 15 días. El chat
    # derivado (ChatBlock scope=CONTACT) respeta igual la regla de los
    # 15 días si existiera una conversación activa por reactivar.
    await unblock_patient_integrally(
        db,
        professional_id=professional.id,
        professional_user_id=current_user.id,
        patient_id=patient_id,
        patient_user_id=patient.user_id,
        unblocked_by_id=current_user.id,
    )
    await db.commit()
    logger.info(f"✅ Bloqueo integral levantado: profesional={professional.id} paciente={patient_id}")