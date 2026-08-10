"""
app/services/payout.py
Fase 1 (semi-automática) de pago del % a profesionales — ver el documento
de diseño "diseno-pagos-profesionales.md". Todavía no hay integración
bancaria de transferencias salientes (solo existe la de COBRO por QR, ver
app/services/bank_qr.py), así que el flujo es:

    Earning liberado (released_at, ya existía)
            ↓
    Admin arma un PayoutBatch (DRAFT) con los earnings pagables
            ↓
    Admin exporta el CSV (EXPORTED) y lo sube a mano a su banca en línea
            ↓
    Admin confirma el lote (CONFIRMED) → Earning.paid_out_at +
    Payment.status = PAID_OUT + aviso por WhatsApp/in-app a cada profesional

Un profesional SOLO entra en un lote si tiene una ProfessionalBankAccount
con verified=True. A los que no, nunca se los incluye automáticamente —
se les avisa aparte para que el equipo coordine otro método de pago (ver
notify_professionals_without_bank_account).
"""
import csv
import io
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.timezone import utcnow_naive
from app.models.models import (
    Earning, Payment, PaymentStatus, Professional, ProfessionalBankAccount,
    PayoutBatch, PayoutBatchStatus, User, UserRole, AuditLog,
)
from app.services.notify import notify_user


async def _pending_earnings(db: AsyncSession):
    """Earning liberados, no pagados y todavía sin lote asignado."""
    result = await db.execute(
        select(Earning)
        .options(selectinload(Earning.professional).selectinload(Professional.bank_account))
        .where(
            Earning.released_at.is_not(None),
            Earning.paid_out_at.is_(None),
            Earning.payout_batch_id.is_(None),
        )
        .order_by(Earning.released_at.asc())
    )
    return result.scalars().all()


async def get_pending_payouts_summary(db: AsyncSession) -> dict:
    """
    Agrupa por profesional lo pendiente de pagar, separando a quienes SÍ
    tienen cuenta bancaria verificada (entran en el próximo lote, "payable")
    de quienes NO (hay que coordinar con ellos aparte, "blocked").
    """
    earnings = await _pending_earnings(db)

    by_professional: dict[str, dict] = {}
    for e in earnings:
        prof = e.professional
        if prof.id not in by_professional:
            account = prof.bank_account
            by_professional[prof.id] = {
                "professional_id": prof.id,
                "professional_name": f"{prof.first_name} {prof.last_name}",
                "has_bank_account": account is not None,
                "bank_account_verified": bool(account and account.verified),
                "bank_name": account.bank_name if account else None,
                "account_number_masked": f"****{account.account_number_last4}" if account else None,
                "earning_count": 0,
                "total_amount": Decimal("0.00"),
            }
        entry = by_professional[prof.id]
        entry["earning_count"] += 1
        entry["total_amount"] += e.amount

    items = list(by_professional.values())
    payable = [i for i in items if i["bank_account_verified"]]
    blocked = [i for i in items if not i["bank_account_verified"]]
    zero = Decimal("0.00")
    return {
        "payable": payable,
        "blocked": blocked,
        "payable_total": sum((i["total_amount"] for i in payable), zero),
        "blocked_total": sum((i["total_amount"] for i in blocked), zero),
    }


