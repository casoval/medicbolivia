"""
Limpieza de los datos de prueba dejados por test_e2e_inbound.py, cuyo
DELETE final falló por una fila en reminder_logs que quedó apuntando al
usuario de prueba (se generó automáticamente al confirmar el pago,
porque el sistema dispara un recordatorio real para el profesional).

Como el commit de limpieza original fue una sola transacción que
falló, NADA se borró — todo el dato de prueba (Payment, Consultation,
Professional, Patient, 2 Users, y la fila de reminder_logs) sigue en la
base. Este script los borra en el orden correcto, y si aparece
CUALQUIER OTRA tabla bloqueando el borrado de los usuarios (no solo
reminder_logs), la detecta automáticamente por el mensaje de Postgres y
la limpia también, sin necesidad de listarlas a mano.
"""
import asyncio
import re

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.database import AsyncSessionLocal

# IDs conocidos de la corrida de prueba (del log de test_e2e_inbound.py)
BANK_QR_ID = "26073001018000002451"
USER_IDS = [
    "268c5b07-d795-461a-85b4-25bd12000e82",
    "7255c435-460a-40de-b5dd-ede8221804cd",
]


async def main():
    async with AsyncSessionLocal() as db:
        print("1) Ubicando el Payment/Consultation/Patient/Professional de prueba...")
        row = (await db.execute(
            text("SELECT id, consultation_id, patient_id FROM payments WHERE bank_qr_id = :qr"),
            {"qr": BANK_QR_ID},
        )).first()
        if row:
            payment_id, consultation_id, patient_id = row
            cons_row = (await db.execute(
                text("SELECT professional_id FROM consultations WHERE id = :cid"),
                {"cid": consultation_id},
            )).first()
            professional_id = cons_row[0] if cons_row else None

            print(f"   payment={payment_id} consultation={consultation_id} patient={patient_id} professional={professional_id}")

            await db.execute(text("DELETE FROM payments WHERE id = :id"), {"id": payment_id})
            await db.execute(text("DELETE FROM consultations WHERE id = :id"), {"id": consultation_id})
            if professional_id:
                await db.execute(text("DELETE FROM professionals WHERE id = :id"), {"id": professional_id})
            await db.execute(text("DELETE FROM patients WHERE id = :id"), {"id": patient_id})
            await db.commit()
            print("   Payment, Consultation, Professional, Patient borrados.")
        else:
            print("   No se encontró el Payment de prueba (puede que ya se haya limpiado).")

        print("2) Borrando los 2 usuarios de prueba (con reintento automático ante FK)...")
        for attempt in range(10):
            try:
                await db.execute(
                    text("DELETE FROM users WHERE id = ANY(:ids)"),
                    {"ids": USER_IDS},
                )
                await db.commit()
                print("   Usuarios de prueba borrados correctamente.")
                break
            except IntegrityError as e:
                await db.rollback()
                msg = str(e.orig)
                m = re.search(r'from table "(\w+)"', msg)
                if not m:
                    print("   No se pudo interpretar el error de FK, deteniendo:")
                    print(f"   {msg}")
                    raise
                blocking_table = m.group(1)
                print(f"   Bloqueado por la tabla '{blocking_table}' — limpiando esa tabla y reintentando...")
                await db.execute(
                    text(f"DELETE FROM {blocking_table} WHERE user_id = ANY(:ids)"),
                    {"ids": USER_IDS},
                )
                await db.commit()
        else:
            print("   No se pudo borrar tras 10 intentos — revisar manualmente.")

        print("\n✅ Limpieza completa.")

asyncio.run(main())
