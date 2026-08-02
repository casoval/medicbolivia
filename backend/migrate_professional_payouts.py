"""
migrate_professional_payouts.py
Fase 1 (semi-automática) de pago del % a profesionales — agrega:

  - professional_bank_accounts: cuenta bancaria de cada profesional
    (cifrada), donde se le transfiere su % de cada consulta.
  - payout_batches: lotes de pago que arma el admin (agrupa varios
    Earning liberados en un CSV para subir a la banca en línea).
  - earnings.payout_batch_id / earnings.paid_out_at: distingue
    "liberado contablemente" (ya existía, released_at) de "pagado de
    verdad" (nuevo).
  - payments.status gana el valor 'PAID_OUT'.

Ver el documento de diseño "diseno-pagos-profesionales.md" para el
detalle completo del flujo (GET /admin/payouts/pending, POST
/admin/payouts/batches, etc. en app/api/v1/endpoints/admin.py y
app/services/payout.py).

Antes de correr esto en producción, asegurate de tener configurado
BANK_ACCOUNT_ENCRYPTION_KEY en el .env (ver .env.example) — sin eso,
cualquier intento de guardar una cuenta bancaria falla con un error claro
en vez de guardar datos sin cifrar (ver app/core/crypto.py).

Es seguro correrlo varias veces: usa "IF NOT EXISTS" / DO blocks.

Uso:
    (venv) /var/www/medicbolivia/backend> python migrate_professional_payouts.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine


async def migrate():
    # ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción
    # explícita en Postgres — mismo motivo que
    # migrate_consultation_status_enum.py.
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(text("ALTER TYPE paymentstatus ADD VALUE IF NOT EXISTS 'PAID_OUT'"))
        print("  ✓ paymentstatus.PAID_OUT")

    async with engine.begin() as conn:
        # Postgres no soporta "CREATE TYPE IF NOT EXISTS" — se chequea a
        # mano contra pg_type con un DO block, mismo patrón que ya usa
        # este proyecto en otras migraciones con enums nuevos.
        await conn.execute(text("""
            DO $$ BEGIN
                CREATE TYPE bankaccounttype AS ENUM ('AHORRO', 'CORRIENTE');
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """))
        await conn.execute(text("""
            DO $$ BEGIN
                CREATE TYPE payoutbatchstatus AS ENUM ('DRAFT', 'EXPORTED', 'CONFIRMED', 'CANCELLED');
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """))
        print("  ✓ tipos bankaccounttype / payoutbatchstatus")

        await conn.execute(text("""
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
        """))
        print("  ✓ tabla professional_bank_accounts")

        await conn.execute(text("""
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
        """))
        print("  ✓ tabla payout_batches")

        await conn.execute(text(
            "ALTER TABLE earnings ADD COLUMN IF NOT EXISTS payout_batch_id UUID REFERENCES payout_batches(id)"
        ))
        await conn.execute(text(
            "ALTER TABLE earnings ADD COLUMN IF NOT EXISTS paid_out_at TIMESTAMP WITHOUT TIME ZONE"
        ))
        print("  ✓ earnings.payout_batch_id / earnings.paid_out_at")

        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_earnings_payout_batch_id ON earnings(payout_batch_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_professional_bank_accounts_professional_id "
            "ON professional_bank_accounts(professional_id)"
        ))
        print("  ✓ índices")

    print("\n✅ Migración completada. Tablas y columnas de pagos a profesionales listas.")


if __name__ == "__main__":
    asyncio.run(migrate())
