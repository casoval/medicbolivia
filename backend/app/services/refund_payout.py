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
            ↓
    ¿El paciente ya tiene PatientRefundAccount verificada en su Perfil?
      SÍ → entra directo a "listos para pagar", no hace falta pedirle nada.
      NO → se le avisa que la cargue (o, si la cargó pero está sin
           verificar todavía, se avisa a los admins para que la revisen).
            ↓
    Admin ve la cola de "listos para pagar" (get_pending_refunds_summary),
    transfiere A MANO (banca en línea, QR persona-a-persona, Tigo Money)
            ↓
    Admin confirma (confirm_refund_paid_out) → Payment.refund_paid_out_at
    + aviso por WhatsApp/in-app al paciente

A diferencia de los payouts a profesionales, acá NO se arman lotes/CSV:
cada reembolso se confirma individualmente (el volumen es esporádico),
pero SÍ se comparte el mismo criterio de "cuenta verificada" antes de
poder pagar — ver PatientRefundAccount.verified.
"""
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezone import utcnow_naive
from app.models.models import (
    Payment, PaymentStatus, Patient,
    User, UserRole, AuditLog,
)
from app.services.notify import notify_user


async def request_refund_account(db: AsyncSession, payment: Payment) -> None:
    """
    Se llama automáticamente desde app.services.payment.mark_payment_refunded
    cada vez que se aprueba un reembolso. Si el paciente ya tiene una
    cuenta de reembolso VERIFICADA cargada en su Perfil, no hace falta
    avisarle nada — el reembolso ya queda "listo para pagar". Si no tiene
    cuenta, se le pide que la cargue; si la tiene pero todavía no fue
    verificada, se avisa a los admins para que la revisen (no tiene
    sentido volver a molestar al paciente por algo que ya completó).
    """
    result = await db.execute(
        select(Patient)
        .options(selectinload(Patient.refund_account))
        .where(Patient.id == payment.patient_id)
    )
    patient = result.scalar_one_or_none()
    if not patient:
        return

    amount = payment.refunded_amount if payment.refunded_amount is not None else payment.amount
    account = patient.refund_account

    if account is None:
        await notify_user(
            db, user_id=patient.user_id,
            title="💸 Reembolso aprobado — falta tu cuenta para pagarte",
            body=(
                f"Tu reembolso de Bs. {amount:.2f} fue aprobado. Registra tu cuenta "
                "bancaria en tu Perfil para que el equipo pueda transferírtelo. Si no "
                "tienes una cuenta bancaria, el equipo administrativo se pondrá en "
                "contacto contigo para coordinar otra forma de pago."
            ),
            type_="REFUND_PENDING_ACCOUNT_INFO",
            entity_type="Payment", entity_id=payment.id,
            # Solo in-app: no es urgente por minutos, el paciente lo ve
            # la próxima vez que entra a la app.
            send_whatsapp=False,
        )
    elif not account.verified:
        admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        for admin in admins_result.scalars().all():
            await notify_user(
                db, user_id=admin.id,
                title="Reembolso esperando cuenta por verificar",
                body=(
                    f"{patient.first_name} {patient.last_name} tiene un reembolso de "
                    f"Bs. {amount:.2f} aprobado, pero su cuenta de reembolso todavía no "
                    "está verificada. Revísala para poder pagarle."
                ),
                type_="REFUND_ACCOUNT_PENDING_REVIEW",
                send_whatsapp=False,
            )
    # Si ya tiene cuenta verificada, no hace falta avisar a nadie — el
    # reembolso ya aparece directo en la cola de "listos para pagar".


async def _pending_refunds(db: AsyncSession):
    """Pagos con reembolso aprobado (foto contable) pero todavía sin
    transferir de verdad."""
    result = await db.execute(
        select(Payment)
        .options(selectinload(Payment.patient).selectinload(Patient.refund_account))
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
      - ready_to_pay: el paciente tiene una cuenta de reembolso VERIFICADA.
      - awaiting_account: no tiene cuenta, o la tiene pero sin verificar.
    A diferencia de los profesionales, acá no se agrupa por paciente: cada
    reembolso es un pago puntual y se confirma uno por uno.
    """
    payments = await _pending_refunds(db)

    ready_to_pay = []
    awaiting_account = []
    zero = Decimal("0.00")

    for p in payments:
        amount = p.refunded_amount if p.refunded_amount is not None else p.amount
        patient = p.patient
        account = patient.refund_account if patient else None
        verified = bool(account and account.verified)
        patient_name = f"{patient.first_name} {patient.last_name}" if patient else "—"
        item = {
            "payment_id": p.id,
            "consultation_id": p.consultation_id,
            "patient_id": p.patient_id,
            "patient_name": patient_name,
            "amount": amount,
            "refunded_at": p.refunded_at,
            "refund_note": p.refund_note,
            "has_refund_account": account is not None,
        }
        if verified:
            destination = f"{account.bank_name} ****{account.account_number_last4}"
            ready_to_pay.append({
                **item,
                "destination": destination,
                "account_holder_name": account.account_holder_name,
            })
        else:
            awaiting_account.append(item)

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

    result = await db.execute(
        select(Patient).options(selectinload(Patient.refund_account)).where(Patient.id == payment.patient_id)
    )
    patient = result.scalar_one_or_none()
    if patient:
        amount = payment.refunded_amount if payment.refunded_amount is not None else payment.amount
        account = patient.refund_account
        destination_label = (
            f" a tu cuenta {account.bank_name} terminada en ****{account.account_number_last4}"
            if account else ""
        )
        await notify_user(
            db, user_id=patient.user_id,
            title="✅ Reembolso transferido",
            body=f"Tu reembolso de Bs. {amount:.2f} fue transferido{destination_label}. Revisa el detalle en Mis Pagos.",
            type_="REFUND_PAID_OUT",
            entity_type="Payment", entity_id=payment.id,
            # Solo in-app — mismo criterio que el aviso de "reembolso
            # aprobado" de arriba. Además esta función puede recorrer
            # varios pagos de un mismo lote sin escalonar el envío; sacarla
            # de WhatsApp evita ese riesgo de ráfaga de raíz.
            send_whatsapp=False,
        )
