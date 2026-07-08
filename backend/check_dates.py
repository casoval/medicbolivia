"""
check_dates.py
Script de diagnóstico: busca consultas con fechas corruptas (año fuera de rango).
Correr desde la raíz del backend: python check_dates.py
"""
import asyncio
from sqlalchemy import text
from app.db.database import engine  # usa la misma conexión que ya tiene configurada el backend


async def main():
    query = text("""
        SELECT id, patient_id, professional_id, status,
               created_at, started_at, ended_at, scheduled_at
        FROM consultations
        WHERE EXTRACT(YEAR FROM created_at) NOT BETWEEN 2020 AND 2030
           OR EXTRACT(YEAR FROM started_at) NOT BETWEEN 2020 AND 2030
           OR EXTRACT(YEAR FROM ended_at) NOT BETWEEN 2020 AND 2030
           OR EXTRACT(YEAR FROM scheduled_at) NOT BETWEEN 2020 AND 2030;
    """)
    async with engine.connect() as conn:
        result = await conn.execute(query)
        rows = result.fetchall()
        if not rows:
            print("No se encontraron fechas fuera de rango.")
            return
        print(f"Encontradas {len(rows)} consulta(s) con fecha sospechosa:\n")
        for row in rows:
            print(dict(row._mapping))


if __name__ == "__main__":
    asyncio.run(main())
