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
    """
    minutes = expiry_minutes if expiry_minutes is not None else settings.QR_EXPIRY_MINUTES
    expires_at = datetime.utcnow() + timedelta(minutes=minutes)
    tx_id = str(uuid.uuid4()).replace("-", "")[:16].upper()

    # Datos del QR en formato boliviano
    qr_content = f"MEDICBOLIVIA|{consultation_id}|{amount}|{tx_id}|{expires_at.isoformat()}"

    # URL de imagen QR usando API pública (en producción: QR del banco)
    qr_image_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={qr_content}&format=png"

    platform_fee = amount * Decimal(str(settings.PLATFORM_FEE_PERCENT))
    professional_net = amount - platform_fee

    return {
        "qr_code": qr_content,
        "qr_image_url": qr_image_url,
        "tx_id": tx_id,
        "expires_at": expires_at,
        "amount": amount,
        "platform_fee": platform_fee,
        "professional_net": professional_net,
    }


def calculate_amounts(consultation_amount: Decimal) -> dict:
    """Calcula la distribución del pago."""
    platform_fee = consultation_amount * Decimal(str(settings.PLATFORM_FEE_PERCENT))
    professional_net = consultation_amount - platform_fee
    return {
        "amount": consultation_amount,
        "platform_fee": platform_fee.quantize(Decimal("0.01")),
        "professional_net": professional_net.quantize(Decimal("0.01")),
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