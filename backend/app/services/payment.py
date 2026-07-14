"""
app/services/payment.py
Servicio de pagos QR para Bolivia.
Maneja generación de QR, confirmación de pago vía webhook y liberación al profesional.
"""
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from loguru import logger

from app.core.config import settings


def generate_qr_data(
    consultation_id: str,
    amount: Decimal,
    professional_name: str,
    expiry_minutes: int | None = None,
) -> dict:
    """
    Genera los datos para el QR de pago.

    En producción: llamar a la API de la pasarela bancaria boliviana
    (BNB Simple Cobro, Pago Express, etc.) que devuelve un string EMVCo.

    Por ahora genera un QR funcional con los datos de la transacción.

    expiry_minutes: tiempo de vida del QR. Si no se indica, usa QR_EXPIRY_MINUTES
    de la config (5 min para inmediatas). Para citas agendadas pasar 30.

    Nota: el monto de la comisión NO se calcula aquí — ya viene resuelto y
    guardado en la Consultation desde que se creó (ver
    app.services.commission.resolve_commission_percent). Este QR solo
    representa el cobro del monto total al paciente.
    """
    minutes = expiry_minutes if expiry_minutes is not None else settings.QR_EXPIRY_MINUTES
    expires_at = datetime.utcnow() + timedelta(minutes=minutes)
    tx_id = str(uuid.uuid4()).replace("-", "")[:16].upper()

    # Datos del QR en formato boliviano
    qr_content = f"MEDICBOLIVIA|{consultation_id}|{amount}|{tx_id}|{expires_at.isoformat()}"

    # URL de imagen QR usando API pública (en producción: QR del banco)
    qr_image_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={qr_content}&format=png"

    return {
        "qr_code": qr_content,
        "qr_image_url": qr_image_url,
        "tx_id": tx_id,
        "expires_at": expires_at,
        "amount": amount,
    }


def compute_professional_scheduled_qr_deadline(scheduled_at: datetime, now: datetime | None = None) -> datetime:
    """
    Plazo de pago del QR cuando la cita la agenda directamente el
    profesional (agendamiento libre de membresía — ver
    /consultations/professional-schedule), donde no aplican los 30 min
    fijos de siempre porque la cita puede agendarse con días de
    anticipación.

    Regla (definida junto al usuario):
      - Si faltan más de 2h para la cita al momento de agendar: el
        paciente puede pagar hasta 1h antes de que empiece.
      - Si faltan 2h o menos: el paciente puede pagar hasta 10 min antes.
      - Piso de seguridad: nunca menos de 5 min desde "ahora", para que
        una cita agendada casi encima del horario (ej. en 3 minutos)
        igual le dé al paciente un margen real para pagar.
    """
    now = now or datetime.utcnow()
    lead_time = scheduled_at - now

    if lead_time > timedelta(hours=2):
        deadline = scheduled_at - timedelta(hours=1)
    else:
        deadline = scheduled_at - timedelta(minutes=10)

    floor = now + timedelta(minutes=5)
    return max(deadline, floor)


def calculate_amounts(consultation_amount: Decimal, commission_percent: Decimal) -> dict:
    """
    Calcula la distribución del pago dado un % de comisión ya resuelto
    (en formato 0-100, ej. Decimal("10.00") = 10%).

    El % debe venir de app.services.commission.resolve_commission_percent —
    esta función ya no decide el %, solo hace la aritmética, para que el
    mismo cálculo sirva tanto para la comisión global por defecto como
    para promociones por período o comisiones individuales por profesional.
    """
    fraction = commission_percent / Decimal("100")
    platform_fee = consultation_amount * fraction
    professional_net = consultation_amount - platform_fee
    return {
        "amount": consultation_amount,
        "platform_fee": platform_fee.quantize(Decimal("0.01")),
        "professional_net": professional_net.quantize(Decimal("0.01")),
        "commission_percent": commission_percent,
    }

async def process_refund(
    consultation_id: str,
    refund_type: str,
    reason: str,
    admin_id: str,
    db=None
) -> None:
    """Procesa un reembolso — actualiza el estado del pago."""
    if db is None:
        return

    from app.models.models import Payment, PaymentStatus, AuditLog
    from sqlalchemy import select

    result = await db.execute(
        select(Payment).where(Payment.consultation_id == consultation_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        return

    payment.status = (
        PaymentStatus.REFUNDED_FULL
        if refund_type == "FULL"
        else PaymentStatus.REFUNDED_PARTIAL
    )
    from datetime import datetime
    payment.refunded_at = datetime.utcnow()
    payment.refund_note = reason

    log = AuditLog(
        user_id=admin_id,
        action=f"REFUND_{refund_type}",
        entity_type="Payment",
        entity_id=payment.id,
        metadata_={"reason": reason, "amount": str(payment.amount)},
    )
    db.add(log)
    await db.commit()