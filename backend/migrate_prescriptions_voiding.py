"""
migrate_prescriptions_voiding.py
Agrega el soporte de anulación / reemisión de recetas a la tabla
'prescriptions', que ya existía antes de este cambio:

  - status: 'ACTIVE' | 'VOIDED'
  - voided_at: cuándo se anuló
  - void_reason: motivo de anulación
  - replaces_prescription_id: FK a la receta que reemplaza a una anulada

Es seguro correrlo varias veces: usa "ADD COLUMN IF NOT EXISTS".

Uso:
    (venv) /var/www/medicbolivia/backend> python migrate_prescriptions_voiding.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine


COLUMN_MIGRATIONS = [
    ("prescriptions", "status", "VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'"),
    ("prescriptions", "voided_at", "TIMESTAMP WITHOUT TIME ZONE"),
    ("prescriptions", "void_reason", "TEXT"),
    ("prescriptions", "replaces_prescription_id",
     "UUID REFERENCES prescriptions(id)"),
]


async def migrate():
    async with engine.begin() as conn:
        for table, column, definition in COLUMN_MIGRATIONS:
            sql = f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}'
            await conn.execute(text(sql))
            print(f"  ✓ {table}.{column}")

    print("\n✅ Migración completada. Anulación/reemisión de recetas lista.")


if __name__ == "__main__":
    asyncio.run(migrate())
