"""
Corrige datos históricos afectados por el bug de "reembolso fantasma":
pagos que nunca llegaron a cobrarse (el paciente canceló o no pagó a
tiempo, es decir paid_at es NULL) pero que quedaron marcados como
REFUNDED_FULL en vez de CANCELLED_NO_CHARGE.

Solo toca los 2 casos exactos que causaba el bug (identificados por
refund_note, que el propio backend escribía de forma consistente) y
además exige paid_at IS NULL como salvaguarda extra para no tocar un
reembolso real por error.

Ejecutar una sola vez, DESPUÉS de aplicar la migración
b2c3d4e5f6a7_add_cancelled_no_charge_payment_status (que agrega el
valor CANCELLED_NO_CHARGE al enum paymentstatus).
"""
import asyncio
from app.db.database import get_db
from sqlalchemy import text


async def fix():
    async for db in get_db():
        result = await db.execute(text("""
            UPDATE payments
            SET status = 'CANCELLED_NO_CHARGE',
                refunded_at = NULL
            WHERE status = 'REFUNDED_FULL'
              AND paid_at IS NULL
              AND refund_note IN (
                  'No se generó cobro: el paciente no completó el pago a tiempo.',
                  'No se generó cobro: el paciente canceló antes de pagar.'
              )
        """))
        await db.commit()
        print(f"Pagos corregidos: {result.rowcount}")
        break

asyncio.run(fix())
