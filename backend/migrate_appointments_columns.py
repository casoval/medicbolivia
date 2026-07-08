"""
migrate_appointments_columns.py
Agrega las columnas nuevas que necesita el sistema de citas agendadas a
tablas que YA EXISTÍAN (create_all_tables() no las agrega solas, porque
SQLAlchemy solo crea tablas nuevas, nunca altera tablas existentes).

Es seguro correrlo varias veces: usa "ADD COLUMN IF NOT EXISTS", así que si
una columna ya existe simplemente la salta.

Uso:
    (venv) C:\\proyectos\\medicbolivia_v2\\backend> python migrate_appointments_columns.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine


# Cada tupla: (tabla, columna, definición SQL completa)
MIGRATIONS = [
    ("professionals", "auto_availability",
     "BOOLEAN NOT NULL DEFAULT false"),
    ("professionals", "appointment_duration_minutes",
     "INTEGER NOT NULL DEFAULT 30"),

    ("consultations", "reschedule_proposed_at",
     "TIMESTAMP WITHOUT TIME ZONE"),
    ("consultations", "reschedule_proposed_by",
     "VARCHAR(20)"),
    ("consultations", "reschedule_used",
     "BOOLEAN NOT NULL DEFAULT false"),
    ("consultations", "outcome_note",
     "VARCHAR(50)"),
    ("consultations", "reschedule_attempts",
     "INTEGER NOT NULL DEFAULT 0"),
]


async def migrate():
    async with engine.begin() as conn:
        for table, column, definition in MIGRATIONS:
            sql = f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}'
            await conn.execute(text(sql))
            print(f"  ✓ {table}.{column}")

    print("\n✅ Migración completada. Todas las columnas están listas.")


if __name__ == "__main__":
    asyncio.run(migrate())
