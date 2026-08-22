"""
app/api/v1/endpoints/lab_orders.py
Órdenes de laboratorio digitales con firma criptográfica y verificación
QR — mismo patrón que prescriptions.py, pero como documento separado
(ver LabOrder en app/models/models.py para el porqué).
"""
import hashlib
import uuid
from app.core.timezone import utcnow_naive
from app.core.professional_title import professional_full_name
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user, get_current_professional
from app.core.lab_test_catalog import LAB_TEST_CATALOG
from app.models.models import (
    User, Patient, Professional, Consultation, LabOrder,
    ConsultationStatus, ProfessionalStatus, PrescriptionStatus,
    ProfessionalDoc, DocType, DocStatus,
)
from app.schemas.schemas import LabOrderCreateRequest, LabOrderResponse, LabOrderVoidRequest
from app.services.lab_order_pdf import generate_lab_order_pdf
from app.services.storage import upload_lab_order_pdf_to_r2, get_presigned_url
from app.services.notify import notify_user

router = APIRouter()


def _generate_lab_order_hash(data: dict) -> str:
    content = (
        f"{data['consultation_id']}"
        f"{data['professional_id']}"
        f"{data['patient_ci']}"
        f"{data['tests']}"
        f"{data['signed_at']}"
    )
    return hashlib.sha256(content.encode()).hexdigest()


async def _enrich(lab_order: LabOrder, professional: Professional | None, patient: Patient | None = None) -> LabOrderResponse:
    """Convierte LabOrder ORM → LabOrderResponse con datos del médico.
    pdf_url se guarda internamente como r2://bucket/key (bucket privado,
    tiene CI y datos de salud del paciente) — acá se resuelve a una URL
    firmada de corta duración recién al momento de responder, mismo
    patrón que prescriptions.py::_enrich."""
    base = LabOrderResponse.model_validate(lab_order)
    if professional:
        base.professional_name     = professional_full_name(professional.first_name, professional.last_name, professional.gender)
        base.professional_specialty = professional.specialty
        base.professional_sub_specialties = [professional.sub_specialty] if professional.sub_specialty else []
        base.professional_department = professional.department
        base.professional_license_number = professional.professional_license_number
        base.cmb_matricula          = professional.cmb_matricula
    if patient:
        base.patient_photo_url = patient.photo_url
    if base.pdf_url and (base.pdf_url.startswith("r2://") or base.pdf_url.startswith("s3://")):
        try:
            base.pdf_url = await get_presigned_url(base.pdf_url, expires_seconds=3600)
        except Exception as e:
            logger.error(f"No se pudo firmar la URL del PDF de la orden de laboratorio {lab_order.id}: {e}")
            base.pdf_url = None
    return base


# ── GET /lab-orders/test-catalog ─────────────────────
# Catálogo de estudios comunes para el selector rápido del formulario.
# El frontend SIEMPRE debe ofrecer también un campo de texto libre para
# "agregar estudio manual" — este catálogo es solo para agilizar, no es
# una lista cerrada (ver app.core.lab_test_catalog).
@router.get("/test-catalog", summary="Catálogo de estudios de laboratorio comunes, agrupado por categoría")
async def get_test_catalog(current_user: User = Depends(get_current_user)):
    return {"catalog": LAB_TEST_CATALOG}