async def create_payout_batch(
    db: AsyncSession, admin_user_id: str, professional_ids: Optional[list[str]] = None
) -> PayoutBatch:
    """
    Crea un lote DRAFT con los Earning elegibles: liberados, no pagados,
    y de un profesional con cuenta bancaria VERIFICADA. Si se pasa
    `professional_ids`, solo incluye a esos (útil para re-armar un lote
    más chico). Nunca incluye a un profesional sin cuenta verificada,
    aunque esté en la lista — simplemente lo ignora.
    """
    earnings = await _pending_earnings(db)
    eligible = [
        e for e in earnings
        if e.professional.bank_account and e.professional.bank_account.verified
        and (professional_ids is None or e.professional_id in professional_ids)
    ]
    if not eligible:
        raise ValueError(
            "No hay ganancias liberadas y pagables para armar un lote — "
            "revisa que haya profesionales con cuenta bancaria verificada."
        )

    batch = PayoutBatch(
        status=PayoutBatchStatus.DRAFT,
        period_end=utcnow_naive(),
        total_amount=sum((e.amount for e in eligible), Decimal("0.00")),
        professional_count=len({e.professional_id for e in eligible}),
        created_by=admin_user_id,
    )
    db.add(batch)
    await db.flush()

    for e in eligible:
        e.payout_batch_id = batch.id

    db.add(AuditLog(
        user_id=admin_user_id, action="PAYOUT_BATCH_CREATED",
        entity_type="PayoutBatch", entity_id=batch.id,
        metadata_={
            "total_amount": str(batch.total_amount),
            "professional_count": batch.professional_count,
            "earning_count": len(eligible),
        },
    ))
    return batch


async def generate_batch_csv(db: AsyncSession, batch: PayoutBatch) -> str:
    """
    Arma el CSV para subir a la banca en línea empresarial: una fila por
    profesional con cuenta destino + monto total del lote. Columnas y
    formato genéricos — hay que ajustarlos al formato exacto que pida el
    banco cuando se implemente la Fase 2 (o incluso antes, según lo que
    acepte el portal de banca empresarial que usen para subir el archivo).
    """
    from app.core.crypto import decrypt_value

    result = await db.execute(
        select(Earning)
        .options(selectinload(Earning.professional).selectinload(Professional.bank_account))
        .where(Earning.payout_batch_id == batch.id)
    )
    earnings = result.scalars().all()

    by_professional: dict[str, dict] = {}
    for e in earnings:
        prof = e.professional
        if prof.id not in by_professional:
            by_professional[prof.id] = {"professional": prof, "total": Decimal("0.00"), "count": 0}
        by_professional[prof.id]["total"] += e.amount
        by_professional[prof.id]["count"] += 1

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "profesional", "ci_profesional", "banco", "tipo_cuenta",
        "numero_cuenta", "titular", "ci_titular", "monto_bob",
        "cantidad_consultas", "glosa",
    ])
    for entry in by_professional.values():
        prof = entry["professional"]
        account = prof.bank_account
        writer.writerow([
            f"{prof.first_name} {prof.last_name}",
            prof.ci,
            account.bank_name,
            account.account_type.value if hasattr(account.account_type, "value") else account.account_type,
            decrypt_value(account.account_number_encrypted),
            account.account_holder_name,
            decrypt_value(account.account_holder_ci_encrypted),
            f"{entry['total']:.2f}",
            entry["count"],
            f"MedicBolivia - liquidacion {batch.period_end.strftime('%d/%m/%Y')}",
        ])
    return buffer.getvalue()


async def confirm_payout_batch(
    db: AsyncSession, batch: PayoutBatch, admin_user_id: str, bank_reference_note: Optional[str] = None
) -> None:
    """Marca el lote como pagado de verdad: sella cada Earning/Payment
    incluido y avisa a cada profesional por WhatsApp/in-app."""
    result = await db.execute(
        select(Earning)
        .options(selectinload(Earning.payment))
        .where(Earning.payout_batch_id == batch.id)
    )
    earnings = result.scalars().all()

    now = utcnow_naive()
    by_professional: dict[str, Decimal] = {}
    for e in earnings:
        e.paid_out_at = now
        if e.payment and e.payment.status == PaymentStatus.RELEASED_TO_PROFESSIONAL:
            e.payment.status = PaymentStatus.PAID_OUT
        by_professional[e.professional_id] = by_professional.get(e.professional_id, Decimal("0.00")) + e.amount

    batch.status = PayoutBatchStatus.CONFIRMED
    batch.confirmed_by = admin_user_id
    batch.confirmed_at = now
    batch.bank_reference_note = bank_reference_note

    db.add(AuditLog(
        user_id=admin_user_id, action="PAYOUT_BATCH_CONFIRMED",
        entity_type="PayoutBatch", entity_id=batch.id,
        metadata_={"total_amount": str(batch.total_amount), "bank_reference_note": bank_reference_note},
    ))

    for prof_id, total in by_professional.items():
        prof_result = await db.execute(
            select(Professional).options(selectinload(Professional.bank_account)).where(Professional.id == prof_id)
        )
        prof = prof_result.scalar_one_or_none()
        if not prof:
            continue
        account = prof.bank_account
        bank_label = f" a tu cuenta {account.bank_name} terminada en ****{account.account_number_last4}" if account else ""
        await notify_user(
            db, user_id=prof.user_id,
            title="💰 Pago transferido",
            body=f"Tu pago de Bs. {total:.2f} fue transferido{bank_label}. Revisa el detalle en Mis Ganancias.",
            type_="PAYOUT_CONFIRMED",
            entity_type="PayoutBatch", entity_id=batch.id,
            # Solo in-app: es informativo, no urgente por minutos — el
            # profesional lo revisa en Mis Ganancias cuando entra. Además
            # este bucle manda un WhatsApp por profesional del lote SIN
            # escalonar (ver notify_admins_new_review para el criterio de
            # riesgo de bloqueo por ráfaga) — sacarla de WhatsApp evita
            # ese riesgo de raíz en vez de tener que espaciar el envío.
            send_whatsapp=False,
        )


