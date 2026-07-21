"""
app/api/v1/endpoints/admin.py
Endpoints del panel de administración.
Requieren rol ADMIN.
"""
import base64
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from loguru import logger

from app.core.timezone import bolivia_today_midnight_naive, bolivia_now_naive, as_bolivia_calendar_day

from pydantic import BaseModel, Field

from app.db.database import get_db
from app.core.dependencies import get_current_admin
from app.core.maintenance import is_maintenance_active, set_platform_flags
from decimal import Decimal

from app.models.models import (
    User, Patient, Professional, Consultation, Payment,
    ProfessionalDoc, AuditLog, AgentLog, Notification, PlatformSettings,
    ProfessionalStatus, ConsultationStatus, ConsultationType, PaymentStatus, DocStatus, UserStatus,
    Rating, ClinicalNote, ProfessionalPenaltyReset, Earning, Prescription,
    CommissionPeriod, CommissionScope, ProfessionalMembership,
    ChatBlock, ProfessionalPatientVisibility, ChatConversation, AdminAccessLog, PaymentChannel,
    DoctorLead, DoctorLeadStatus, DoctorLeadSource, WhatsAppMessage,
)
from app.schemas.schemas import (
    DocReviewRequest, RefundRequest, DisputeResolveRequest,
    ProfessionalMembershipCreateRequest, ProfessionalMembershipUpdateRequest,
    ProfessionalMembershipRenewRequest, BroadcastCreateRequest,
    DoctorLeadCreateRequest, DoctorLeadUpdateRequest, DoctorLeadInviteRequest,
)
from app.services.payment import process_refund
from app.services.commission import get_professional_commission_summary
from app.services.broadcast import send_broadcast, count_recipients
from app.models.models import BroadcastMessage, BroadcastAudience
from app.services import google_places
from app.core.phone import normalize_bo_phone, InvalidPhoneError
from app.tasks.whatsapp_tasks import send_whatsapp_message, send_whatsapp_document
from app.services import invitation_pdf
from app.models.models import WhatsAppAudience
from app.core.config import settings

router = APIRouter()


# ── Sistema de penalizaciones por semáforo (solo visible para admin) ──
# Cuenta TODO el historial del profesional (no una ventana de días fija).
# Si el admin considera que ya se corrigió, puede usar "Limpiar
# penalizaciones" — eso registra un reset_at y desde ahí el puntaje
# vuelve a empezar de cero, sin borrar el historial de consultas.

# Peso de cada tipo de infracción al sumar el puntaje total.
PENALTY_WEIGHTS = {
    "no_show":               4,  # no asistió a una consulta programada
    "immediate_rejected":    2,  # rechazó (o dejó expirar) una consulta inmediata estando disponible
    "late_cancel":           2,  # canceló una consulta ya confirmada, con reembolso al paciente
    "missing_clinical_note": 1,  # completó la consulta sin dejar historia clínica
    "low_rating":            1,  # calificación de 1 o 2 estrellas del paciente
}

# outcome_note (ver models.Consultation) que cuentan para cada categoría
_NO_SHOW_NOTES        = ("PROFESSIONAL_NO_SHOW",)
_IMMEDIATE_REJECT_NOTES = ("REJECTED_BY_PROFESSIONAL", "AUTO_TIMEOUT_PROFESSIONAL", "AUTO_TIMEOUT_PROFESSIONAL_PAID")
_LATE_CANCEL_NOTES    = ("PROFESSIONAL_CANCELLED_WITH_REFUND",)


def _penalty_color(score: int) -> Optional[str]:
    """🟡 amarillo (leve) · 🟠 naranja (moderado) · 🔴 rojo (grave) · None si no hay penalización."""
    if score >= 10:
        return "red"
    if score >= 5:
        return "orange"
    if score >= 1:
        return "yellow"
    return None


# ── Schema de configuración (no está en schemas.py para no tocar ese archivo) ──
class PlatformSettingsUpdate(BaseModel):
    app_name: Optional[str] = Field(None, min_length=1, max_length=100)
    commission_percent: Optional[int] = Field(None, ge=0, le=30)
    open_registration_patients: Optional[bool] = None
    open_registration_professionals: Optional[bool] = None
    maintenance_mode: Optional[bool] = None
    # ── Chat interno ──────────────────────────────────
    # Aplica solo a consultas NUEVAS creadas a partir de este cambio
    # (ver Consultation.chat_window_days_snapshot); no recalcula
    # conversaciones ya activas o cerradas.
    chat_window_days: Optional[int] = Field(None, ge=1, le=90)
    chat_attachments_enabled_patient: Optional[bool] = None
    chat_attachments_enabled_professional: Optional[bool] = None


async def _get_or_create_settings(db: AsyncSession) -> PlatformSettings:
    result = await db.execute(select(PlatformSettings).where(PlatformSettings.id == "global"))
    row = result.scalar_one_or_none()
    if not row:
        row = PlatformSettings(id="global")
        db.add(row)
        await db.commit()
        await db.refresh(row)
        logger.info("Configuración de plataforma creada con valores por defecto")
    return row


