"""add patient refund payouts (refund destination + real payout tracking)

Fase 1 (semi-automática) de reembolso a pacientes — espejo de la migración
u5v6w7x8y9z0_add_professional_payouts.py, que resolvió lo mismo para
profesionales. Ver app/services/refund_payout.py para el flujo completo.
Agrega:

  - patient_refund_accounts: a dónde transferirle un reembolso puntual a
    un paciente (cuenta bancaria cifrada, o billetera móvil/QR
    interpersonal) — una fila por Payment reembolsado, no un perfil
    permanente como el del profesional.
  - payments.refund_paid_out_at / refund_payout_reference_note: distingue
    "se aprobó/registró el reembolso" (ya existía, refunded_at) de
    "ya se transfirió de verdad" (nuevo) — mismo patrón que
    earnings.released_at vs earnings.paid_out_at.

No se toca el enum paymentstatus: los reembolsos siguen usando
REFUNDED_FULL/REFUNDED_PARTIAL, que ya existían; lo nuevo es solo el
tracking de si la plata efectivamente salió o no.

Revision ID: a2b3c4d5e6f7
Revises: b3c4d5e6f7a8
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres no soporta "CREATE TYPE IF NOT EXISTS" — se chequea a mano
    # contra pg_type con un DO block (mismo patrón que bankaccounttype /
    # payoutbatchstatus en la migración de payouts a profesionales).
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE refundmethod AS ENUM ('BANK', 'MOBILE_WALLET');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS patient_refund_accounts (
            id UUID PRIMARY KEY,
            payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
            method refundmethod NOT NULL,
            bank_name VARCHAR(150),
            account_type bankaccounttype,
            account_number_encrypted TEXT,
            account_holder_ci_encrypted TEXT,
            account_number_last4 VARCHAR(4),
            account_holder_name VARCHAR(200),
            wallet_provider VARCHAR(100),
            phone_number VARCHAR(20),
            responsibility_acknowledged_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITHOUT TIME ZONE
        )
    """)

    op.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_paid_out_at TIMESTAMP WITHOUT TIME ZONE")
    op.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_payout_reference_note TEXT")

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_patient_refund_accounts_payment_id "
        "ON patient_refund_accounts(payment_id)"
    )
    # Acelera la cola de "reembolsos aprobados y no pagados" (ver
    # refund_payout._pending_refunds), que filtra por status IN (...) AND
    # refund_paid_out_at IS NULL.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payments_refund_paid_out_at ON payments(refund_paid_out_at) "
        "WHERE refund_paid_out_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_payments_refund_paid_out_at")
    op.execute("DROP INDEX IF EXISTS ix_patient_refund_accounts_payment_id")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS refund_payout_reference_note")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS refund_paid_out_at")
    op.execute("DROP TABLE IF EXISTS patient_refund_accounts")
    op.execute("DROP TYPE IF EXISTS refundmethod")
