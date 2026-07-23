"""
app/services/consultation_actions.py
Lógica de negocio compartida para aceptar/rechazar una consulta —
extraída de app/api/v1/endpoints/consultations.py para que la pueda usar
tanto el endpoint HTTP (POST /consultations/{id}/accept|reject, el
profesional aceptando desde la app) como el webhook de WhatsApp (el
profesional respondiendo "1"/"2" al aviso de "paciente esperando").

Una sola fuente de verdad para las reglas de negocio (chequeo de choque de
horario, de estar ya en otra consulta en curso, notificación al paciente,
devolución si corresponde) — así los dos canales no pueden divergir con el
tiempo.
"""
from datetime import timedelta
from app.core.timezone import utcnow_naive
from typing import Optional

from fastapi import BackgroundTasks
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import (
    Consultation, ConsultationStatus, ConsultationType, Professional, Patient,
    Payment, PaymentStatus, Notification,
)


class ConsultationActionError(Exception):
    """Error de negocio al aceptar/rechazar — el mensaje ya está listo para
    mostrarse tal cual al usuario final, sea en la app (HTTPException) o en
    WhatsApp (texto de respuesta)."""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


async def get_waiting_consultation_for_professional(
    db: AsyncSession, professional_id: str, consultation_id: str
) -> Consultation:
    result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional_id,
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL,
        )
    )
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise ConsultationActionError("Consulta no encontrada o ya no está en espera", 404)
    return consultation


async def get_latest_pending_immediate_consultation(
    db: AsyncSession, professional_id: str
) -> Optional[Consultation]:
    """
    La consulta INMEDIATA más reciente que sigue esperando la aceptación de
    este profesional. La usa el webhook de WhatsApp para saber a qué
    consulta se refiere un profesional que responde "1"/"2" sin repetir el
    ID — no tendría sentido pedírselo por chat, y en la práctica un
    profesional casi nunca tiene más de una consulta inmediata esperando a
    la vez (el timeout de 5 min la cancela antes de que se acumulen).
    """
    result = await db.execute(
        select(Consultation)
        .where(
            Consultation.professional_id == professional_id,
            Consultation.consultation_type == ConsultationType.IMMEDIATE,
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL,
        )
        .order_by(Consultation.created_at.desc())
    )
    return result.scalars().first()


async def accept_consultation_core(
    db: AsyncSession,
    professional: Professional,
    consultation: Consultation,
    background_tasks: BackgroundTasks,
) -> None:
    """
    Deja la consulta lista para que el paciente pague (inmediata) o
    confirmada (agendada/seguimiento). Mismas reglas para los dos canales
    de entrada (app, WhatsApp): valida choque de horario/ocupación y
    levanta ConsultationActionError con un mensaje presentable si algo no
    corresponde. No hace commit del caller — si algo fuera mal después de
    llamar esta función, es responsabilidad del caller.
    """
    if consultation.consultation_type == ConsultationType.IMMEDIATE:
        busy_result = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == professional.id,
                Consultation.status == ConsultationStatus.IN_PROGRESS,
            )
        )
        if busy_result.scalar_one_or_none():
            raise ConsultationActionError(
                "Estás en otra consulta en este momento. Termínala antes de aceptar una nueva.", 409
            )

    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP) and consultation.scheduled_at:
        duration = timedelta(minutes=professional.appointment_duration_minutes or 30)
        new_start = consultation.scheduled_at
        new_end = new_start + duration

        confirmed_statuses = [
            ConsultationStatus.WAITING_PAYMENT,
            ConsultationStatus.PAYMENT_CONFIRMED,
            ConsultationStatus.IN_PROGRESS,
        ]
        others_result = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == professional.id,
                Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                Consultation.id != consultation.id,
                Consultation.status.in_(confirmed_statuses),
                Consultation.scheduled_at.isnot(None),
            )
        )
        for other in others_result.scalars().all():
            other_start = other.scheduled_at
            other_end = other_start + timedelta(minutes=professional.appointment_duration_minutes or 30)
            if new_start < other_end and other_start < new_end:
                raise ConsultationActionError(
                    f"Esta cita ({new_start.strftime('%d/%m %H:%M')}) se solapa con otra "
                    f"que ya aceptaste el {other_start.strftime('%d/%m %H:%M')}. "
                    "Rechaza una de las dos antes de continuar.",
                    409,
                )

    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        consultation.status = ConsultationStatus.PAYMENT_CONFIRMED

        patient_result_n = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient_n = patient_result_n.scalar_one_or_none()
        if patient_n:
            db.add(Notification(
                user_id=patient_n.user_id,
                title="¡Cita confirmada!",
                body=f"Tu cita del {consultation.scheduled_at.strftime('%d/%m/%Y a las %H:%M')} fue confirmada por el profesional.",
                type="CONSULTATION_CONFIRMED",
                entity_type="Consultation",
                entity_id=consultation.id,
            ))
    else:
        consultation.status = ConsultationStatus.WAITING_PAYMENT
        # Import local para evitar import circular (consultations.py importa
        # de este módulo también) — mismo patrón que ya usa el resto del
        # archivo con notify_professional_patient_waiting.
        from app.api.v1.endpoints.consultations import auto_cancel_payment_expired
        background_tasks.add_task(auto_cancel_payment_expired, consultation.id, settings.DATABASE_URL)

    await db.commit()
    logger.info(f"Consulta {consultation.id} aceptada por profesional {professional.id}")


async def reject_consultation_core(
    db: AsyncSession, professional: Professional, consultation: Consultation
) -> None:
    consultation.status = ConsultationStatus.CANCELLED
    consultation.outcome_note = "REJECTED_BY_PROFESSIONAL"

    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        pay_result = await db.execute(
            select(Payment).where(
                Payment.consultation_id == consultation.id,
                Payment.status == PaymentStatus.CONFIRMED,
            )
        )
        payment = pay_result.scalar_one_or_none()
        if payment:
            payment.status = PaymentStatus.REFUNDED_FULL
            payment.refunded_at = utcnow_naive()
            payment.refund_note = "Devolución automática: el profesional no pudo atender la cita."

        patient_result_r = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient_r = patient_result_r.scalar_one_or_none()
        if patient_r:
            db.add(Notification(
                user_id=patient_r.user_id,
                title="Cita no disponible — devolución en camino",
                body=f"El profesional no pudo confirmar tu cita del {consultation.scheduled_at.strftime('%d/%m/%Y a las %H:%M')}. Se procesará la devolución completa.",
                type="CONSULTATION_REJECTED_REFUND",
                entity_type="Consultation",
                entity_id=consultation.id,
            ))

    await db.commit()
    logger.info(f"Consulta {consultation.id} rechazada por profesional {professional.id}")
