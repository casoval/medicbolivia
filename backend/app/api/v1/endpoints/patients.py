"""
app/api/v1/endpoints/patients.py
Endpoints de pacientes: perfil propio.
"""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Optional

from app.db.database import get_db
from app.core.dependencies import get_current_patient, get_current_professional
from app.core.timezone import utcnow_naive
from app.models.models import (
    User, Patient, Professional, Consultation, Payment, PaymentStatus,
    PatientProfessionalLink, ProfessionalStatus, PaymentChannel, AuditLog,
)
from app.schemas.schemas import (
    PatientUpdateRequest, PatientLinkCreateRequest, PatientLinkResponse,
    PatientRefundAccountRequest,
)
from app.services.storage import upload_photo_to_r2
from app.services.patient_links import get_active_link, has_pending_consultations_between
from app.services.chat import is_professional_hidden_for_patient

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

    total_pagado = 0.0        # Dinero que efectivamente salió de su bolsillo y no volvió (ambos canales)
    total_pendiente = 0.0     # QR generado, esperando que pague o se confirme (solo plataforma)
    total_reembolsado = 0.0   # Le devolvieron el dinero (solo aplica al canal plataforma)
    total_en_disputa = 0.0    # Congelado mientras el admin resuelve un reclamo (solo plataforma)
    consultas_pagadas = 0
    # Desglose por canal — para diferenciar en la UI lo que pasó por la
    # plataforma (QR) de lo que el profesional cobra directo en efectivo
    # (agendamiento por membresía, ver PaymentChannel).
    total_pagado_plataforma = 0.0
    total_pagado_directo = 0.0
    total_pendiente_cobro_directo = 0.0  # el profesional aún no registra que cobró

    for p, c, prof in all_rows:
        amount = float(p.amount)
        is_directo = p.payment_channel == PaymentChannel.CASH
        if p.status in (PaymentStatus.CONFIRMED, PaymentStatus.RELEASED_TO_PROFESSIONAL):
            total_pagado += amount
            consultas_pagadas += 1
            if is_directo:
                total_pagado_directo += amount
            else:
                total_pagado_plataforma += amount
        elif p.status == PaymentStatus.PENDING:
            if is_directo:
                total_pendiente_cobro_directo += amount
            else:
                total_pendiente += amount
        elif p.status in (PaymentStatus.REFUNDED_FULL, PaymentStatus.REFUNDED_PARTIAL):
            refunded = float(p.refunded_amount) if p.refunded_amount is not None else amount
            total_reembolsado += refunded
            # Lo que sí quedó cobrado (monto original menos lo reembolsado) cuenta como pagado
            total_pagado += max(amount - refunded, 0.0)
            total_pagado_plataforma += max(amount - refunded, 0.0)
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
        # Desglose por canal (ver comentario arriba)
        "total_pagado_plataforma": round(total_pagado_plataforma, 2),
        "total_pagado_directo": round(total_pagado_directo, 2),
        "total_pendiente_cobro_directo": round(total_pendiente_cobro_directo, 2),
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
            "payment_channel": p.payment_channel,
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
            "created_by_role": c.created_by_role if c else None,
            "modality": c.modality if c else None,
        }
        for p, c, prof in rows
    ]

    return {"stats": stats, "items": items}

# ─────────────────────────────────────────────────────
# VÍNCULO "MIS PACIENTES" (PatientProfessionalLink)
# Solo el paciente crea y revoca. Ver app/services/patient_links.py.
# ─────────────────────────────────────────────────────