def _settings_to_dict(s: PlatformSettings) -> dict:
    return {
        "app_name":                          s.app_name,
        "commission_percent":                s.commission_percent,
        "open_registration_patients":        s.open_registration_patients,
        "open_registration_professionals":   s.open_registration_professionals,
        "maintenance_mode":                  s.maintenance_mode,
        "chat_window_days":                  s.chat_window_days,
        "chat_attachments_enabled_patient":       s.chat_attachments_enabled_patient,
        "chat_attachments_enabled_professional":  s.chat_attachments_enabled_professional,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


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

    # ── Citas agendadas: pendientes, no-shows y cancelaciones del mes ──
    scheduled_pending = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.consultation_type == ConsultationType.SCHEDULED,
            Consultation.status.in_([
                ConsultationStatus.WAITING_PROFESSIONAL,
                ConsultationStatus.WAITING_PAYMENT,
                ConsultationStatus.PAYMENT_CONFIRMED,
            ]),
        )
    )).scalar_one()

    no_show_patient_month = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.outcome_note == "PATIENT_NO_SHOW",
            Consultation.created_at >= month_start,
        )
    )).scalar_one()

    no_show_professional_month = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.outcome_note == "PROFESSIONAL_NO_SHOW",
            Consultation.created_at >= month_start,
        )
    )).scalar_one()

    cancelled_with_refund_month = (await db.execute(
        select(func.count(Consultation.id)).where(
            Consultation.outcome_note == "CANCELLED_24H_NOTICE",
            Consultation.created_at >= month_start,
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
        # Citas agendadas
        "scheduled_pending":             scheduled_pending,
        "no_show_patient_month":         no_show_patient_month,
        "no_show_professional_month":    no_show_professional_month,
        "cancelled_with_refund_month":   cancelled_with_refund_month,
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

    # Conteo de documentos por profesional y por estado, en una sola consulta agregada
    # (evita N+1: una query por cada fila de la tabla en vez de una por profesional)
    doc_counts_result = await db.execute(
        select(
            ProfessionalDoc.professional_id,
            ProfessionalDoc.status,
            func.count(ProfessionalDoc.id),
        ).group_by(ProfessionalDoc.professional_id, ProfessionalDoc.status)
    )
    doc_counts: dict[str, dict[str, int]] = {}
    for prof_id, doc_status, count in doc_counts_result.all():
        doc_counts.setdefault(prof_id, {})[doc_status.value] = count

    def counts_for(prof_id: str) -> dict:
        c = doc_counts.get(prof_id, {})
        return {
            "pending":  c.get("PENDING", 0),
            "approved": c.get("APPROVED", 0),
            "rejected": c.get("REJECTED", 0),
            "total":    sum(c.values()),
        }

    # ── Puntaje de penalización (histórico completo, salvo reset manual) ──
    resets_result = await db.execute(select(ProfessionalPenaltyReset))
    reset_at_by_prof = {r.professional_id: r.reset_at for r in resets_result.scalars().all()}

    def _since(prof_id: str) -> datetime:
        return reset_at_by_prof.get(prof_id, datetime.min)

    # outcome_note — cubre no-show, rechazos de consulta inmediata y
    # cancelaciones tardías. Traemos las filas crudas (sin agrupar en SQL)
    # para poder aplicar el corte de reset por profesional en Python.
    outcome_rows = await db.execute(
        select(Consultation.professional_id, Consultation.outcome_note, Consultation.created_at)
        .where(
            Consultation.professional_id.isnot(None),
            Consultation.outcome_note.in_(_NO_SHOW_NOTES + _IMMEDIATE_REJECT_NOTES + _LATE_CANCEL_NOTES),
        )
    )
    penalty_events: dict[str, dict[str, int]] = {}
    for prof_id, note, created_at in outcome_rows.all():
        if created_at < _since(prof_id):
            continue
        bucket = penalty_events.setdefault(prof_id, {"no_show": 0, "immediate_rejected": 0, "late_cancel": 0, "missing_clinical_note": 0, "low_rating": 0})
        if note in _NO_SHOW_NOTES:
            bucket["no_show"] += 1
        elif note in _IMMEDIATE_REJECT_NOTES:
            bucket["immediate_rejected"] += 1
        elif note in _LATE_CANCEL_NOTES:
            bucket["late_cancel"] += 1

    # Consultas completadas sin historia clínica asociada
    missing_notes_rows = await db.execute(
        select(Consultation.professional_id, Consultation.created_at)
        .outerjoin(ClinicalNote, ClinicalNote.consultation_id == Consultation.id)
        .where(
            Consultation.status == ConsultationStatus.COMPLETED,
            Consultation.professional_id.isnot(None),
            ClinicalNote.id.is_(None),
        )
    )
    for prof_id, created_at in missing_notes_rows.all():
        if created_at < _since(prof_id):
            continue
        penalty_events.setdefault(prof_id, {"no_show": 0, "immediate_rejected": 0, "late_cancel": 0, "missing_clinical_note": 0, "low_rating": 0})["missing_clinical_note"] += 1

    # Calificaciones bajas (1-2 estrellas)
    low_rating_rows = await db.execute(
        select(Rating.professional_id, Rating.created_at).where(Rating.score <= 2)
    )
    for prof_id, created_at in low_rating_rows.all():
        if created_at < _since(prof_id):
            continue
        penalty_events.setdefault(prof_id, {"no_show": 0, "immediate_rejected": 0, "late_cancel": 0, "missing_clinical_note": 0, "low_rating": 0})["low_rating"] += 1

    def penalty_for(prof_id: str) -> dict:
        breakdown = penalty_events.get(prof_id, {"no_show": 0, "immediate_rejected": 0, "late_cancel": 0, "missing_clinical_note": 0, "low_rating": 0})
        score = sum(breakdown[k] * PENALTY_WEIGHTS[k] for k in PENALTY_WEIGHTS)
        reset_at = reset_at_by_prof.get(prof_id)
        return {
            "score": score,
            "color": _penalty_color(score),
            "breakdown": breakdown,
            "since": reset_at.isoformat() if reset_at else None,  # None = todo el historial
        }

    return [
        {
            "id":                  p.id,
            "name":                f"{p.first_name} {p.last_name}",
            "specialty":           p.specialty,
            "sub_specialties":     p.sub_specialties or [],
            "status":              p.status,
            "availability":        p.availability,
            "auto_availability":   p.auto_availability,
            "appointment_duration_minutes": p.appointment_duration_minutes,
            "rating":              float(p.average_rating),
            "total_ratings":       p.total_ratings,
            "total_consultations": p.total_consultations,
            "created_at":          p.created_at.isoformat(),
            "photo_url":           p.photo_url,
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
            # Documentos: para mostrar indicador en la tarjeta del admin
            "doc_counts":          counts_for(p.id),
            # Penalizaciones: semáforo de comportamiento (solo admin)
            "penalty":             penalty_for(p.id),
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
    from app.services.storage import get_presigned_url
    doc_list = []
    for d in docs:
        try:
            is_remote = d.file_url.startswith("r2://") or d.file_url.startswith("s3://")
            url = await get_presigned_url(d.file_url) if is_remote else d.file_url
        except Exception as e:
            logger.error(f"No se pudo firmar URL del documento {d.id}: {e}")
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


# ── Historial detallado (consultas, recetas, historias clínicas, pagos) ──
# Usado tanto para profesionales como para pacientes: el admin necesita ver
# TODO sin restricciones de privacidad (esas restricciones son entre
# paciente/profesional, no aplican a soporte/admin resolviendo una queja).
def _serialize_consultation_history(consultations, notes_by_consult: dict, counterpart_key: str) -> list[dict]:
    history = []
    for c in consultations:
        counterpart = c.patient if counterpart_key == "patient" else c.professional
        counterpart_name = f"{counterpart.first_name} {counterpart.last_name}" if counterpart else "N/D"
        note = notes_by_consult.get(c.id)
        payment = c.payment
        history.append({
            "id":                  c.id,
            "consultation_type":   c.consultation_type,
            "status":              c.status,
            "specialty":           c.specialty,
            "chief_complaint":     c.chief_complaint,
            "outcome_note":        c.outcome_note,
            "scheduled_at":        c.scheduled_at.isoformat() if c.scheduled_at else None,
            "started_at":          c.started_at.isoformat() if c.started_at else None,
            "ended_at":            c.ended_at.isoformat() if c.ended_at else None,
            "duration_minutes":    c.duration_minutes,
            "created_at":          c.created_at.isoformat(),
            "amount":              float(c.amount),
            counterpart_key + "_name": counterpart_name,
            "payment": {
                "status":      payment.status,
                "paid_at":     payment.paid_at.isoformat() if payment.paid_at else None,
                "bank_tx_id":  payment.bank_tx_id,
                "refunded_at": payment.refunded_at.isoformat() if payment.refunded_at else None,
                "refund_note": payment.refund_note,
            } if payment else None,
            "prescriptions": [
                {
                    "id":           rx.id,
                    "medications":  rx.medications,
                    "instructions": rx.instructions,
                    "status":       rx.status,
                    "signed_at":    rx.signed_at.isoformat() if rx.signed_at else None,
                    "void_reason":  rx.void_reason,
                    "pdf_url":      rx.pdf_url,
                }
                for rx in (c.prescriptions or [])
            ],
            "clinical_note": {
                "subjective":               note.subjective,
                "objective":                note.objective,
                "assessment":               note.assessment,
                "plan":                     note.plan,
                "is_visible_to_patient":    note.is_visible_to_patient,
                "shared_with_professionals":note.shared_with_professionals,
                "created_at":               note.created_at.isoformat(),
                "updated_at":               note.updated_at.isoformat(),
            } if note else None,
            "rating": {
                "score":      c.rating.score,
                "comment":    c.rating.comment,
                "created_at": c.rating.created_at.isoformat(),
            } if c.rating else None,
        })
    return history


# ── GET /api/v1/admin/professionals/{id}/history ──
@router.get("/professionals/{professional_id}/history", summary="Historial detallado de un profesional")
async def get_professional_history(
    professional_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    prof = await db.get(Professional, professional_id)
    if not prof:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    result = await db.execute(
        select(Consultation)
        .options(
            selectinload(Consultation.patient),
            selectinload(Consultation.payment),
            selectinload(Consultation.prescriptions),
            selectinload(Consultation.rating),
        )
        .where(Consultation.professional_id == professional_id)
        .order_by(Consultation.created_at.desc())
    )
    consultations = result.scalars().all()

    consult_ids = [c.id for c in consultations]
    notes_result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.consultation_id.in_(consult_ids))
    ) if consult_ids else None
    notes_by_consult = {n.consultation_id: n for n in notes_result.scalars().all()} if notes_result else {}

    return _serialize_consultation_history(consultations, notes_by_consult, "patient")


# ── GET /api/v1/admin/professionals/{id}/penalty-detail ──
# Detalle de EXACTAMENTE qué consultas están generando la penalización,
# para que el admin no tenga que confiar solo en el número.
@router.get("/professionals/{professional_id}/penalty-detail", summary="Detalle de consultas penalizadas de un profesional")
async def get_professional_penalty_detail(
    professional_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    prof = await db.get(Professional, professional_id)
    if not prof:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    reset_row = await db.get(ProfessionalPenaltyReset, professional_id)
    since = reset_row.reset_at if reset_row else datetime.min

    result = await db.execute(
        select(Consultation)
        .options(selectinload(Consultation.patient), selectinload(Consultation.rating))
        .where(Consultation.professional_id == professional_id, Consultation.created_at >= since)
        .order_by(Consultation.created_at.desc())
    )
    consultations = result.scalars().all()

    consult_ids = [c.id for c in consultations]
    notes_result = await db.execute(
        select(ClinicalNote.consultation_id).where(ClinicalNote.consultation_id.in_(consult_ids))
    ) if consult_ids else None
    has_note = {row[0] for row in notes_result.all()} if notes_result else set()

    REASON_LABELS = {
        "no_show":               "No asistió (consulta programada)",
        "immediate_rejected":    "Rechazó/expiró consulta inmediata",
        "late_cancel":           "Canceló con reembolso al paciente",
        "missing_clinical_note": "Completada sin historia clínica",
        "low_rating":            "Calificación baja del paciente",
    }

    items = []
    for c in consultations:
        reasons = []
        if c.outcome_note in _NO_SHOW_NOTES:
            reasons.append("no_show")
        elif c.outcome_note in _IMMEDIATE_REJECT_NOTES:
            reasons.append("immediate_rejected")
        elif c.outcome_note in _LATE_CANCEL_NOTES:
            reasons.append("late_cancel")
        if c.status == ConsultationStatus.COMPLETED and c.id not in has_note:
            reasons.append("missing_clinical_note")
        if c.rating and c.rating.score <= 2:
            reasons.append("low_rating")

        for reason in reasons:
            patient_name = f"{c.patient.first_name} {c.patient.last_name}" if c.patient else "N/D"
            items.append({
                "consultation_id": c.id,
                "date":            c.created_at.isoformat(),
                "patient_name":    patient_name,
                "reason":          reason,
                "reason_label":    REASON_LABELS[reason],
                "weight":          PENALTY_WEIGHTS[reason],
            })

    items.sort(key=lambda i: i["date"], reverse=True)
    return {
        "since": since.isoformat() if reset_row else None,
        "items": items,
    }


# ── POST /api/v1/admin/professionals/{id}/reset-penalties ──
# "Limpiar penalizaciones": las consultas anteriores a este momento dejan
# de contar. No se borra ni se altera ninguna consulta — es reversible
# en el sentido de que el historial real sigue intacto, solo cambia el
# punto de corte desde el que se calcula el puntaje.
@router.post("/professionals/{professional_id}/reset-penalties", summary="Limpiar el puntaje de penalización de un profesional")
async def reset_professional_penalties(
    professional_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    prof = await db.get(Professional, professional_id)
    if not prof:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    reset_row = await db.get(ProfessionalPenaltyReset, professional_id)
    now = datetime.utcnow()
    if reset_row:
        reset_row.reset_at = now
        reset_row.reset_by_admin_id = current_user.id
    else:
        db.add(ProfessionalPenaltyReset(professional_id=professional_id, reset_at=now, reset_by_admin_id=current_user.id))

    await db.commit()
    return {"ok": True, "reset_at": now.isoformat()}


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

    prof_result = await db.execute(
        select(Professional).where(Professional.id == doc.professional_id)
    )
    professional = prof_result.scalar_one_or_none()

    doc_label = doc.doc_type.value.replace("_", " ").title()
    professional_approved_now = False

    # Si todos los documentos del profesional están aprobados → aprobar profesional
    if data.status == DocStatus.APPROVED:
        all_docs = (await db.execute(
            select(ProfessionalDoc).where(ProfessionalDoc.professional_id == doc.professional_id)
        )).scalars().all()

        required = {'CI_FRONT', 'CI_BACK', 'PROFESSIONAL_TITLE', 'SEDES_REGISTRATION', 'CMB_MATRICULA'}
        approved_types = {d.doc_type.value for d in all_docs if d.status == DocStatus.APPROVED}

        if required.issubset(approved_types) and professional:
            professional.status = ProfessionalStatus.APPROVED
            user_result = await db.execute(select(User).where(User.id == professional.user_id))
            user = user_result.scalar_one_or_none()
            if user:
                user.status = UserStatus.ACTIVE
            professional_approved_now = True
            logger.info(f"Profesional aprobado automáticamente: {professional.id}")

    # Notificación in-app al profesional
    if professional:
        if data.status == DocStatus.APPROVED:
            db.add(Notification(
                user_id=professional.user_id,
                title="Documento aprobado",
                body=f"Tu {doc_label} fue aprobado.",
                type="DOC_APPROVED",
                entity_type="ProfessionalDoc",
                entity_id=doc_id,
            ))
        elif data.status == DocStatus.REJECTED:
            db.add(Notification(
                user_id=professional.user_id,
                title="Documento rechazado",
                body=f"Tu {doc_label} fue rechazado. Motivo: {data.review_note or 'sin especificar'}.",
                type="DOC_REJECTED",
                entity_type="ProfessionalDoc",
                entity_id=doc_id,
            ))

        if professional_approved_now:
            db.add(Notification(
                user_id=professional.user_id,
                title="¡Perfil verificado!",
                body="Todos tus documentos fueron aprobados. Ya podés activar tu disponibilidad y recibir pacientes.",
                type="PROFESSIONAL_APPROVED",
                entity_type="Professional",
                entity_id=professional.id,
            ))

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
    offset: int = Query(0, ge=0),
    date_from: Optional[str] = Query(None, description="Fecha inicial (YYYY-MM-DD), inclusive"),
    date_to: Optional[str] = Query(None, description="Fecha final (YYYY-MM-DD), inclusive"),
    patient: Optional[str] = Query(None, description="Nombre o apellido del paciente"),
    professional: Optional[str] = Query(None, description="Nombre o apellido del profesional"),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    PatientUser = Patient
    ProfUser = Professional

    query = (
        select(Payment, Consultation, PatientUser, ProfUser)
        .join(Consultation, Payment.consultation_id == Consultation.id, isouter=True)
        .join(PatientUser, Consultation.patient_id == PatientUser.id, isouter=True)
        .join(ProfUser, Consultation.professional_id == ProfUser.id, isouter=True)
    )

    conditions = []
    if date_from:
        try:
            start = datetime.strptime(date_from, "%Y-%m-%d")
            conditions.append(Payment.created_at >= start)
        except ValueError:
            raise HTTPException(status_code=400, detail="date_from inválido, usa formato YYYY-MM-DD")
    if date_to:
        try:
            end = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
            conditions.append(Payment.created_at < end)
        except ValueError:
            raise HTTPException(status_code=400, detail="date_to inválido, usa formato YYYY-MM-DD")
    if patient:
        like = f"%{patient.strip()}%"
        conditions.append(
            func.concat(PatientUser.first_name, ' ', PatientUser.last_name).ilike(like)
        )
    if professional:
        like = f"%{professional.strip()}%"
        conditions.append(
            func.concat(ProfUser.first_name, ' ', ProfUser.last_name).ilike(like)
        )
    if status_filter:
        conditions.append(Payment.status == status_filter)

    if conditions:
        query = query.where(and_(*conditions))

    query = query.order_by(Payment.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "id":                 p.id,
            "consultation_id":    p.consultation_id,
            "amount":             float(p.amount),
            "platform_fee":       float(p.platform_fee),
            "professional_net":   float(p.professional_net),
            "bank_name":          p.bank_name,
            "bank_tx_id":         p.bank_tx_id,
            "status":             p.status,
            "payment_channel":    p.payment_channel,
            "paid_at":            p.paid_at.isoformat() if p.paid_at else None,
            "created_at":         p.created_at.isoformat(),
            "refunded_at":        p.refunded_at.isoformat() if p.refunded_at else None,
            "refunded_amount":    float(p.refunded_amount) if p.refunded_amount is not None else None,
            "refund_note":        p.refund_note,
            "disputed_at":        p.disputed_at.isoformat() if p.disputed_at else None,
            "dispute_category":   p.dispute_category,
            "dispute_reason":     p.dispute_reason,
            "resolution_note":    p.resolution_note,
            "patient_id":         patient_row.id if patient_row else None,
            "patient_name":       f"{patient_row.first_name} {patient_row.last_name}" if patient_row else None,
            "patient_ci":         patient_row.ci if patient_row else None,
            "professional_id":    prof_row.id if prof_row else None,
            "professional_name":  f"{prof_row.first_name} {prof_row.last_name}" if prof_row else None,
            "specialty":          consultation.specialty if consultation else None,
            "consultation_type":  consultation.consultation_type if consultation else None,
            "scheduled_at":       consultation.scheduled_at.isoformat() if consultation and consultation.scheduled_at else None,
            "consultation_status":consultation.status if consultation else None,
            "outcome_note":       consultation.outcome_note if consultation else None,
            "created_by_role":    consultation.created_by_role if consultation else None,
            "modality":           consultation.modality if consultation else None,
        }
        for p, consultation, patient_row, prof_row in rows
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

    # Un pago CASH (cobro directo del profesional, agendamiento por
    # membresía) nunca pasó por la plataforma — no hay nada que la
    # plataforma pueda devolver. Si el profesional y el paciente necesitan
    # arreglar el monto, lo coordinan directamente entre ellos.
    if payment.payment_channel == PaymentChannel.CASH:
        raise HTTPException(
            status_code=400,
            detail="Este cobro fue directo entre el profesional y el paciente — la plataforma no participó en el pago, así que no hay nada que reembolsar desde aquí.",
        )

    if data.refund_type == "PARTIAL":
        if not data.amount or data.amount <= 0:
            raise HTTPException(status_code=400, detail="Debes indicar el monto a reembolsar")
        if data.amount > payment.amount:
            raise HTTPException(status_code=400, detail="El monto a reembolsar no puede ser mayor al monto original del pago")

    refund_status = PaymentStatus.REFUNDED_FULL if data.refund_type == "FULL" else PaymentStatus.REFUNDED_PARTIAL
    payment.status = refund_status
    payment.refunded_at = datetime.utcnow()
    payment.refund_note = data.reason
    payment.refunded_amount = payment.amount if data.refund_type == "FULL" else data.amount

    log = AuditLog(
        user_id=current_user.id,
        action=f"REFUND_{data.refund_type}",
        entity_type="Payment",
        entity_id=payment_id,
        metadata_={"reason": data.reason, "amount": str(payment.refunded_amount)},
    )
    db.add(log)
    await db.commit()

    logger.info(f"Reembolso {data.refund_type}: pago {payment_id} por admin {current_user.id}")
    return {"payment_id": payment_id, "status": refund_status, "message": "Reembolso procesado"}

# ── GET /api/v1/admin/payments/disputed ─────────────
# Cola de pagos congelados por reclamo del paciente, con la evidencia
# objetiva (duración de la consulta, si hay nota clínica/receta) para que
# el admin decida sin depender de la palabra del profesional.
@router.get("/payments/disputed", summary="Cola de disputas de pago pendientes de resolver")
async def list_disputed_payments(
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Payment)
        .where(Payment.status == PaymentStatus.DISPUTED)
        .order_by(Payment.disputed_at.asc())
    )
    payments = result.scalars().all()

    items = []
    for p in payments:
        cons_result = await db.execute(select(Consultation).where(Consultation.id == p.consultation_id))
        consultation = cons_result.scalar_one_or_none()

        has_clinical_note = False
        has_prescription = False
        if consultation:
            note_result = await db.execute(
                select(ClinicalNote.id).where(ClinicalNote.consultation_id == consultation.id)
            )
            has_clinical_note = note_result.scalars().first() is not None
            rx_result = await db.execute(
                select(Prescription.id).where(Prescription.consultation_id == consultation.id)
            )
            has_prescription = rx_result.scalars().first() is not None

        sla_deadline = (
            p.disputed_at + timedelta(hours=settings.DISPUTE_RESOLUTION_SLA_HOURS)
            if p.disputed_at else None
        )

        items.append({
            "payment_id": p.id,
            "consultation_id": p.consultation_id,
            "amount": float(p.amount),
            "professional_net": float(p.professional_net),
            "dispute_category": p.dispute_category,
            "dispute_reason": p.dispute_reason,
            "disputed_at": p.disputed_at.isoformat() if p.disputed_at else None,
            "sla_deadline": sla_deadline.isoformat() if sla_deadline else None,
            "consultation_duration_minutes": consultation.duration_minutes if consultation else None,
            "has_clinical_note": has_clinical_note,
            "has_prescription": has_prescription,
        })
    return items


# ── POST /api/v1/admin/payments/{id}/resolve-dispute ─
@router.post("/payments/{payment_id}/resolve-dispute", summary="Resolver una disputa de pago")
async def resolve_dispute(
    payment_id: str,
    data: DisputeResolveRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Payment).where(Payment.id == payment_id))
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    if payment.status != PaymentStatus.DISPUTED:
        raise HTTPException(status_code=400, detail="Este pago no está en disputa")

    cons_result = await db.execute(select(Consultation).where(Consultation.id == payment.consultation_id))
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta asociada no encontrada")

    if data.resolution == "RELEASE":
        # Reabrir temporalmente a CONFIRMED para reutilizar la lógica existente
        # de liberación, que solo libera pagos en ese estado.
        payment.status = PaymentStatus.CONFIRMED
        from app.api.v1.endpoints.consultations import _release_payment_to_professional
        await _release_payment_to_professional(db, consultation)
        result_status = PaymentStatus.RELEASED_TO_PROFESSIONAL

    elif data.resolution == "REFUND_FULL":
        payment.status = PaymentStatus.REFUNDED_FULL
        payment.refunded_at = datetime.utcnow()
        payment.refunded_amount = payment.amount
        result_status = PaymentStatus.REFUNDED_FULL

    else:  # REFUND_PARTIAL
        if not data.amount or data.amount <= 0:
            raise HTTPException(status_code=400, detail="Debes indicar el monto a reembolsar")
        if data.amount > payment.amount:
            raise HTTPException(status_code=400, detail="El monto a reembolsar no puede ser mayor al monto original del pago")
        payment.status = PaymentStatus.REFUNDED_PARTIAL
        payment.refunded_at = datetime.utcnow()
        payment.refunded_amount = data.amount
        result_status = PaymentStatus.REFUNDED_PARTIAL

    payment.resolution_note = data.note

    log = AuditLog(
        user_id=current_user.id,
        action=f"DISPUTE_RESOLVED_{data.resolution}",
        entity_type="Payment",
        entity_id=payment.id,
        metadata_={"note": data.note, "amount": str(data.amount) if data.amount else None},
    )
    db.add(log)
    await db.commit()

    logger.info(f"Disputa resuelta ({data.resolution}): pago {payment_id} por admin {current_user.id}")
    return {"payment_id": payment_id, "status": result_status, "message": "Disputa resuelta"}

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
            "photo_url":           patient.photo_url,
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


# ── GET /api/v1/admin/patients/{id}/history ──
@router.get("/patients/{patient_id}/history", summary="Historial detallado de un paciente")
async def get_patient_history(
    patient_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    patient = await db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    result = await db.execute(
        select(Consultation)
        .options(
            selectinload(Consultation.professional),
            selectinload(Consultation.payment),
            selectinload(Consultation.prescriptions),
            selectinload(Consultation.rating),
        )
        .where(Consultation.patient_id == patient_id)
        .order_by(Consultation.created_at.desc())
    )
    consultations = result.scalars().all()

    consult_ids = [c.id for c in consultations]
    notes_result = await db.execute(
        select(ClinicalNote).where(ClinicalNote.consultation_id.in_(consult_ids))
    ) if consult_ids else None
    notes_by_consult = {n.consultation_id: n for n in notes_result.scalars().all()} if notes_result else {}

    return _serialize_consultation_history(consultations, notes_by_consult, "professional")


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


# ── Edición de datos por el admin (paciente / profesional) ──────────
# El admin puede corregir cualquier dato mal ingresado en el registro,
# incluido teléfono/email (usados para iniciar sesión). Cada cambio se
# guarda en AuditLog con el valor anterior y el nuevo para trazabilidad,
# y el frontend muestra una advertencia extra antes de tocar teléfono/email.
class AdminPatientUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    ci: Optional[str] = Field(None, min_length=1, max_length=20)
    birth_date: Optional[str] = None  # ISO date, ej. "1990-05-20"
    department: Optional[str] = Field(None, min_length=1, max_length=50)
    gender: Optional[str] = Field(None, max_length=20)
    phone: Optional[str] = Field(None, min_length=6, max_length=20)
    email: Optional[str] = Field(None, max_length=255)


class AdminProfessionalUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    ci: Optional[str] = Field(None, min_length=1, max_length=20)
    birth_date: Optional[str] = None
    department: Optional[str] = Field(None, min_length=1, max_length=50)
    gender: Optional[str] = Field(None, max_length=20)
    phone: Optional[str] = Field(None, min_length=6, max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    specialty: Optional[str] = Field(None, min_length=1, max_length=100)
    sub_specialties: Optional[list[str]] = None
    bio: Optional[str] = None
    languages: Optional[list[str]] = None
    years_experience: Optional[int] = Field(None, ge=0, le=80)
    price_general: Optional[Decimal] = Field(None, gt=0)
    price_urgent: Optional[Decimal] = Field(None, gt=0)
    price_follow_up: Optional[Decimal] = Field(None, gt=0)
    cmb_matricula: Optional[str] = Field(None, max_length=50)
    sedes_number: Optional[str] = Field(None, max_length=50)


# El login se hace SOLO por número de celular (ver /auth/login), el email
# es solo un dato de contacto. Por eso solo el teléfono dispara la
# advertencia de "esto cambia cómo el usuario inicia sesión".
_LOGIN_FIELDS = {"phone"}


@router.patch("/patients/{user_id}", summary="Editar datos de un paciente")
async def update_patient_admin(
    user_id: str,
    payload: AdminPatientUpdate,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    result = await db.execute(select(Patient).where(Patient.user_id == user_id))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    data = payload.dict(exclude_unset=True)
    changes: dict = {}
    warnings: list[str] = []

    # Unicidad: CI, teléfono y email no pueden chocar con otro usuario.
    if "ci" in data and data["ci"] != patient.ci:
        dup = await db.execute(select(Patient).where(Patient.ci == data["ci"], Patient.id != patient.id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"El CI {data['ci']} ya está registrado por otro paciente")

    if "phone" in data and data["phone"] != user.phone:
        dup = await db.execute(select(User).where(User.phone == data["phone"], User.id != user.id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"El teléfono {data['phone']} ya está en uso por otra cuenta")

    if "email" in data and data["email"] and data["email"] != user.email:
        dup = await db.execute(select(User).where(User.email == data["email"], User.id != user.id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"El email {data['email']} ya está en uso por otra cuenta")

    # Campos que viven en Patient
    for field in ["first_name", "last_name", "ci", "department", "gender"]:
        if field in data and data[field] != getattr(patient, field):
            changes[field] = {"old": getattr(patient, field), "new": data[field]}
            setattr(patient, field, data[field])

    if "birth_date" in data and data["birth_date"]:
        try:
            new_birth = datetime.fromisoformat(data["birth_date"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de fecha de nacimiento inválido")
        if new_birth.date() != patient.birth_date.date():
            changes["birth_date"] = {"old": patient.birth_date.isoformat(), "new": new_birth.isoformat()}
            patient.birth_date = new_birth

    # Campos que viven en User (teléfono = login, email = solo contacto)
    for field in ["phone", "email"]:
        if field in data and data[field] != getattr(user, field):
            changes[field] = {"old": getattr(user, field), "new": data[field]}
            setattr(user, field, data[field])
            if field in _LOGIN_FIELDS:
                warnings.append(
                    "El teléfono de inicio de sesión cambió: el paciente ya no podrá "
                    "entrar con el número anterior."
                )

    if not changes:
        return {"message": "No hay cambios que aplicar", "warnings": []}

    log = AuditLog(
        user_id=current_user.id,
        action="PATIENT_UPDATED",
        entity_type="Patient",
        entity_id=patient.id,
        metadata_={"changes": changes, "target_user_id": user_id},
    )
    db.add(log)
    await db.commit()
    logger.info(f"Paciente editado por admin {current_user.id}: {list(changes.keys())} (patient {patient.id})")
    return {"message": "Datos actualizados correctamente", "changed_fields": list(changes.keys()), "warnings": warnings}


@router.patch("/professionals/{professional_id}", summary="Editar datos de un profesional")
async def update_professional_admin(
    professional_id: str,
    payload: AdminProfessionalUpdate,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Professional).where(Professional.id == professional_id))
    professional = result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    result = await db.execute(select(User).where(User.id == professional.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    data = payload.dict(exclude_unset=True)
    changes: dict = {}
    warnings: list[str] = []

    if "ci" in data and data["ci"] != professional.ci:
        dup = await db.execute(
            select(Professional).where(Professional.ci == data["ci"], Professional.id != professional.id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"El CI {data['ci']} ya está registrado por otro profesional")

    if "phone" in data and data["phone"] != user.phone:
        dup = await db.execute(select(User).where(User.phone == data["phone"], User.id != user.id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"El teléfono {data['phone']} ya está en uso por otra cuenta")

    if "email" in data and data["email"] and data["email"] != user.email:
        dup = await db.execute(select(User).where(User.email == data["email"], User.id != user.id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"El email {data['email']} ya está en uso por otra cuenta")

    simple_fields = [
        "first_name", "last_name", "ci", "department", "gender", "specialty",
        "sub_specialties", "bio", "languages", "years_experience",
        "price_general", "price_urgent", "price_follow_up",
        "cmb_matricula", "sedes_number",
    ]
    for field in simple_fields:
        if field in data and data[field] != getattr(professional, field):
            old_val = getattr(professional, field)
            changes[field] = {
                "old": str(old_val) if old_val is not None else None,
                "new": str(data[field]) if data[field] is not None else None,
            }
            setattr(professional, field, data[field])

    if "birth_date" in data and data["birth_date"]:
        try:
            new_birth = datetime.fromisoformat(data["birth_date"])
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de fecha de nacimiento inválido")
        old_birth = professional.birth_date
        if not old_birth or new_birth.date() != old_birth.date():
            changes["birth_date"] = {
                "old": old_birth.isoformat() if old_birth else None,
                "new": new_birth.isoformat(),
            }
            professional.birth_date = new_birth

    for field in ["phone", "email"]:
        if field in data and data[field] != getattr(user, field):
            changes[field] = {"old": getattr(user, field), "new": data[field]}
            setattr(user, field, data[field])
            if field in _LOGIN_FIELDS:
                warnings.append(
                    "El teléfono de inicio de sesión cambió: el profesional ya no podrá "
                    "entrar con el número anterior."
                )

    if not changes:
        return {"message": "No hay cambios que aplicar", "warnings": []}

    log = AuditLog(
        user_id=current_user.id,
        action="PROFESSIONAL_UPDATED",
        entity_type="Professional",
        entity_id=professional.id,
        metadata_={"changes": changes},
    )
    db.add(log)
    await db.commit()
    logger.info(f"Profesional editado por admin {current_user.id}: {list(changes.keys())} (professional {professional.id})")
    return {"message": "Datos actualizados correctamente", "changed_fields": list(changes.keys()), "warnings": warnings}


# ── GET /api/v1/admin/settings ───────────────────────
@router.get("/settings", summary="Obtener configuración de la plataforma")
async def get_settings(
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    row = await _get_or_create_settings(db)
    return _settings_to_dict(row)


# ── PUT /api/v1/admin/settings ───────────────────────
@router.put("/settings", summary="Actualizar configuración de la plataforma")
async def update_settings(
    data: PlatformSettingsUpdate,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    row = await _get_or_create_settings(db)

    changes = data.model_dump(exclude_unset=True)
    if not changes:
        return _settings_to_dict(row)

    for field, value in changes.items():
        setattr(row, field, value)
    row.updated_by = current_user.id

    db.add(AuditLog(
        user_id=current_user.id,
        action="SETTINGS_UPDATED",
        entity_type="PlatformSettings",
        entity_id=row.id,
        metadata_=changes,
    ))

    await db.commit()
    await db.refresh(row)

    set_platform_flags(
        row.maintenance_mode,
        row.open_registration_patients,
        row.open_registration_professionals,
    )

    logger.info(f"Configuración actualizada por admin {current_user.id}: {changes}")
    return _settings_to_dict(row)


# ══════════════════════════════════════════════════════════════════════
# Comisión por período y por profesional
#
# Complementa a PlatformSettings.commission_percent (que sigue siendo el
# valor de respaldo simple). Un CommissionPeriod define un % con vigencia
# (starts_at → ends_at), de alcance GLOBAL (toda la plataforma, para
# promociones tipo "10% este mes, 15% el próximo") o PROFESSIONAL (un
# profesional puntual, ej. tarifa reducida de bienvenida). Si hay un
# período individual vigente, gana sobre cualquier período global.
#
# Las consultas ya cobradas nunca se recalculan: guardan el % aplicado
# como foto fija (Consultation.commission_percent_applied). Cambiar o
# borrar un período acá solo afecta consultas futuras.
# ══════════════════════════════════════════════════════════════════════

class CommissionPeriodCreate(BaseModel):
    scope: str = Field(..., description="GLOBAL o PROFESSIONAL")
    professional_id: Optional[str] = Field(None, description="Requerido si scope=PROFESSIONAL")
    percent: Decimal = Field(..., ge=0, le=100)
    label: Optional[str] = Field(None, max_length=150)
    starts_at: datetime
    ends_at: Optional[datetime] = None


class CommissionPeriodUpdate(BaseModel):
    percent: Optional[Decimal] = Field(None, ge=0, le=100)
    label: Optional[str] = Field(None, max_length=150)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    active: Optional[bool] = None


def _commission_period_to_dict(p: CommissionPeriod) -> dict:
    return {
        "id": p.id,
        "scope": p.scope,
        "professional_id": p.professional_id,
        "percent": p.percent,
        "label": p.label,
        "starts_at": p.starts_at.isoformat() if p.starts_at else None,
        "ends_at": p.ends_at.isoformat() if p.ends_at else None,
        "active": p.active,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


# ── GET /api/v1/admin/commission-periods ─────────────
@router.get("/commission-periods", summary="Listar períodos de comisión (globales y por profesional)")
async def list_commission_periods(
    professional_id: Optional[str] = Query(None),
    scope: Optional[str] = Query(None),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(CommissionPeriod).order_by(CommissionPeriod.starts_at.desc())
    if professional_id:
        query = query.where(CommissionPeriod.professional_id == professional_id)
    if scope:
        query = query.where(CommissionPeriod.scope == scope)
    rows = (await db.execute(query)).scalars().all()
    return [_commission_period_to_dict(p) for p in rows]


# ── POST /api/v1/admin/commission-periods ────────────
@router.post("/commission-periods", summary="Crear un período/promoción de comisión")
async def create_commission_period(
    data: CommissionPeriodCreate,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if data.scope not in (CommissionScope.GLOBAL.value, CommissionScope.PROFESSIONAL.value):
        raise HTTPException(status_code=400, detail="scope debe ser GLOBAL o PROFESSIONAL")

    if data.scope == CommissionScope.PROFESSIONAL.value:
        if not data.professional_id:
            raise HTTPException(status_code=400, detail="professional_id es requerido cuando scope=PROFESSIONAL")
        exists = (await db.execute(
            select(Professional.id).where(Professional.id == data.professional_id)
        )).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="Profesional no encontrado")

    if data.ends_at and data.ends_at <= data.starts_at:
        raise HTTPException(status_code=400, detail="ends_at debe ser posterior a starts_at")

    period = CommissionPeriod(
        scope=data.scope,
        professional_id=data.professional_id if data.scope == CommissionScope.PROFESSIONAL.value else None,
        percent=data.percent,
        label=data.label,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        created_by=current_user.id,
    )
    db.add(period)

    db.add(AuditLog(
        user_id=current_user.id,
        action="COMMISSION_PERIOD_CREATED",
        entity_type="CommissionPeriod",
        entity_id=period.id,
        metadata_={
            "scope": data.scope,
            "professional_id": data.professional_id,
            "percent": str(data.percent),
            "starts_at": data.starts_at.isoformat(),
            "ends_at": data.ends_at.isoformat() if data.ends_at else None,
        },
    ))

    await db.commit()
    await db.refresh(period)
    logger.info(f"Período de comisión creado por admin {current_user.id}: {data.scope} {data.percent}%")
    return _commission_period_to_dict(period)


# ── PUT /api/v1/admin/commission-periods/{id} ────────
@router.put("/commission-periods/{period_id}", summary="Editar un período de comisión")
async def update_commission_period(
    period_id: str,
    data: CommissionPeriodUpdate,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    period = (await db.execute(
        select(CommissionPeriod).where(CommissionPeriod.id == period_id)
    )).scalar_one_or_none()
    if not period:
        raise HTTPException(status_code=404, detail="Período no encontrado")

    changes = data.model_dump(exclude_unset=True)
    if not changes:
        return _commission_period_to_dict(period)

    new_starts = changes.get("starts_at", period.starts_at)
    new_ends = changes.get("ends_at", period.ends_at)
    if new_ends and new_ends <= new_starts:
        raise HTTPException(status_code=400, detail="ends_at debe ser posterior a starts_at")

    for field, value in changes.items():
        setattr(period, field, value)

    db.add(AuditLog(
        user_id=current_user.id,
        action="COMMISSION_PERIOD_UPDATED",
        entity_type="CommissionPeriod",
        entity_id=period.id,
        metadata_={k: str(v) for k, v in changes.items()},
    ))

    await db.commit()
    await db.refresh(period)
    return _commission_period_to_dict(period)


# ── DELETE /api/v1/admin/commission-periods/{id} ─────
# Borrado lógico (active=False): así el historial de auditoría y las
# consultas que ya usaron este % no se ven afectadas — solo deja de
# aplicar hacia adelante.
@router.delete("/commission-periods/{period_id}", summary="Desactivar un período de comisión")
async def delete_commission_period(
    period_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    period = (await db.execute(
        select(CommissionPeriod).where(CommissionPeriod.id == period_id)
    )).scalar_one_or_none()
    if not period:
        raise HTTPException(status_code=404, detail="Período no encontrado")

    period.active = False

    db.add(AuditLog(
        user_id=current_user.id,
        action="COMMISSION_PERIOD_DEACTIVATED",
        entity_type="CommissionPeriod",
        entity_id=period.id,
        metadata_={},
    ))

    await db.commit()
    return {"message": "Período desactivado", "id": period_id}


# ─────────────────────────────────────────────────────
# MEMBRESÍA DE PROFESIONALES (ProfessionalMembership)
# Habilitación/deshabilitación manual por admin, con registro mensual.
# No hay cobro automático — el admin la activa cuando confirma el pago
# por fuera de la plataforma. Ver app/services/commission.py
# (_has_active_membership) para cómo esto anula la comisión por %.
# ─────────────────────────────────────────────────────

def _membership_to_dict(m: ProfessionalMembership) -> dict:
    # starts_at/ends_at se guardan en hora Bolivia (día calendario que
    # eligió el admin) — hay que comparar contra "ahora" en Bolivia, no
    # UTC, o la vigencia queda corrida hasta 4 horas.
    now = bolivia_now_naive()
    is_current = bool(
        m.active and m.starts_at <= now and (m.ends_at is None or m.ends_at > now)
    )
    return {
        "id": m.id,
        "professional_id": m.professional_id,
        "period_label": m.period_label,
        "starts_at": m.starts_at.isoformat() if m.starts_at else None,
        "ends_at": m.ends_at.isoformat() if m.ends_at else None,
        "active": m.active,
        # True solo si hoy cae dentro de [starts_at, ends_at). El
        # frontend usa esto para decidir si mostrar "Renovar" (sigue
        # vigente) o forzar "Nueva membresía" (ya venció).
        "is_current": is_current,
        "note": m.note,
        "enabled_by_admin_id": m.enabled_by_admin_id,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/memberships", summary="Listar registros de membresía (por profesional o todos)")
async def list_memberships(
    professional_id: Optional[str] = Query(None),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(ProfessionalMembership).order_by(ProfessionalMembership.starts_at.desc())
    if professional_id:
        query = query.where(ProfessionalMembership.professional_id == professional_id)
    rows = (await db.execute(query)).scalars().all()
    return [_membership_to_dict(m) for m in rows]


@router.post("/memberships", summary="Habilitar membresía a un profesional (registro mensual)")
async def create_membership(
    data: ProfessionalMembershipCreateRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    exists = (await db.execute(
        select(Professional.id).where(Professional.id == data.professional_id)
    )).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    # Si no se manda starts_at, arranca "hoy" EN HORA DE BOLIVIA (no UTC:
    # con UTC, después de las 20:00 en La Paz ya sería "mañana"). Si el
    # admin sí eligió una fecha, se toma solo el día calendario elegido
    # — la hora exacta no importa para una membresía.
    # ends_at siempre se calcula como starts_at + N meses CALENDARIO
    # (15 jul + 1 mes = 15 ago; con timedelta(days=30) hubiera dado
    # 14 ago, mal), nunca a mano.
    starts_at = as_bolivia_calendar_day(data.starts_at) if data.starts_at else bolivia_today_midnight_naive()
    ends_at = starts_at + relativedelta(months=data.months)

    membership = ProfessionalMembership(
        professional_id=data.professional_id,
        period_label=data.period_label,
        starts_at=starts_at,
        ends_at=ends_at,
        note=data.note,
        enabled_by_admin_id=current_user.id,
    )
    db.add(membership)

    db.add(AuditLog(
        user_id=current_user.id,
        action="MEMBERSHIP_ENABLED",
        entity_type="ProfessionalMembership",
        entity_id=membership.id,
        metadata_={
            "professional_id": data.professional_id,
            "period_label": data.period_label,
            "months": data.months,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
        },
    ))

    await db.commit()
    await db.refresh(membership)
    logger.info(f"Membresía habilitada por admin {current_user.id} para profesional {data.professional_id} ({data.period_label}, {data.months} mes(es))")
    return _membership_to_dict(membership)


@router.post("/memberships/{membership_id}/renew", summary="Renovar membresía (solo si sigue vigente)")
async def renew_membership(
    membership_id: str,
    data: ProfessionalMembershipRenewRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    membership = (await db.execute(
        select(ProfessionalMembership).where(ProfessionalMembership.id == membership_id)
    )).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Membresía no encontrada")

    now = bolivia_now_naive()
    vigente = (
        membership.active
        and membership.starts_at <= now
        and (membership.ends_at is None or membership.ends_at > now)
    )
    if not vigente:
        # Regla de negocio: si ya venció (o fue desactivada), no se
        # "revive" con una renovación — hay que dar de alta una
        # membresía nueva (POST /memberships) desde cero.
        raise HTTPException(
            status_code=400,
            detail="La membresía ya venció o está inactiva. Crea una nueva membresía en vez de renovar esta.",
        )

    base = membership.ends_at  # siempre vigente aquí, así que nunca es None
    new_ends_at = base + relativedelta(months=data.months)

    old_ends_at = membership.ends_at
    membership.ends_at = new_ends_at
    if data.note:
        membership.note = data.note

    db.add(AuditLog(
        user_id=current_user.id,
        action="MEMBERSHIP_RENEWED",
        entity_type="ProfessionalMembership",
        entity_id=membership.id,
        metadata_={
            "professional_id": membership.professional_id,
            "months": data.months,
            "old_ends_at": old_ends_at.isoformat() if old_ends_at else None,
            "new_ends_at": new_ends_at.isoformat(),
        },
    ))

    await db.commit()
    await db.refresh(membership)
    logger.info(f"Membresía {membership_id} renovada por admin {current_user.id}: +{data.months} mes(es) -> {new_ends_at.isoformat()}")
    return _membership_to_dict(membership)


@router.put("/memberships/{membership_id}", summary="Editar/deshabilitar un registro de membresía")
async def update_membership(
    membership_id: str,
    data: ProfessionalMembershipUpdateRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    membership = (await db.execute(
        select(ProfessionalMembership).where(ProfessionalMembership.id == membership_id)
    )).scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Registro de membresía no encontrado")

    changes = data.model_dump(exclude_unset=True)
    if not changes:
        return _membership_to_dict(membership)

    for field, value in changes.items():
        setattr(membership, field, value)

    db.add(AuditLog(
        user_id=current_user.id,
        action="MEMBERSHIP_UPDATED",
        entity_type="ProfessionalMembership",
        entity_id=membership.id,
        metadata_={k: str(v) for k, v in changes.items()},
    ))

    await db.commit()
    await db.refresh(membership)
    return _membership_to_dict(membership)


# ── GET /api/v1/admin/commission-periods/current ─────
# Ayuda al admin a previsualizar qué % aplicaría ahora mismo para un
# profesional (o el global si no se pasa professional_id), antes de crear
# un nuevo período — evita promociones que se pisen sin darse cuenta.
@router.get("/commission-periods/current", summary="Ver qué % de comisión aplica ahora mismo")
async def get_current_commission(
    professional_id: Optional[str] = Query(None),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if professional_id:
        info = await get_professional_commission_summary(db, professional_id)
    else:
        info = await get_professional_commission_summary(db, professional_id=None)
    return {
        "percent": info["percent"],
        "source": info["source"],
        "label": info["label"],
        "ends_at": info["ends_at"].isoformat() if info["ends_at"] else None,
    }


# ── GET /api/v1/admin/maintenance-status ─────────────
# Sin auth a propósito: la usa la página pública /mantenimiento del
# frontend para saber cuándo puede volver a redirigir al usuario.
# Solo expone un booleano, nada sensible.
@router.get("/maintenance-status", summary="Estado público de mantenimiento")
async def get_maintenance_status(db: AsyncSession = Depends(get_db)):
    return {"maintenance_mode": await is_maintenance_active(db)}


# ── GET /api/v1/admin/system-info ────────────────────
# Reemplaza los datos fijos que antes estaban hardcodeados en el frontend
# ("v1.0.0", "FastAPI 0.111", "Claude Sonnet 4.6"...) por valores que salen
# de la configuración real del backend (app/core/config.py) y de constantes
# que reflejan el stack tal cual está hoy en el repo. Si mañana se cambia
# de proveedor de IA o de motor de WhatsApp, alcanza con actualizar este
# endpoint (o la env var correspondiente) para que el panel deje de mentir.
@router.get("/system-info", summary="Información real del stack para el panel admin")
async def get_system_info(current_user=Depends(get_current_admin)):
    return {
        "app_name":            settings.APP_NAME,
        "app_version":         settings.APP_VERSION,
        "environment":         settings.ENVIRONMENT,
        "backend":             "FastAPI (Python) + SQLAlchemy async",
        "database":            "PostgreSQL (asyncpg)",
        "frontend":            "Next.js 14 + React 18",
        "ai_agent_provider":   "Google Gemini",
        "ai_agent_model":      settings.GEMINI_MODEL,
        "whatsapp_engine":     "whatsapp-web.js (microservicio Node.js aparte)",
        "background_jobs":     "Celery + Redis",
        "server_time_utc":     datetime.utcnow().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════
# Chat > Reportes — panel de revisión de bloqueos reportados
# (tanto los que vienen de ChatBlock/is_reported=True como los de
# ProfessionalPatientVisibility/is_reported=True, unificados en una
# sola vista para el admin)
# ═══════════════════════════════════════════════════════════════════

def _report_to_dict(row, kind: str) -> dict:
    return {
        "id": row.id,
        "kind": kind,  # "CHAT_BLOCK" | "PATIENT_VISIBILITY"
        "reason_category": row.reason_category,
        "reason_text": row.reason_text,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "admin_reviewed_at": row.admin_reviewed_at.isoformat() if row.admin_reviewed_at else None,
        "admin_reviewed_by_id": row.admin_reviewed_by_id,
        "admin_resolution_notes": row.admin_resolution_notes,
        "status": "reviewed" if row.admin_reviewed_at else "pending",
    }


@router.get("/chat-reports", summary="[Admin] Listar reportes de chat (bloqueos con is_reported=True)")
async def list_chat_reports(
    report_status: str = Query("pending", description='"pending", "reviewed" o "all"'),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    def status_filter(model):
        if report_status == "pending":
            return [model.is_reported.is_(True), model.admin_reviewed_at.is_(None)]
        if report_status == "reviewed":
            return [model.is_reported.is_(True), model.admin_reviewed_at.isnot(None)]
        return [model.is_reported.is_(True)]

    blocks_result = await db.execute(select(ChatBlock).where(*status_filter(ChatBlock)))
    visibility_result = await db.execute(select(ProfessionalPatientVisibility).where(*status_filter(ProfessionalPatientVisibility)))

    reports = (
        [_report_to_dict(b, "CHAT_BLOCK") for b in blocks_result.scalars().all()]
        + [_report_to_dict(v, "PATIENT_VISIBILITY") for v in visibility_result.scalars().all()]
    )
    reports.sort(key=lambda r: r["created_at"] or "", reverse=True)
    return reports


@router.get("/chat-reports/{kind}/{report_id}", summary="[Admin] Ver detalle de un reporte (con auditoría de acceso)")
async def get_chat_report_detail(
    kind: str, report_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if kind == "CHAT_BLOCK":
        result = await db.execute(select(ChatBlock).where(ChatBlock.id == report_id))
    elif kind == "PATIENT_VISIBILITY":
        result = await db.execute(select(ProfessionalPatientVisibility).where(ProfessionalPatientVisibility.id == report_id))
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'kind debe ser "CHAT_BLOCK" o "PATIENT_VISIBILITY"')

    row = result.scalar_one_or_none()
    if not row or not row.is_reported:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporte no encontrado")

    # Auditoría: solo se registra acceso a contenido de conversación real
    # (CHAT_BLOCK sí referencia mensajería). El registro de visibilidad
    # (PATIENT_VISIBILITY) no expone contenido de chat en sí, así que no
    # requiere este log.
    if kind == "CHAT_BLOCK":
        conv_result = await db.execute(
            select(ChatConversation).where(
                or_(
                    and_(ChatConversation.patient_user_id == row.blocker_id, ChatConversation.professional_user_id == row.blocked_id),
                    and_(ChatConversation.patient_user_id == row.blocked_id, ChatConversation.professional_user_id == row.blocker_id),
                )
            )
        )
        conv = conv_result.scalars().first()
        if conv:
            db.add(AdminAccessLog(admin_id=current_user.id, conversation_id=conv.id))
            await db.commit()

    return _report_to_dict(row, kind)


class ChatReportResolutionRequest(BaseModel):
    resolution_notes: str = Field(..., min_length=1, max_length=1000)


@router.post("/chat-reports/{kind}/{report_id}/review", summary="[Admin] Marcar un reporte como revisado")
async def review_chat_report(
    kind: str, report_id: str,
    data: ChatReportResolutionRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if kind == "CHAT_BLOCK":
        result = await db.execute(select(ChatBlock).where(ChatBlock.id == report_id))
    elif kind == "PATIENT_VISIBILITY":
        result = await db.execute(select(ProfessionalPatientVisibility).where(ProfessionalPatientVisibility.id == report_id))
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'kind debe ser "CHAT_BLOCK" o "PATIENT_VISIBILITY"')

    row = result.scalar_one_or_none()
    if not row or not row.is_reported:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporte no encontrado")

    row.admin_reviewed_at = datetime.utcnow()
    row.admin_reviewed_by_id = current_user.id
    row.admin_resolution_notes = data.resolution_notes

    db.add(AuditLog(
        user_id=current_user.id,
        action="CHAT_REPORT_REVIEWED",
        entity_type=kind,
        entity_id=row.id,
        metadata_={"resolution_notes": data.resolution_notes},
    ))
    await db.commit()
    logger.info(f"✅ Reporte de chat revisado: kind={kind} id={report_id} admin={current_user.id}")
    return _report_to_dict(row, kind)


# ── Mensajería masiva (broadcast) ──────────────────────
# El admin redacta un anuncio libre y lo manda a un segmento de usuarios.
# La notificación in-app se crea de una sola vez; el WhatsApp se encola
# escalonado con espaciado aleatorio (ver app/services/broadcast.py) para
# no parecer un envío automatizado ante WhatsApp.

def _broadcast_to_dict(b: BroadcastMessage) -> dict:
    return {
        "id": b.id,
        "title": b.title,
        "body": b.body,
        "audience": b.audience,
        "send_whatsapp": b.send_whatsapp,
        "status": b.status,
        "recipients_count": b.recipients_count,
        "sent_by_id": b.sent_by_id,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


@router.get("/broadcasts/preview", summary="Contar destinatarios de una audiencia (sin enviar nada)")
async def preview_broadcast_recipients(
    audience: str = Query(..., pattern="^(ALL|PATIENT|PROFESSIONAL|WHATSAPP_PUBLIC)$"),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    count = await count_recipients(db, audience)
    return {"audience": audience, "recipients_count": count}


@router.post("/broadcasts", summary="Enviar un mensaje masivo (anuncio) a un segmento de usuarios")
async def create_broadcast(
    data: BroadcastCreateRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    broadcast = await send_broadcast(
        db,
        title=data.title,
        body=data.body,
        audience=data.audience,
        send_whatsapp=data.send_whatsapp,
        sent_by_id=current_user.id,
    )
    db.add(AuditLog(
        user_id=current_user.id,
        action="BROADCAST_SENT",
        entity_type="BroadcastMessage",
        entity_id=broadcast.id,
        metadata_={"audience": data.audience, "recipients_count": broadcast.recipients_count},
    ))
    await db.commit()
    logger.info(
        f"📢 Broadcast enviado por admin={current_user.id}: audience={data.audience} "
        f"recipients={broadcast.recipients_count}"
    )
    return _broadcast_to_dict(broadcast)


@router.get("/broadcasts", summary="Historial de mensajes masivos enviados")
async def list_broadcasts(
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BroadcastMessage).order_by(BroadcastMessage.created_at.desc()).limit(limit)
    )
    return [_broadcast_to_dict(b) for b in result.scalars().all()]


# ─────────────────────────────────────────────────────
# BUSCADOR DE MÉDICOS / CAPTACIÓN (DoctorLead)
#
# Flujo: el admin busca en Google Maps -> previsualiza -> importa el
# resultado que le interese como DoctorLead -> le hace seguimiento
# (notas, estado) -> lo invita por WhatsApp cuando tiene el celular
# real del médico -> si se registra, lo liga a su Professional.
# ─────────────────────────────────────────────────────

async def _get_latest_invite_info(db: AsyncSession, lead_ids: list[str]) -> dict[str, dict]:
    """
    Devuelve, por cada lead_id, el resultado del último WhatsApp que se le
    mandó (SENT o FAILED) — en una sola query batched para no hacer N+1 al
    listar. Se apoya en WhatsAppMessage.related_entity_id, que
    invite_doctor_lead() setea como el id del lead al encolar el envío
    (ver whatsapp_tasks.py::_log_message), así que es exacto incluso si dos
    leads llegaran a compartir el mismo teléfono — no depende de matchear
    por número.
    """
    if not lead_ids:
        return {}

    latest_ts_subq = (
        select(
            WhatsAppMessage.related_entity_id.label("lead_id"),
            func.max(WhatsAppMessage.created_at).label("max_created_at"),
        )
        .where(
            WhatsAppMessage.related_entity_type == "DoctorLead",
            WhatsAppMessage.related_entity_id.in_(lead_ids),
            WhatsAppMessage.direction == "OUT",
        )
        .group_by(WhatsAppMessage.related_entity_id)
        .subquery()
    )

    result = await db.execute(
        select(WhatsAppMessage).join(
            latest_ts_subq,
            and_(
                WhatsAppMessage.related_entity_id == latest_ts_subq.c.lead_id,
                WhatsAppMessage.created_at == latest_ts_subq.c.max_created_at,
            ),
        )
    )

    info: dict[str, dict] = {}
    for msg in result.scalars().all():
        # En el rarísimo caso de empate exacto de timestamp (dos mensajes
        # en el mismo milisegundo) nos quedamos con el último que
        # iteremos — no afecta la UI, es solo un badge informativo.
        info[msg.related_entity_id] = {
            "last_invite_status": msg.status,
            "last_invite_included_pdf": msg.body.startswith("[PDF:"),
            "last_invite_sent_at": msg.created_at,
            "last_invite_error": msg.error_detail,
        }
    return info


def _doctor_lead_to_dict(lead: DoctorLead, invite_info: Optional[dict] = None) -> dict:
    info = invite_info or {}
    return {
        "id": lead.id,
        "full_name": lead.full_name,
        "specialty": lead.specialty,
        "city": lead.city,
        "phone": lead.phone,
        "email": lead.email,
        "clinic_or_hospital": lead.clinic_or_hospital,
        "address": lead.address,
        "source": lead.source,
        "place_id": lead.place_id,
        "maps_url": lead.maps_url,
        "status": lead.status,
        "notes": lead.notes,
        "last_contacted_at": lead.last_contacted_at,
        "converted_professional_id": lead.converted_professional_id,
        "created_at": lead.created_at,
        "updated_at": lead.updated_at,
        # Estado del último envío de WhatsApp (invitación) a este lead.
        # IMPORTANTE: refleja si el mensaje se entregó al microservicio sin
        # error (SENT) o falló tras reintentos (FAILED) — NO si el médico
        # lo recibió o leyó de verdad. Eso requeriría procesar los eventos
        # message_ack de whatsapp-web.js, que hoy no se capturan.
        "last_invite_status": info.get("last_invite_status"),
        "last_invite_included_pdf": info.get("last_invite_included_pdf", False),
        "last_invite_sent_at": info.get("last_invite_sent_at"),
        "last_invite_error": info.get("last_invite_error"),
    }


@router.get("/doctor-leads/search-maps", summary="Buscar médicos en Google Maps (previsualización, sin guardar)")
async def search_doctor_leads_maps(
    query: str = Query(..., min_length=2, description="Ej: 'cardiólogo', 'dermatólogo'"),
    city: str = Query(..., min_length=2, description="Ej: 'Santa Cruz de la Sierra'"),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        results = await google_places.text_search(query, city)
    except google_places.GooglePlacesNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except google_places.GooglePlacesError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # Marca cuáles resultados ya están cargados como lead o ya son
    # Professional (por place_id ya importado), para no duplicar en la UI.
    place_ids = [r["place_id"] for r in results if r["place_id"]]
    existing_place_ids: set[str] = set()
    if place_ids:
        existing = await db.execute(
            select(DoctorLead.place_id).where(DoctorLead.place_id.in_(place_ids))
        )
        existing_place_ids = {row[0] for row in existing.all()}

    for r in results:
        r["already_imported"] = r["place_id"] in existing_place_ids

    return {"query": query, "city": city, "results": results}


@router.get("/doctor-leads/place-details/{place_id}", summary="Ver detalle (incluye teléfono) de un resultado de Maps")
async def get_doctor_lead_place_details(
    place_id: str,
    current_user=Depends(get_current_admin),
):
    try:
        details = await google_places.place_details(place_id)
    except google_places.GooglePlacesNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except google_places.GooglePlacesError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # Intentamos normalizar el teléfono al formato canónico del proyecto;
    # si no matchea (ej. formato raro o número de otro país), lo devolvemos
    # tal cual vino y que el admin lo corrija a mano al importar.
    if details.get("phone"):
        try:
            details["phone_normalized"] = normalize_bo_phone(details["phone"])
        except InvalidPhoneError:
            details["phone_normalized"] = None
    else:
        details["phone_normalized"] = None

    return details


@router.get("/doctor-leads", summary="Listar prospectos de médicos")
async def list_doctor_leads(
    status_filter: Optional[str] = Query(None, alias="status"),
    specialty: Optional[str] = None,
    city: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if status_filter:
        filters.append(DoctorLead.status == status_filter)
    if specialty:
        filters.append(DoctorLead.specialty.ilike(f"%{specialty}%"))
    if city:
        filters.append(DoctorLead.city.ilike(f"%{city}%"))
    if search:
        like = f"%{search}%"
        filters.append(or_(DoctorLead.full_name.ilike(like), DoctorLead.phone.ilike(like)))

    base_query = select(DoctorLead)
    if filters:
        base_query = base_query.where(and_(*filters))

    total = (await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )).scalar_one()

    result = await db.execute(
        base_query.order_by(DoctorLead.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )
    leads = result.scalars().all()

    # Resumen del embudo, para las tarjetas del encabezado de la página.
    counts_result = await db.execute(
        select(DoctorLead.status, func.count()).group_by(DoctorLead.status)
    )
    funnel = {status.value: 0 for status in DoctorLeadStatus}
    for status_value, count in counts_result.all():
        funnel[status_value] = count

    invite_info_map = await _get_latest_invite_info(db, [l.id for l in leads])

    return {
        "items": [_doctor_lead_to_dict(l, invite_info_map.get(l.id)) for l in leads],
        "total": total,
        "page": page,
        "page_size": page_size,
        "funnel": funnel,
    }


@router.post("/doctor-leads", summary="Agregar un prospecto de médico (manual o desde Google Maps)")
async def create_doctor_lead(
    data: DoctorLeadCreateRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    phone_normalized = None
    if data.phone:
        try:
            phone_normalized = normalize_bo_phone(data.phone)
        except InvalidPhoneError:
            raise HTTPException(status_code=422, detail="Teléfono inválido")

        existing = await db.execute(select(DoctorLead).where(DoctorLead.phone == phone_normalized))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Ya existe un prospecto con este teléfono")

        already_professional = await db.execute(select(User).where(User.phone == phone_normalized))
        if already_professional.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="Este número ya pertenece a un usuario registrado en la plataforma",
            )

    lead = DoctorLead(
        full_name=data.full_name,
        specialty=data.specialty,
        city=data.city,
        phone=phone_normalized,
        email=data.email,
        clinic_or_hospital=data.clinic_or_hospital,
        address=data.address,
        source=data.source,
        place_id=data.place_id,
        maps_url=data.maps_url,
        notes=data.notes,
        created_by_id=current_user.id,
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    logger.info(f"Lead de médico creado por admin={current_user.id}: {lead.full_name} ({lead.source})")
    return _doctor_lead_to_dict(lead)


@router.put("/doctor-leads/{lead_id}", summary="Editar un prospecto (notas, estado, datos de contacto)")
async def update_doctor_lead(
    lead_id: str,
    data: DoctorLeadUpdateRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = (await db.execute(select(DoctorLead).where(DoctorLead.id == lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Prospecto no encontrado")

    update_data = data.model_dump(exclude_unset=True)
    if "phone" in update_data and update_data["phone"]:
        try:
            update_data["phone"] = normalize_bo_phone(update_data["phone"])
        except InvalidPhoneError:
            raise HTTPException(status_code=422, detail="Teléfono inválido")

    for field, value in update_data.items():
        setattr(lead, field, value)

    await db.commit()
    await db.refresh(lead)
    invite_info_map = await _get_latest_invite_info(db, [lead.id])
    return _doctor_lead_to_dict(lead, invite_info_map.get(lead.id))


@router.delete("/doctor-leads/{lead_id}", summary="Eliminar un prospecto")
async def delete_doctor_lead(
    lead_id: str,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = (await db.execute(select(DoctorLead).where(DoctorLead.id == lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Prospecto no encontrado")
    await db.delete(lead)
    await db.commit()
    return {"deleted": True}


@router.post("/doctor-leads/{lead_id}/invite", summary="Invitar a un prospecto por WhatsApp")
async def invite_doctor_lead(
    lead_id: str,
    data: DoctorLeadInviteRequest,
    current_user=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = (await db.execute(select(DoctorLead).where(DoctorLead.id == lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Prospecto no encontrado")
    if not lead.phone:
        raise HTTPException(
            status_code=422,
            detail="Este prospecto no tiene teléfono cargado — agrégalo antes de invitarlo",
        )
    if lead.status == DoctorLeadStatus.NO_CONTACTAR.value:
        raise HTTPException(status_code=409, detail="Este prospecto pidió no ser contactado de nuevo")

    if data.include_pdf:
        # PDF formal (logo + firma del director médico, ver
        # invitation_pdf.py) adjunto como documento, con `message` como
        # caption — un solo mensaje de WhatsApp con el archivo y el
        # texto encima, igual que cuando lo manda una persona a mano.
        pdf_bytes = invitation_pdf.generate_invitation_pdf(lead.full_name)
        pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
        safe_name = "".join(c for c in lead.full_name if c.isalnum() or c in " ._-").strip()[:60] or "medico"
        filename = f"Invitacion_MedicBolivia_{safe_name}.pdf".replace(" ", "_")

        send_whatsapp_document.delay(
            phone=lead.phone,
            pdf_base64=pdf_b64,
            filename=filename,
            caption=data.message,
            audience=WhatsAppAudience.PUBLIC.value,
            related_entity_type="DoctorLead",
            related_entity_id=lead.id,
            sent_by="ADMIN",
        )
    else:
        # Mismo mecanismo que usa broadcast.py: se encola como tarea Celery,
        # nunca se llama directo a whatsapp-service desde el endpoint.
        send_whatsapp_message.delay(
            phone=lead.phone,
            message=data.message,
            audience=WhatsAppAudience.PUBLIC.value,
            related_entity_type="DoctorLead",
            related_entity_id=lead.id,
            sent_by="ADMIN",
        )

    lead.status = DoctorLeadStatus.CONTACTADO.value
    lead.last_contacted_at = datetime.utcnow()
    await db.commit()
    await db.refresh(lead)

    db.add(AuditLog(
        user_id=current_user.id,
        action="DOCTOR_LEAD_INVITED",
        entity_type="DoctorLead",
        entity_id=lead.id,
        metadata_={"phone": lead.phone},
    ))
    await db.commit()

    logger.info(f"Invitación WhatsApp encolada por admin={current_user.id} para lead={lead.id}")
    # Nota: la tarea de Celery todavía no corrió en este punto (es async),
    # así que esto puede devolver el resultado de una invitación ANTERIOR
    # a este lead, no la que se acaba de encolar. El frontend no debe
    # asumir que "SENT" acá significa que este envío puntual ya se
    # completó — solo confirma que quedó encolado (lead.status=CONTACTADO).
    invite_info_map = await _get_latest_invite_info(db, [lead.id])
    return _doctor_lead_to_dict(lead, invite_info_map.get(lead.id))