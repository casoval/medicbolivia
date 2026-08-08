"""convert patient_refund_accounts to a permanent per-patient profile

La primera versión de patient_refund_accounts (ver
a2b3c4d5e6f7_add_patient_refund_payouts.py) guardaba una cuenta POR CADA
reembolso (payment_id único). Se decidió cambiarlo a un perfil
permanente por paciente — igual que professional_bank_accounts —, para
que el paciente lo cargue de antemano en su Perfil y no tenga que
completarlo cada vez que le aprueban un reembolso. Ver
app/services/refund_payout.py para el flujo actualizado.

Como la tabla es nueva (recién se creó en la migración anterior) y no
hay reembolsos reales todavía, no hace falta migrar datos: se recrea
directamente con el esquema nuevo. También se agregan verified/
verified_at/verified_by, que antes no existían — mismo criterio de
revisión que el profesional.

Revision ID: a3b4c5d6e7f8
Revises: a2b3c4d5e6f7
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS patient_refund_accounts")

    op.execute("""
        CREATE TABLE patient_refund_accounts (
            id UUID PRIMARY KEY,
            patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
            method refundmethod NOT NULL,
            bank_name VARCHAR(150),
            account_type bankaccounttype,
            account_number_encrypted TEXT,
            account_holder_ci_encrypted TEXT,
            account_number_last4 VARCHAR(4),
            account_holder_name VARCHAR(200),
            wallet_provider VARCHAR(100),
            phone_number VARCHAR(20),
            verified BOOLEAN NOT NULL DEFAULT false,
            verified_at TIMESTAMP WITHOUT TIME ZONE,
            verified_by UUID,
            responsibility_acknowledged_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITHOUT TIME ZONE
        )
    """)

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_patient_refund_accounts_patient_id "
        "ON patient_refund_accounts(patient_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_patient_refund_accounts_patient_id")
    op.execute("DROP TABLE IF EXISTS patient_refund_accounts")
    # No se recrea la versión anterior (por-pago) — si hace falta volver,
    # correr la migración a2b3c4d5e6f7 de nuevo manualmente.
