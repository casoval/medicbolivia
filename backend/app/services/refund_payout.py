"""
app/services/refund_payout.py
Fase 1 (semi-automática) de reembolso a PACIENTES — espejo de
app/services/payout.py, que resuelve el mismo problema para profesionales.
El banco (Banco Ganadero, ver app/services/bank_qr.py) solo expone
servicios de COBRO (generar QR, anular QR, listar transacciones); no hay
ningún servicio de reversa/transferencia saliente. El flujo es:

    Un admin (o una cancelación/disputa automática) decide reembolsar
    (ver app.services.payment.mark_payment_refunded)
            ↓
    Payment.status = REFUNDED_FULL/PARTIAL (foto contable, refunded_at)
    + se le pide al paciente a dónde transferirle (request_refund_account)
            ↓
    El paciente completa PatientRefundAccount (cuenta bancaria o
    billetera móvil / QR interpersonal — ver PUT /patients/me/refunds/{id}/account)
            ↓
    Admin ve la cola de "listos para pagar" (get_pending_refunds_summary),
    transfiere A MANO (banca en línea, QR persona-a-persona, Tigo Money)
            ↓
    Admin confirma (confirm_refund_paid_out) → Payment.refund_paid_out_at
    + aviso por WhatsApp/in-app al paciente

A diferencia de los payouts a profesionales, acá NO se arman lotes/CSV:
el volumen de reembolsos es esporádico y cada uno tiene un destino propio
(el paciente puede reembolsarse a una cuenta distinta cada vez), así que
alcanza con una cola simple que el admin va resolviendo uno por uno.
"""
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezone import utcnow_naive
from app.models.models import (
    Payment, PaymentStatus, Patient, AuditLog,
)
from app.services.notify import notify_user


async def request_refund_account(db: AsyncSession, payment: Payment) -> None:
    """
    Avisa al paciente que su reembolso fue aprobado y que hace falta que
    indique a dónde transferírselo. Se llama automáticamente desde
    app.services.payment.mark_payment_refunded — no hace falta invocarla
    a mano salvo para reenviar el aviso (ej. el paciente no respondió).
    """
    result = await db.execute(select(Patient).where(Patient.id == payment.patient_id))
    patient = result.scalar_one_or_none()
    if not patient:
        return

    amount = payment.refunded_amount if payment.refunded_amount is not None else payment.amount
    await notify_user(
        db, user_id=patient.user_id,
        title="💸 Reembolso aprobado — nos faltan tus datos",
        body=(
            f"Tu reembolso de Bs. {amount:.2f} fue aprobado. Indícanos a dónde "
            "transferírtelo (cuenta bancaria o billetera móvil/QR) desde "
            "Mis Pagos para poder procesarlo."
        ),
        type_="REFUND_PENDING_ACCOUNT_INFO",
        entity_type="Payment", entity_id=payment.id,
    )


async def _pending_refunds(db: AsyncSession):
    """Pagos con reembolso aprobado (foto contable) pero todavía sin
    transferir de verdad."""
    result = await db.execute(
        select(Payment)
        .options(selectinload(Payment.patient), selectinload(Payment.refund_account))
        .where(
            Payment.status.in_([PaymentStatus.REFUNDED_FULL, PaymentStatus.REFUNDED_PARTIAL]),
            Payment.refund_paid_out_at.is_(None),
        )
        .order_by(Payment.refunded_at.asc())
    )
    return result.scalars().all()


async def get_pending_refunds_summary(db: AsyncSession) -> dict:
    """
    Separa los reembolsos aprobados y no pagados en dos colas para el
    admin, igual que get_pending_payouts_summary hace con profesionales:
      - ready_to_pay: el paciente ya indicó a dónde transferirle.
      - awaiting_account: todavía no respondió — nada que transferir aún.
    """
    payments = await _pending_refunds(db)

    ready_to_pay = []
    awaiting_account = []
    zero = Decimal("0.00")

    for p in payments:
        amount = p.refunded_amount if p.refunded_amount is not None else p.amount
        patient_name = f"{p.patient.first_name} {p.patient.last_name}" if p.patient else "—"
        item = {
            "payment_id": p.id,
            "consultation_id": p.consultation_id,
            "patient_id": p.patient_id,
            "patient_name": patient_name,
            "amount": amount,
            "refunded_at": p.refunded_at,
            "refund_note": p.refund_note,
        }
        account = p.refund_account
        if account is None:
            awaiting_account.append(item)
        else:
            if account.method.value == "BANK":
                destination = f"{account.bank_name} ****{account.account_number_last4}"
            else:
                destination = f"{account.wallet_provider} · {account.phone_number}"
            ready_to_pay.append({
                **item,
                "method": account.method,
                "destination": destination,
                "account_holder_name": account.account_holder_name,
            })

    return {
        "ready_to_pay": ready_to_pay,
        "awaiting_account": awaiting_account,
        "ready_to_pay_total": sum((i["amount"] for i in ready_to_pay), zero),
        "awaiting_account_total": sum((i["amount"] for i in awaiting_account), zero),
    }


async def confirm_refund_paid_out(
    db: AsyncSession, payment: Payment, admin_user_id: str, reference_note: Optional[str] = None
) -> None:
    """Marca que el admin ya transfirió de verdad el reembolso y avisa al paciente."""
    if payment.status not in (PaymentStatus.REFUNDED_FULL, PaymentStatus.REFUNDED_PARTIAL):
        raise ValueError("Este pago no tiene un reembolso aprobado pendiente de pagar.")
    if payment.refund_paid_out_at is not None:
        raise ValueError("Este reembolso ya fue marcado como pagado.")

    now = utcnow_naive()
    payment.refund_paid_out_at = now
    payment.refund_payout_reference_note = reference_note

    db.add(AuditLog(
        user_id=admin_user_id, action="REFUND_PAID_OUT",
        entity_type="Payment", entity_id=payment.id,
        metadata_={
            "amount": str(payment.refunded_amount or payment.amount),
            "reference_note": reference_note,
        },
    ))

    result = await db.execute(select(Patient).where(Patient.id == payment.patient_id))
    patient = result.scalar_one_or_none()
    if patient:
        amount = payment.refunded_amount if payment.refunded_amount is not None else payment.amount
        await notify_user(
            db, user_id=patient.user_id,
            title="✅ Reembolso transferido",
            body=f"Tu reembolso de Bs. {amount:.2f} fue transferido. Revisa el detalle en Mis Pagos.",
            type_="REFUND_PAID_OUT",
            entity_type="Payment", entity_id=payment.id,
        )
