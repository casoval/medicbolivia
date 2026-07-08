"""
verify_migrations.py
Verifica, SIN MODIFICAR NADA, si las columnas y tablas de las migraciones
ya existen en la base de datos actual. Solo lee information_schema.

Uso:
    (venv) /var/www/medicbolivia/backend> python verify_migrations.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine


# (tabla, columna) que deberían existir tras las migraciones de columnas
EXPECTED_COLUMNS = [
    # migrate_appointments_columns.py
    ("professionals", "auto_availability"),
    ("professionals", "appointment_duration_minutes"),
    ("consultations", "reschedule_proposed_at"),
    ("consultations", "reschedule_proposed_by"),
    ("consultations", "reschedule_used"),
    ("consultations", "outcome_note"),
    ("consultations", "reschedule_attempts"),
    # migrate_clinical_notes_addenda.py
    ("clinical_notes", "edit_count"),
    # migrate_prescriptions_voiding.py
    ("prescriptions", "status"),
    ("prescriptions", "voided_at"),
    ("prescriptions", "void_reason"),
    ("prescriptions", "replaces_prescription_id"),
]

# tablas que deben existir (creadas por create_all_tables o por script)
EXPECTED_TABLES = [
    "clinical_notes",
    "clinical_note_addenda",
]


async def verify():
    async with engine.begin() as conn:
        print("── Enums ────────────────────────────────")
        result = await conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM pg_enum e "
            "JOIN pg_type t ON e.enumtypid = t.oid "
            "WHERE t.typname = 'consultationstatus' AND e.enumlabel = 'PROFESSIONAL_ACCEPTED')"
        ))
        exists = result.scalar()
        symbol = "✓" if exists else "✗ FALTA"
        print(f"  {symbol}  consultationstatus.PROFESSIONAL_ACCEPTED  (de fix_enum.py)")
        all_ok = bool(exists)

        print("\n── Tablas ──────────────────────────────")
        for table in EXPECTED_TABLES:
            result = await conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_name = :t)"
            ), {"t": table})
            exists = result.scalar()
            symbol = "✓" if exists else "✗ FALTA"
            if not exists:
                all_ok = False
            print(f"  {symbol}  {table}")

        print("\n── Columnas ─────────────────────────────")
        for table, column in EXPECTED_COLUMNS:
            result = await conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :t AND column_name = :c)"
            ), {"t": table, "c": column})
            exists = result.scalar()
            symbol = "✓" if exists else "✗ FALTA"
            if not exists:
                all_ok = False
            print(f"  {symbol}  {table}.{column}")

        print("\n" + ("✅ Todo está migrado correctamente." if all_ok
                       else "⚠️  Faltan cosas por migrar — revisá los ✗ de arriba."))


if __name__ == "__main__":
    asyncio.run(verify())