@router.post(
    "/links",
    response_model=PatientLinkResponse,
    summary="Vincularme a un profesional (para que me pueda agendar citas directamente)",
)
async def create_patient_link(
    data: PatientLinkCreateRequest,
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    prof_result = await db.execute(
        select(Professional).where(
            Professional.id == data.professional_id,
            Professional.status == ProfessionalStatus.APPROVED,
        )
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    if await is_professional_hidden_for_patient(db, professional.id, patient.id):
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    existing = await get_active_link(db, patient.id, professional.id)
    if existing:
        return PatientLinkResponse(
            id=existing.id, patient_id=existing.patient_id, professional_id=existing.professional_id,
            created_at=existing.created_at, revoked_at=existing.revoked_at,
            professional_first_name=professional.first_name, professional_last_name=professional.last_name,
            professional_photo_url=professional.photo_url, professional_specialty=professional.specialty,
        )

    link = PatientProfessionalLink(patient_id=patient.id, professional_id=professional.id)
    db.add(link)
    await db.commit()
    await db.refresh(link)

    return PatientLinkResponse(
        id=link.id, patient_id=link.patient_id, professional_id=link.professional_id,
        created_at=link.created_at, revoked_at=link.revoked_at,
        professional_first_name=professional.first_name, professional_last_name=professional.last_name,
        professional_photo_url=professional.photo_url, professional_specialty=professional.specialty,
    )


@router.get(
    "/links",
    response_model=list[PatientLinkResponse],
    summary="Listar mis vínculos activos con profesionales",
)
async def list_my_patient_links(
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    rows = (await db.execute(
        select(PatientProfessionalLink, Professional)
        .join(Professional, Professional.id == PatientProfessionalLink.professional_id)
        .where(
            PatientProfessionalLink.patient_id == patient.id,
            PatientProfessionalLink.revoked_at.is_(None),
        )
        .order_by(PatientProfessionalLink.created_at.desc())
    )).all()

    return [
        PatientLinkResponse(
            id=link.id, patient_id=link.patient_id, professional_id=link.professional_id,
            created_at=link.created_at, revoked_at=link.revoked_at,
            professional_first_name=prof.first_name, professional_last_name=prof.last_name,
            professional_photo_url=prof.photo_url, professional_specialty=prof.specialty,
        )
        for link, prof in rows
    ]


@router.delete(
    "/links/{professional_id}",
    summary="Desvincularme de un profesional (solo si no tengo citas activas pendientes con él)",
)
async def revoke_patient_link(
    professional_id: str,
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db),
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    link = await get_active_link(db, patient.id, professional_id)
    if not link:
        raise HTTPException(status_code=404, detail="No tienes un vínculo activo con este profesional")

    if await has_pending_consultations_between(db, patient.id, professional_id):
        raise HTTPException(
            status_code=409,
            detail="Tienes una cita agendada con este profesional. Complétala o cancélala antes de desvincularte.",
        )

    link.revoked_at = utcnow_naive()
    await db.commit()
    return {"detail": "Vínculo revocado"}


# ── GET /api/v1/patients/me/notifications ────────────
@router.get("/me/notifications", summary="Mis notificaciones (campanita)")
async def get_my_notifications(
    unread_only: bool = Query(False),
    current_user: User = Depends(get_current_patient),
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


# ── PATCH /api/v1/patients/me/notifications/{id}/read ─
@router.patch("/me/notifications/{notification_id}/read", summary="Marcar notificación como leída")
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import Notification
    result = await db.execute(
        select(Notification).where(
            and_(Notification.id == notification_id, Notification.user_id == current_user.id)
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")

    notif.read_at = utcnow_naive()
    await db.commit()
    return {"message": "Notificación marcada como leída"}


# ── PATCH /api/v1/patients/me/notifications/read-all ─
@router.patch("/me/notifications/read-all", summary="Marcar todas mis notificaciones como leídas")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import Notification
    result = await db.execute(
        select(Notification).where(
            and_(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        )
    )
    for n in result.scalars().all():
        n.read_at = utcnow_naive()
    await db.commit()
    return {"message": "Notificaciones marcadas como leídas"}


# ─────────────────────────────────────────────────────
# REEMBOLSOS (Fase 1 semi-automática) — cuenta PERMANENTE para recibir
# reembolsos, espejo exacto de la cuenta bancaria del profesional
# (ver GET/PUT /professionals/me/bank-account). El paciente la carga una
# sola vez en su Perfil; a partir de ahí, cualquier reembolso futuro
# entra directo a la cola de "listos para pagar" del admin en cuanto un
# admin la verifica — sin tener que completar nada de nuevo cada vez.
# Ver app/services/refund_payout.py para el flujo completo.
# ─────────────────────────────────────────────────────

# ── GET /api/v1/patients/me/refund-account ───────────
# Nunca devuelve el número completo, solo los últimos 4 dígitos para
# mostrar "****1234" en pantalla (mismo criterio que el profesional).
@router.get("/me/refund-account", summary="Mi cuenta para recibir reembolsos")
async def get_my_refund_account(
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import PatientRefundAccount

    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    result = await db.execute(
        select(PatientRefundAccount).where(PatientRefundAccount.patient_id == patient.id)
    )
    account = result.scalar_one_or_none()
    if not account:
        return None

    return {
        "method": account.method,
        "bank_name": account.bank_name,
        "account_type": account.account_type,
        "account_number_masked": f"****{account.account_number_last4}" if account.account_number_last4 else None,
        "account_holder_name": account.account_holder_name,
        "wallet_provider": account.wallet_provider,
        "phone_number": account.phone_number,
        "verified": account.verified,
        "verified_at": account.verified_at.isoformat() if account.verified_at else None,
        "updated_at": account.updated_at.isoformat() if account.updated_at else None,
    }


# ── PUT /api/v1/patients/me/refund-account ───────────
# Alta o edición (siempre reemplaza — una sola cuenta activa por
# paciente, igual que el profesional). Cada guardado vuelve
# verified=False: un admin tiene que revisarla de nuevo antes de que el
# próximo reembolso entre en la cola de "listos para pagar".
@router.put("/me/refund-account", summary="Registrar o actualizar mi cuenta para recibir reembolsos")
async def upsert_my_refund_account(
    data: PatientRefundAccountRequest,
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import PatientRefundAccount, RefundMethod
    from app.core.crypto import encrypt_value

    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    result = await db.execute(
        select(PatientRefundAccount).where(PatientRefundAccount.patient_id == patient.id)
    )
    account = result.scalar_one_or_none()
    is_new = account is None
    if account is None:
        account = PatientRefundAccount(patient_id=patient.id)
        db.add(account)

    account.method = RefundMethod(data.method)
    account.responsibility_acknowledged_at = utcnow_naive()
    account.verified = False
    account.verified_at = None
    account.verified_by = None

    if data.method == "BANK":
        account.bank_name = data.bank_name.strip()
        account.account_type = data.account_type
        account.account_number_encrypted = encrypt_value(data.account_number)
        account.account_number_last4 = data.account_number[-4:]
        account.account_holder_name = data.account_holder_name.strip()
        account.account_holder_ci_encrypted = encrypt_value(data.account_holder_ci)
        account.wallet_provider = None
        account.phone_number = None
    else:
        account.wallet_provider = data.wallet_provider.strip()
        account.phone_number = data.phone_number
        account.bank_name = None
        account.account_type = None
        account.account_number_encrypted = None
        account.account_number_last4 = None
        account.account_holder_name = None
        account.account_holder_ci_encrypted = None

    await db.flush()

    db.add(AuditLog(
        user_id=current_user.id,
        action="REFUND_ACCOUNT_CREATED" if is_new else "REFUND_ACCOUNT_UPDATED",
        entity_type="PatientRefundAccount",
        entity_id=account.id,
        metadata_={"method": data.method},
    ))

    await db.commit()
    return {
        "message": "Cuenta guardada. Un administrador la revisará antes de procesar tu próximo reembolso.",
        "verified": False,
    }


# ── GET /api/v1/patients/me/refunds ──────────────────
# Reembolsos aprobados (por un admin o automáticamente al cancelar una
# cita) que todavía no se transfirieron de verdad — solo informativo,
# para que el paciente vea el estado; ya no hace falta que actúe sobre
# cada uno si tiene su cuenta de reembolso cargada y verificada.
@router.get("/me/refunds", summary="Mis reembolsos aprobados pendientes de cobrar")
async def get_my_pending_refunds(
    current_user: User = Depends(get_current_patient),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    result = await db.execute(
        select(Payment, Consultation, Professional)
        .join(Consultation, Payment.consultation_id == Consultation.id, isouter=True)
        .join(Professional, Consultation.professional_id == Professional.id, isouter=True)
        .where(
            Payment.patient_id == patient.id,
            Payment.status.in_([PaymentStatus.REFUNDED_FULL, PaymentStatus.REFUNDED_PARTIAL]),
            Payment.refund_paid_out_at.is_(None),
        )
        .order_by(Payment.refunded_at.desc())
    )
    rows = result.all()

    return [
        {
            "payment_id": p.id,
            "consultation_id": p.consultation_id,
            "amount": float(p.refunded_amount) if p.refunded_amount is not None else float(p.amount),
            "refunded_at": p.refunded_at.isoformat() if p.refunded_at else None,
            "refund_note": p.refund_note,
            "specialty": c.specialty if c else None,
            "professional_first_name": prof.first_name if prof else None,
            "professional_last_name": prof.last_name if prof else None,
        }
        for p, c, prof in rows
    ]
