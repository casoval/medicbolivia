"""
app/api/v1/endpoints/admin.py
Endpoints del panel de administración.
Requieren rol ADMIN.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import Optional
from datetime import datetime, timedelta
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.models.models import (
    User, Patient, Professional, Consultation, Payment,
    ProfessionalDoc, AuditLog, AgentLog,
    ProfessionalStatus, ConsultationStatus, PaymentStatus, DocStatus, UserStatus
)
from app.schemas.schemas import DocReviewRequest, RefundRequest
from app.services.payment import process_refund

router = APIRouter()


# ── GET /api/v1/admin/stats ──────────────────────────
@router.get("/stats", summary="Estadísticas globales de la plataforma")
async def get_stats(
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    # Totales
    total_patients = (await db.execute(
        select(func.count(Patient.id))
    )).scalar_one()

    total_professionals = (await db.execute(
        select(func.count(Professional.id)).where(Professional.status == ProfessionalStatus.APPROVED)
    )).scalar_one()

    pending_professionals = (await db.execute(
        select(func.count(Professional.id)).where(
            Professional.status.in_([ProfessionalStatus.PENDING_DOCS, ProfessionalStatus.UNDER_REVIEW])
        )
    )).scalar_one()

    # Consultas del mes actual
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)
    monthly_consultations = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.created_at >= month_start
        )
    )).scalar_one()

    # Ingresos del mes (pagos confirmados o liberados)
    monthly_revenue = (await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            and_(
                Payment.created_at >= month_start,
                Payment.status.in_([PaymentStatus.CONFIRMED, PaymentStatus.RELEASED_TO_PROFESSIONAL])
            )
        )
    )).scalar_one()

    # Consultas activas ahora mismo
    active_now = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.status == ConsultationStatus.IN_PROGRESS
        )
    )).scalar_one()

    waiting_payment = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.status == ConsultationStatus.WAITING_PAYMENT
        )
    )).scalar_one()

    waiting_professional = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL
        )
    )).scalar_one()

    # Stats del agente IA
    agent_sessions_month = (await db.execute(
        select(func.count(AgentLog.id)).where(
            AgentLog.created_at >= month_start
        )
    )).scalar_one()

    return {
        "patients":              total_patients,
        "professionals_active":  total_professionals,
        "professionals_pending": pending_professionals,
        "monthly_consultations": monthly_consultations,
        "monthly_revenue":       float(monthly_revenue),
        "platform_fee_month":    float(monthly_revenue) * 0.15,
        "active_now":            active_now,
        "waiting_payment":       waiting_payment,
        "waiting_professional":  waiting_professional,
        "agent_sessions_month":  agent_sessions_month,
    }


# ── GET /api/v1/admin/professionals ─────────────────
@router.get("/professionals", summary="Listar todos los profesionales")
async def list_all_professionals(
    status: Optional[str] = Query(None),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    query = select(Professional, User).join(User, Professional.user_id == User.id)
    if status:
        query = query.where(Professional.status == ProfessionalStatus(status))
    query = query.order_by(Professional.created_at.desc())
    result = await db.execute(query)
    rows = result.all()
    return [
        {
            "id":                  p.id,
            "name":                f"{p.first_name} {p.last_name}",
            "specialty":           p.specialty,
            "sub_specialties":     p.sub_specialties or [],
            "status":              p.status,
            "availability":        p.availability,
            "rating":              float(p.average_rating),
            "total_ratings":       p.total_ratings,
            "total_consultations": p.total_consultations,
            "created_at":          p.created_at.isoformat(),
            # Datos del perfil
            "bio":                 p.bio,
            "languages":           p.languages or ["Español"],
            "years_experience":    p.years_experience,
            "cmb_matricula":       p.cmb_matricula,
            "sedes_number":        p.sedes_number,
            "price_general":       float(p.price_general),
            "price_urgent":        float(p.price_urgent),
            "price_follow_up":     float(p.price_follow_up),
            # Datos personales completos
            "phone":               u.phone,
            "email":               u.email,
            "ci":                  p.ci,
            "birth_date":          p.birth_date.isoformat() if p.birth_date else None,
            "department":          p.department,
            "gender":              p.gender,
            "user_status":         u.status.value,
        }
        for p, u in rows
    ]


# ── GET /api/v1/admin/professionals/{id}/documents ──
@router.get("/professionals/{professional_id}/documents", summary="Ver documentos de un profesional")
async def get_professional_documents(
    professional_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ProfessionalDoc).where(ProfessionalDoc.professional_id == professional_id)
    )
    docs = result.scalars().all()
    # En producción generar URLs presignadas de S3
    from app.services.storage import get_presigned_url
    doc_list = []
    for d in docs:
        try:
            url = await get_presigned_url(d.file_url) if d.file_url.startswith("s3://") else d.file_url
        except:
            url = d.file_url
        doc_list.append({
            "id":         d.id,
            "doc_type":   d.doc_type,
            "status":     d.status,
            "url":        url,
            "review_note":d.review_note,
            "reviewed_at":d.reviewed_at.isoformat() if d.reviewed_at else None,
            "created_at": d.created_at.isoformat(),
        })
    return doc_list


# ── PATCH /api/v1/admin/documents/{id}/review ───────
@router.patch("/documents/{doc_id}/review", summary="Aprobar o rechazar un documento")
async def review_document(
    doc_id: str,
    data: DocReviewRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(ProfessionalDoc).where(ProfessionalDoc.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    doc.status = data.status
    doc.review_note = data.review_note
    doc.reviewed_at = datetime.utcnow()
    doc.reviewed_by = current_user.id

    # Si todos los documentos del profesional están aprobados → aprobar profesional
    if data.status == DocStatus.APPROVED:
        all_docs = (await db.execute(
            select(ProfessionalDoc).where(ProfessionalDoc.professional_id == doc.professional_id)
        )).scalars().all()

        required = {'CI_FRONT', 'CI_BACK', 'PROFESSIONAL_TITLE', 'SEDES_REGISTRATION', 'CMB_MATRICULA'}
        approved_types = {d.doc_type.value for d in all_docs if d.status == DocStatus.APPROVED}

        if required.issubset(approved_types):
            prof_result = await db.execute(
                select(Professional).where(Professional.id == doc.professional_id)
            )
            prof = prof_result.scalar_one_or_none()
            if prof:
                prof.status = ProfessionalStatus.APPROVED
                user_result = await db.execute(select(User).where(User.id == prof.user_id))
                user = user_result.scalar_one_or_none()
                if user:
                    user.status = UserStatus.ACTIVE
                logger.info(f"Profesional aprobado automáticamente: {prof.id}")

    # Auditoría
    log = AuditLog(
        user_id=current_user.id,
        action=f"DOC_{data.status}",
        entity_type="ProfessionalDoc",
        entity_id=doc_id,
        metadata_={"review_note": data.review_note},
    )
    db.add(log)
    await db.commit()

    return {"doc_id": doc_id, "status": data.status, "message": f"Documento {data.status.lower()}"}


# ── GET /api/v1/admin/payments ───────────────────────
@router.get("/payments", summary="Transacciones de pago")
async def list_payments(
    limit: int = Query(50, le=200),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Payment)
        .order_by(Payment.created_at.desc())
        .limit(limit)
    )
    payments = result.scalars().all()
    return [
        {
            "id":              p.id,
            "consultation_id": p.consultation_id,
            "amount":          float(p.amount),
            "platform_fee":    float(p.platform_fee),
            "professional_net":float(p.professional_net),
            "bank_name":       p.bank_name,
            "bank_tx_id":      p.bank_tx_id,
            "status":          p.status,
            "paid_at":         p.paid_at.isoformat() if p.paid_at else None,
            "created_at":      p.created_at.isoformat(),
        }
        for p in payments
    ]


# ── POST /api/v1/admin/payments/{id}/refund ─────────
@router.post("/payments/{payment_id}/refund", summary="Procesar reembolso")
async def refund_payment(
    payment_id: str,
    data: RefundRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Payment).where(Payment.id == payment_id))
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")

    if payment.status not in [PaymentStatus.CONFIRMED, PaymentStatus.RELEASED_TO_PROFESSIONAL]:
        raise HTTPException(status_code=400, detail="Este pago no puede ser reembolsado en su estado actual")

    refund_status = PaymentStatus.REFUNDED_FULL if data.refund_type == "FULL" else PaymentStatus.REFUNDED_PARTIAL
    payment.status = refund_status
    payment.refunded_at = datetime.utcnow()
    payment.refund_note = data.reason

    log = AuditLog(
        user_id=current_user.id,
        action=f"REFUND_{data.refund_type}",
        entity_type="Payment",
        entity_id=payment_id,
        metadata_={"reason": data.reason, "amount": str(payment.amount)},
    )
    db.add(log)
    await db.commit()

    logger.info(f"Reembolso {data.refund_type}: pago {payment_id} por admin {current_user.id}")
    return {"payment_id": payment_id, "status": refund_status, "message": "Reembolso procesado"}


# ── GET /api/v1/admin/logs ───────────────────────────
@router.get("/logs", summary="Registro de auditoría")
async def get_audit_logs(
    limit: int = Query(100, le=500),
    action: Optional[str] = None,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    result = await db.execute(query)
    logs = result.scalars().all()
    return [
        {
            "id":          l.id,
            "user_id":     l.user_id,
            "action":      l.action,
            "entity_type": l.entity_type,
            "entity_id":   l.entity_id,
            "metadata":    l.metadata_,
            "ip_address":  l.ip_address,
            "created_at":  l.created_at.isoformat(),
        }
        for l in logs
    ]


# ── GET /api/v1/admin/agent-stats ────────────────────
@router.get("/agent-stats", summary="Estadísticas del agente IA")
async def get_agent_stats(
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)

    total_sessions = (await db.execute(
        select(func.count(AgentLog.id)).where(AgentLog.created_at >= month_start)
    )).scalar_one()

    avg_latency = (await db.execute(
        select(func.avg(AgentLog.latency_ms)).where(
            and_(AgentLog.created_at >= month_start, AgentLog.latency_ms.isnot(None))
        )
    )).scalar_one()

    total_tokens = (await db.execute(
        select(func.coalesce(func.sum(AgentLog.tokens_used), 0)).where(
            AgentLog.created_at >= month_start
        )
    )).scalar_one()

    guardrail_triggers = (await db.execute(
        select(func.count(AgentLog.id)).where(
            and_(AgentLog.created_at >= month_start, AgentLog.guardrail_triggered == True)
        )
    )).scalar_one()

    return {
        "total_sessions":     total_sessions,
        "avg_latency_ms":     round(float(avg_latency or 0)),
        "total_tokens_month": int(total_tokens),
        "guardrail_triggers": guardrail_triggers,
    }


# ── GET /api/v1/admin/patients ───────────────────────
@router.get("/patients", summary="Listar todos los pacientes")
async def list_patients(
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    from app.models.models import Patient as PatientModel
    result = await db.execute(
        select(PatientModel, User)
        .join(User, PatientModel.user_id == User.id)
        .order_by(PatientModel.created_at.desc())
    )
    rows = result.all()

    patients_list = []
    for patient, user in rows:
        cons_count = await db.execute(
            select(func.count(Consultation.id)).where(
                Consultation.patient_id == patient.id
            )
        )
        total_cons = cons_count.scalar_one()

        patients_list.append({
            "id":                  patient.id,
            "user_id":             patient.user_id,
            "first_name":          patient.first_name,
            "last_name":           patient.last_name,
            "ci":                  patient.ci,
            "birth_date":          patient.birth_date.isoformat() if patient.birth_date else None,
            "department":          patient.department,
            "gender":              patient.gender,
            "allergies":           patient.allergies or [],
            "chronic_conditions":  patient.chronic_conditions or [],
            "current_medications": patient.current_medications or [],
            "phone":               user.phone,
            "email":               user.email,
            "status":              user.status.value,
            "created_at":          patient.created_at.isoformat(),
            "total_consultations": total_cons,
        })

    return patients_list


# ── PATCH /api/v1/admin/patients/{user_id}/suspend ───
@router.patch("/patients/{user_id}/suspend", summary="Suspender cuenta de paciente")
async def suspend_patient(
    user_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    user.status = UserStatus.SUSPENDED
    log = AuditLog(
        user_id=current_user.id,
        action="PATIENT_SUSPENDED",
        entity_type="User",
        entity_id=user_id,
    )
    db.add(log)
    await db.commit()
    logger.info(f"Paciente suspendido: {user_id} por admin {current_user.id}")
    return {"message": "Cuenta suspendida", "user_id": user_id}


# ── PATCH /api/v1/admin/patients/{user_id}/reactivate ─
@router.patch("/patients/{user_id}/reactivate", summary="Reactivar cuenta de paciente")
async def reactivate_patient(
    user_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    user.status = UserStatus.ACTIVE
    log = AuditLog(
        user_id=current_user.id,
        action="PATIENT_REACTIVATED",
        entity_type="User",
        entity_id=user_id,
    )
    db.add(log)
    await db.commit()
    logger.info(f"Paciente reactivado: {user_id} por admin {current_user.id}")
    return {"message": "Cuenta reactivada", "user_id": user_id}