# ── POST /lab-orders ──────────────────────────────────
@router.post(
    "",
    response_model=LabOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Emitir orden de laboratorio firmada"
)
async def create_lab_order(
    data: LabOrderCreateRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=403, detail="Tu perfil no está verificado para emitir órdenes de laboratorio")

    # Firma obligatoria y aprobada por un admin — chequeo aparte del status
    # del profesional, ver comentario equivalente en prescriptions.py.
    sig_result = await db.execute(
        select(ProfessionalDoc).where(
            and_(
                ProfessionalDoc.professional_id == professional.id,
                ProfessionalDoc.doc_type == DocType.SIGNATURE,
                ProfessionalDoc.status == DocStatus.APPROVED,
            )
        )
    )
    if not sig_result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail="Necesitas una firma aprobada por un administrador antes de poder emitir órdenes de "
                   "laboratorio. Sube o actualiza tu firma en tu perfil."
        )

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == data.consultation_id,
            Consultation.professional_id == professional.id
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o no te pertenece")

    if data.replaces_lab_order_id:
        orig_result = await db.execute(
            select(LabOrder).where(
                LabOrder.id == data.replaces_lab_order_id,
                LabOrder.professional_id == professional.id
            )
        )
        original = orig_result.scalar_one_or_none()
        if not original:
            raise HTTPException(status_code=404, detail="Orden original a reemplazar no encontrada o no te pertenece")
        if original.status != PrescriptionStatus.VOIDED.value:
            raise HTTPException(status_code=400, detail="Solo puedes reemplazar una orden que ya haya sido anulada")

    # Misma ventana que las recetas: durante la videollamada o recién
    # finalizada — ver GAP 3 en prescriptions.py.
    if consultation.status not in (ConsultationStatus.IN_PROGRESS, ConsultationStatus.COMPLETED):
        raise HTTPException(
            status_code=400,
            detail="Solo puedes emitir una orden de laboratorio mientras la videollamada está en curso o recién finalizada."
        )

    patient_result = await db.execute(
        select(Patient).where(Patient.id == consultation.patient_id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    today = utcnow_naive()
    age = today.year - patient.birth_date.year - (
        (today.month, today.day) < (patient.birth_date.month, patient.birth_date.day)
    )

    tests_data = [t.model_dump() for t in data.tests]
    signed_at = utcnow_naive()

    digital_hash = _generate_lab_order_hash({
        "consultation_id": data.consultation_id,
        "professional_id": professional.id,
        "patient_ci":      patient.ci,
        "tests":           str(tests_data),
        "signed_at":       signed_at.isoformat(),
    })

    qr_verify_code = f"MB-LAB-{uuid.uuid4().hex[:12].upper()}"

    lab_order = LabOrder(
        consultation_id=data.consultation_id,
        professional_id=professional.id,
        patient_name=f"{patient.first_name} {patient.last_name}",
        patient_ci=patient.ci,
        patient_age=age,
        tests=tests_data,
        clinical_indication=data.clinical_indication,
        fasting_required=data.fasting_required,
        urgency=data.urgency,
        instructions=data.instructions,
        digital_hash=digital_hash,
        qr_verify_code=qr_verify_code,
        signed_at=signed_at,
        replaces_lab_order_id=data.replaces_lab_order_id,
    )
    db.add(lab_order)
    await db.commit()
    await db.refresh(lab_order)

    logger.info(f"Orden de laboratorio emitida: {lab_order.id} | profesional: {professional.id} | paciente: {patient.id}")

    # Avisar al paciente — mismo criterio que prescriptions.py::create_prescription.
    # Solo in-app, sin WhatsApp.
    await notify_user(
        db, user_id=patient.user_id,
        title="Nueva orden de laboratorio",
        body=f"{professional_full_name(professional.first_name, professional.last_name, professional.gender)} te emitió una orden de laboratorio. Revisa el detalle en Mis Órdenes.",
        type_="LAB_ORDER_ISSUED",
        entity_type="LabOrder", entity_id=lab_order.id,
        send_whatsapp=False,
    )
    await db.commit()

    # PDF imprimible para el laboratorio/centro de imagenología — best
    # effort, mismo criterio que prescriptions.py::create_prescription: si
    # esto falla la orden YA quedó emitida y es válida por su hash+QR de
    # todos modos, no vale la pena hacer fallar todo el endpoint por esto.
    try:
        pdf_bytes = await generate_lab_order_pdf(
            patient_name=lab_order.patient_name,
            patient_ci=lab_order.patient_ci,
            patient_age=lab_order.patient_age,
            professional_name=professional_full_name(professional.first_name, professional.last_name, professional.gender),
            specialty=professional.specialty,
            sub_specialties=[professional.sub_specialty] if professional.sub_specialty else [],
            professional_license_number=professional.professional_license_number,
            cmb_matricula=professional.cmb_matricula,
            sedes_number=professional.sedes_number,
            tests=tests_data,
            clinical_indication=data.clinical_indication,
            fasting_required=data.fasting_required,
            urgency=data.urgency,
            instructions=data.instructions,
            digital_hash=digital_hash,
            qr_verify_code=qr_verify_code,
            signed_at=signed_at,
            signature_url=professional.signature_url,
        )
        lab_order.pdf_url = await upload_lab_order_pdf_to_r2(pdf_bytes, lab_order.id)
        await db.commit()
        await db.refresh(lab_order)
    except Exception as e:
        logger.error(f"No se pudo generar/subir el PDF de la orden de laboratorio {lab_order.id}: {e}")

    return await _enrich(lab_order, professional)


# ── POST /lab-orders/{id}/void ───────────────────────
@router.post(
    "/{lab_order_id}/void",
    response_model=LabOrderResponse,
    summary="Anular una orden de laboratorio firmada (para corregirla, se debe reemitir una nueva)"
)
async def void_lab_order(
    lab_order_id: str,
    data: LabOrderVoidRequest,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    lo_result = await db.execute(
        select(LabOrder).where(
            LabOrder.id == lab_order_id,
            LabOrder.professional_id == professional.id
        )
    )
    lab_order = lo_result.scalar_one_or_none()
    if not lab_order:
        raise HTTPException(status_code=404, detail="Orden no encontrada o no te pertenece")

    if lab_order.status == PrescriptionStatus.VOIDED.value:
        raise HTTPException(status_code=400, detail="Esta orden ya está anulada")

    lab_order.status = PrescriptionStatus.VOIDED.value
    lab_order.voided_at = utcnow_naive()
    lab_order.void_reason = data.reason

    # Avisar al paciente que la orden que tenía ya no es válida. Solo
    # in-app, sin WhatsApp.
    if lab_order.consultation_id:
        cons_result = await db.execute(
            select(Consultation).where(Consultation.id == lab_order.consultation_id)
        )
        void_consultation = cons_result.scalar_one_or_none()
        if void_consultation:
            patient_result = await db.execute(
                select(Patient).where(Patient.id == void_consultation.patient_id)
            )
            void_patient = patient_result.scalar_one_or_none()
            if void_patient:
                await notify_user(
                    db, user_id=void_patient.user_id,
                    title="Orden de laboratorio anulada",
                    body=f"Tu orden de laboratorio emitida por {professional_full_name(professional.first_name, professional.last_name, professional.gender)} fue anulada. Motivo: {data.reason}.",
                    type_="LAB_ORDER_VOIDED",
                    entity_type="LabOrder", entity_id=lab_order.id,
                    send_whatsapp=False,
                )

    await db.commit()
    await db.refresh(lab_order)

    logger.info(f"Orden de laboratorio anulada: {lab_order.id} | profesional: {professional.id}")
    return await _enrich(lab_order, professional)


# ── GET /lab-orders/my ────────────────────────────────
@router.get(
    "/my",
    response_model=list[LabOrderResponse],
    summary="Órdenes de laboratorio emitidas por el profesional logueado"
)
async def get_my_lab_orders(
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    result = await db.execute(
        select(LabOrder, Patient)
        .join(Consultation, LabOrder.consultation_id == Consultation.id, isouter=True)
        .join(Patient, Consultation.patient_id == Patient.id, isouter=True)
        .where(LabOrder.professional_id == professional.id)
        .order_by(LabOrder.created_at.desc())
    )
    rows = result.all()
    return [await _enrich(lo, professional, pat) for lo, pat in rows]


# ── GET /lab-orders/patient/my ───────────────────────
@router.get(
    "/patient/my",
    response_model=list[LabOrderResponse],
    summary="Órdenes de laboratorio del paciente logueado"
)
async def get_my_patient_lab_orders(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    result = await db.execute(
        select(LabOrder)
        .join(Consultation, LabOrder.consultation_id == Consultation.id)
        .where(Consultation.patient_id == patient.id)
        .order_by(LabOrder.created_at.desc())
    )
    lab_orders = result.scalars().all()

    enriched = []
    for lo in lab_orders:
        prof_result = await db.execute(
            select(Professional).where(Professional.id == lo.professional_id)
        )
        prof = prof_result.scalar_one_or_none()
        enriched.append(await _enrich(lo, prof))
    return enriched


# ── GET /lab-orders/patient/{patient_id}/mine ────────
@router.get(
    "/patient/{patient_id}/mine",
    response_model=list[LabOrderResponse],
    summary="[Profesional] Órdenes de laboratorio que yo emití para un paciente específico"
)
async def get_my_lab_orders_for_patient(
    patient_id: str,
    current_user: User = Depends(get_current_professional),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Perfil profesional no encontrado")

    result = await db.execute(
        select(LabOrder, Patient)
        .join(Consultation, LabOrder.consultation_id == Consultation.id)
        .join(Patient, Consultation.patient_id == Patient.id, isouter=True)
        .where(
            LabOrder.professional_id == professional.id,
            Consultation.patient_id == patient_id,
        )
        .order_by(LabOrder.created_at.desc())
    )
    rows = result.all()
    return [await _enrich(lo, professional, pat) for lo, pat in rows]


# ── GET /lab-orders/consultation/{id} ────────────────
@router.get(
    "/consultation/{consultation_id}",
    response_model=list[LabOrderResponse],
    summary="Obtener órdenes de laboratorio de una consulta"
)
async def get_by_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(LabOrder).where(LabOrder.consultation_id == consultation_id)
    )
    lab_orders = result.scalars().all()

    enriched = []
    for lo in lab_orders:
        prof_result = await db.execute(
            select(Professional).where(Professional.id == lo.professional_id)
        )
        prof = prof_result.scalar_one_or_none()
        enriched.append(await _enrich(lo, prof))
    return enriched


# ── GET /lab-orders/verify/{code} ────────────────────
@router.get(
    "/verify/{code}",
    summary="Verificar autenticidad de una orden de laboratorio (para laboratorios)"
)
async def verify_lab_order(
    code: str,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(LabOrder).where(LabOrder.qr_verify_code == code)
    )
    lab_order = result.scalar_one_or_none()

    if not lab_order:
        return {
            "valid": False,
            "message": "Código no encontrado. Esta orden podría ser inválida o haber sido alterada."
        }

    prof_result = await db.execute(
        select(Professional).where(Professional.id == lab_order.professional_id)
    )
    professional = prof_result.scalar_one_or_none()

    if lab_order.status == PrescriptionStatus.VOIDED.value:
        return {
            "valid":         False,
            "status":        "VOIDED",
            "lab_order_id":  lab_order.id,
            "voided_at":     lab_order.voided_at.isoformat() if lab_order.voided_at else None,
            "void_reason":   lab_order.void_reason,
            "message":       "Esta orden fue ANULADA por el médico que la emitió y ya no es válida. "
                              "Si el paciente presenta una orden nueva, verifica ese código en su lugar."
        }

    # pdf_url se guarda internamente como r2://bucket/key (bucket privado) —
    # hay que firmarlo antes de exponerlo en esta página pública.
    pdf_url = None
    if lab_order.pdf_url:
        if lab_order.pdf_url.startswith("r2://") or lab_order.pdf_url.startswith("s3://"):
            try:
                pdf_url = await get_presigned_url(lab_order.pdf_url, expires_seconds=3600)
            except Exception as e:
                logger.error(f"No se pudo firmar la URL del PDF de la orden {lab_order.id}: {e}")
        else:
            pdf_url = lab_order.pdf_url

    return {
        "valid":                  True,
        "status":                 "ACTIVE",
        "lab_order_id":           lab_order.id,
        "qr_code":                lab_order.qr_verify_code,
        "digital_hash":           lab_order.digital_hash,
        "patient_name":           lab_order.patient_name,
        "patient_ci":             lab_order.patient_ci,
        "patient_age":            lab_order.patient_age,
        "tests":                  lab_order.tests,
        "clinical_indication":    lab_order.clinical_indication,
        "fasting_required":       lab_order.fasting_required,
        "urgency":                lab_order.urgency,
        "instructions":           lab_order.instructions,
        "signed_at":              lab_order.signed_at.isoformat(),
        "professional_name":      professional_full_name(professional.first_name, professional.last_name, professional.gender) if professional else "Desconocido",
        "professional_specialty": professional.specialty if professional else "",
        "professional_license_number": professional.professional_license_number if professional else "",
        "cmb_matricula":          professional.cmb_matricula if professional else "",
        "professional_signature_url": professional.signature_url if professional else None,
        "pdf_url":                pdf_url,
        "message":                "Orden válida y auténtica. Emitida por MedicBolivia."
    }
