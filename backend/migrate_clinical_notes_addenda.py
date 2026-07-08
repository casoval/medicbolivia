"""
migrate_clinical_notes_addenda.py
Agrega el soporte para la ventana de edición de 24h y los addenda
(correcciones posteriores) a la historia clínica:

  - clinical_notes.edit_count: contador simple de ediciones.
  - clinical_note_addenda: tabla nueva, una fila por addendum.

Es seguro correrlo varias veces: usa "ADD COLUMN IF NOT EXISTS" y
"CREATE TABLE IF NOT EXISTS".

Uso:
    (venv) C:\proyectos\medicbolivia_v2\backend> python migrate_clinical_notes_addenda.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine


COLUMN_MIGRATIONS = [
    ("clinical_notes", "edit_count", "INTEGER NOT NULL DEFAULT 0"),
]

CREATE_ADDENDA_TABLE = """
CREATE TABLE IF NOT EXISTS clinical_note_addenda (
    id UUID PRIMARY KEY,
    clinical_note_id UUID NOT NULL REFERENCES clinical_notes(id),
    professional_id UUID NOT NULL REFERENCES professionals(id),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
)
"""

CREATE_ADDENDA_INDEX = """
CREATE INDEX IF NOT EXISTS ix_clinical_note_addenda_note_id
    ON clinical_note_addenda (clinical_note_id)
"""


async def migrate():
    async with engine.begin() as conn:
        for table, column, definition in COLUMN_MIGRATIONS:
            sql = f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}'
            await conn.execute(text(sql))
            print(f"  ✓ {table}.{column}")

        await conn.execute(text(CREATE_ADDENDA_TABLE))
        print("  ✓ tabla clinical_note_addenda")

        await conn.execute(text(CREATE_ADDENDA_INDEX))
        print("  ✓ índice clinical_note_addenda(clinical_note_id)")

    print("\n✅ Migración completada. Ventana de edición 24h + addenda listos.")


if __name__ == "__main__":
    asyncio.run(migrate())