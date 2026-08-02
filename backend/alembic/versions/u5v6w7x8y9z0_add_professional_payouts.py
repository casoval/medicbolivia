"""add professional payouts (bank accounts + payout batches)

Fase 1 (semi-automática) de pago del % a profesionales — ver
"diseno-pagos-profesionales.md" y app/services/payout.py. Agrega:

  - professional_bank_accounts: cuenta bancaria de cada profesional
    (cifrada), donde se le transfiere su % de cada consulta.
  - payout_batches: lotes de pago que arma el admin (agrupa varios
    Earning liberados en un CSV para subir a la banca en línea).
  - earnings.payout_batch_id / earnings.paid_out_at: distingue
    "liberado contablemente" (ya existía, released_at) de "pagado de
    verdad" (nuevo).
  - payments.status gana el valor 'PAID_OUT'.

Nota histórica: esto se aplicó por primera vez en desarrollo con el
script manual backend/migrate_professional_payouts.py (mismo patrón que
otros migrate_*.py sueltos de este repo), ANTES de convertirlo a una
migración real de Alembic. Por eso el SQL de acá es idéntico —
deliberadamente idempotente (IF NOT EXISTS / DO blocks) — así corre sin
error tanto en un ambiente que ya lo tenía (como el de este repo) como en
uno nuevo (staging, producción, o un dev que clona el repo desde cero).
El script manual queda en el repo solo como referencia histórica, ya no
hace falta correrlo — esta migración lo reemplaza y sí es automática
(se aplica sola con "alembic upgrade head" al arrancar el backend).

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-08-02
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'u5v6w7x8y9z0'
down_revision: Union[str, Sequence[str], None] = 't4u5v6w7x8y9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción
    # explícita en Postgres. Alembic ya envuelve cada migración en una
    # transacción por defecto, así que este statement puntual necesita
    # autocommit — mismo motivo que ya documentaba
    # migrate_consultation_status_enum.py para el script manual.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE paymentstatus ADD VALUE IF NOT EXISTS 'PAID_OUT'")

    # Postgres no soporta "CREATE TYPE IF NOT EXISTS" — se chequea a mano
    # contra pg_type con un DO block.
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE bankaccounttype AS ENUM ('AHORRO', 'CORRIENTE');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    """)
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE payoutbatchstatus AS ENUM ('DRAFT', 'EXPORTED', 'CONFIRMED', 'CANCELLED');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS professional_bank_accounts (
            id UUID PRIMARY KEY,
            professional_id UUID NOT NULL UNIQUE REFERENCES professionals(id) ON DELETE CASCADE,
            bank_name VARCHAR(150) NOT NULL,
            account_type bankaccounttype NOT NULL,
            account_number_encrypted TEXT NOT NULL,
            account_holder_ci_encrypted TEXT NOT NULL,
            account_number_last4 VARCHAR(4) NOT NULL,
            account_holder_name VARCHAR(200) NOT NULL,
            verified BOOLEAN NOT NULL DEFAULT FALSE,
            verified_at TIMESTAMP WITHOUT TIME ZONE,
            verified_by UUID,
            responsibility_acknowledged_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITHOUT TIME ZONE
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS payout_batches (
            id UUID PRIMARY KEY,
            status payoutbatchstatus NOT NULL DEFAULT 'DRAFT',
            period_end TIMESTAMP WITHOUT TIME ZONE NOT NULL,
            total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
            professional_count INTEGER NOT NULL DEFAULT 0,
            created_by UUID REFERENCES users(id),
            exported_at TIMESTAMP WITHOUT TIME ZONE,
            confirmed_by UUID REFERENCES users(id),
            confirmed_at TIMESTAMP WITHOUT TIME ZONE,
            bank_reference_note TEXT,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
    """)

    op.execute("ALTER TABLE earnings ADD COLUMN IF NOT EXISTS payout_batch_id UUID REFERENCES payout_batches(id)")
    op.execute("ALTER TABLE earnings ADD COLUMN IF NOT EXISTS paid_out_at TIMESTAMP WITHOUT TIME ZONE")

    op.execute("CREATE INDEX IF NOT EXISTS ix_earnings_payout_batch_id ON earnings(payout_batch_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_professional_bank_accounts_professional_id "
        "ON professional_bank_accounts(professional_id)"
    )


def downgrade() -> None:
    # No revertimos el valor 'PAID_OUT' de paymentstatus — Postgres no
    # soporta quitar un valor de un enum sin recrear el tipo entero, y no
    # vale la pena el riesgo para un downgrade que casi nunca se usa.
    op.execute("DROP INDEX IF EXISTS ix_professional_bank_accounts_professional_id")
    op.execute("DROP INDEX IF EXISTS ix_earnings_payout_batch_id")
    op.execute("ALTER TABLE earnings DROP COLUMN IF EXISTS paid_out_at")
    op.execute("ALTER TABLE earnings DROP COLUMN IF EXISTS payout_batch_id")
    op.execute("DROP TABLE IF EXISTS payout_batches")
    op.execute("DROP TABLE IF EXISTS professional_bank_accounts")
    op.execute("DROP TYPE IF EXISTS payoutbatchstatus")
    op.execute("DROP TYPE IF EXISTS bankaccounttype")
