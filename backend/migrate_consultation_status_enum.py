"""
migrate_consultation_status_enum.py
Agrega el valor 'PROFESSIONAL_ACCEPTED' al enum 'consultationstatus'
en Postgres. El código actual (consultations.py) ya depende de este
valor para el flujo de aceptación de consultas por parte del profesional.

Reemplaza al viejo fix_enum.py, que tenía la contraseña de la base de
datos escrita en texto plano en el archivo — usá este en su lugar y
borrá fix_enum.py del repo.

Es seguro correrlo varias veces: usa "ADD VALUE IF NOT EXISTS".

Nota Postgres: ALTER TYPE ... ADD VALUE no puede ejecutarse dentro de un
bloque de transacción explícito, por eso esto usa autocommit en vez de
engine.begin() como los otros scripts de migración.

Uso:
    (venv) /var/www/medicbolivia/backend> python migrate_consultation_status_enum.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine


async def migrate():
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(text(
            "ALTER TYPE consultationstatus ADD VALUE IF NOT EXISTS 'PROFESSIONAL_ACCEPTED'"
        ))
        print("  ✓ consultationstatus.PROFESSIONAL_ACCEPTED")

    print("\n✅ Migración completada. Enum de estado de consultas actualizado.")


if __name__ == "__main__":
    asyncio.run(migrate())