async def cancel_payout_batch(db: AsyncSession, batch: PayoutBatch, admin_user_id: str) -> None:
    """Solo para lotes DRAFT/EXPORTED que todavía no se confirmaron —
    libera los Earning para que vuelvan a aparecer como pendientes."""
    if batch.status == PayoutBatchStatus.CONFIRMED:
        raise ValueError("No se puede cancelar un lote ya confirmado.")

    result = await db.execute(select(Earning).where(Earning.payout_batch_id == batch.id))
    for e in result.scalars().all():
        e.payout_batch_id = None

    batch.status = PayoutBatchStatus.CANCELLED
    db.add(AuditLog(
        user_id=admin_user_id, action="PAYOUT_BATCH_CANCELLED",
        entity_type="PayoutBatch", entity_id=batch.id,
    ))


async def notify_professionals_without_bank_account(db: AsyncSession, blocked: list[dict]) -> None:
    """
    Avisa a cada profesional bloqueado (sin cuenta o sin verificar) y a
    todos los admins, para que el equipo técnico coordine un método de
    pago alternativo por fuera del lote automático — ver diseño §3.2.3.
    """
    if not blocked:
        return

    for item in blocked:
        prof_result = await db.execute(select(Professional).where(Professional.id == item["professional_id"]))
        prof = prof_result.scalar_one_or_none()
        if not prof:
            continue
        reason = (
            "No tienes una cuenta bancaria registrada"
            if not item["has_bank_account"]
            else "Tu cuenta bancaria todavía no fue verificada"
        )
        await notify_user(
            db, user_id=prof.user_id,
            title="Pago pendiente de coordinar",
            body=(
                f"{reason}. El equipo de MedicBolivia se pondrá en contacto contigo para "
                f"coordinar otra forma de pago de Bs. {item['total_amount']:.2f}."
            ),
            type_="PAYOUT_BLOCKED_NO_ACCOUNT",
            # Solo in-app: es una gestión administrativa de días, no de
            # minutos — el equipo se contacta directamente con el
            # profesional para coordinar, el WhatsApp automático no
            # aporta urgencia real acá.
            send_whatsapp=False,
        )

    admins_result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
    admins = admins_result.scalars().all()
    names = ", ".join(i["professional_name"] for i in blocked[:5])
    more = f" y {len(blocked) - 5} más" if len(blocked) > 5 else ""
    for admin in admins:
        await notify_user(
            db, user_id=admin.id,
            title="Profesionales sin cuenta bancaria para pagar",
            body=(
                f"{len(blocked)} profesional(es) tienen ganancias liberadas pero no se les puede "
                f"pagar en el lote automático: {names}{more}. Coordina el pago manualmente."
            ),
            type_="PAYOUT_BLOCKED_NO_ACCOUNT",
            send_whatsapp=False,
        )
