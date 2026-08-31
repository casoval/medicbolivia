"""
delete_professionals_by_date.py
Borra los usuarios profesionales cuyo registro (User.created_at) cae
dentro de un rango de fechas, en hora de Bolivia (UTC-4). Pensado para
limpiar profesionales de prueba creados en días concretos (ej. 25 y 26
de agosto), sin tocar a nadie fuera de ese rango.

A diferencia de delete_professionals.py (que borra TODOS los
profesionales) y delete_test_professional.py (que borra uno por
teléfono), este filtra por fecha de creación.

Uso:
    # 1) Modo de revisión (por defecto) — solo LISTA, no borra nada:
    python3 delete_professionals_by_date.py --start 2026-08-25 --end 2026-08-26

    # 2) Modo borrado real, con confirmación interactiva:
    python3 delete_professionals_by_date.py --start 2026-08-25 --end 2026-08-26 --confirm

Notas:
- --start y --end son fechas (YYYY-MM-DD) en hora de Bolivia, AMBAS
  inclusive todo el día (00:00:00 a 23:59:59.999999 hora Bolivia).
- User.created_at se guarda en UTC (utcnow_naive), así que el script
  convierte el rango Bolivia -> UTC antes de consultar.
- Borrar el User en cascade borra también el registro Professional
  asociado (ondelete=CASCADE), igual que en delete_professionals.py.
"""
import argparse
import asyncio
import sys
from datetime import datetime, timedelta

from sqlalchemy import delete, select

from app.db.database import AsyncSessionLocal
from app.models.models import User, UserRole

BOLIVIA_OFFSET = timedelta(hours=4)  # Bolivia = UTC-4, sin horario de verano


def bolivia_day_range_to_utc(start_str: str, end_str: str):
    """Convierte un rango de fechas (YYYY-MM-DD, hora Bolivia, inclusive)
    a un rango [start_utc, end_utc) para comparar contra created_at (UTC-naive)."""
    start_bo = datetime.strptime(start_str, "%Y-%m-%d")
    end_bo = datetime.strptime(end_str, "%Y-%m-%d") + timedelta(days=1)  # exclusive
    start_utc = start_bo + BOLIVIA_OFFSET
    end_utc = end_bo + BOLIVIA_OFFSET
    return start_utc, end_utc


async def run(start_str: str, end_str: str, confirm: bool):
    start_utc, end_utc = bolivia_day_range_to_utc(start_str, end_str)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User)
            .where(
                User.role == UserRole.PROFESSIONAL,
                User.created_at >= start_utc,
                User.created_at < end_utc,
            )
            .order_by(User.created_at)
        )
        users = result.scalars().all()

        if not users:
            print(f"No hay profesionales registrados entre {start_str} y {end_str} (hora Bolivia).")
            return

        print(f"Profesionales registrados entre {start_str} y {end_str} (hora Bolivia):")
        for user in users:
            print(f"  - {user.phone}  (id={user.id}, created_at UTC={user.created_at})")
        print(f"\nTotal: {len(users)} profesional(es).")

        if not confirm:
            print("\nModo revisión: no se borró nada. Volvé a correr con --confirm para borrarlos.")
            return

        answer = input(f"\n¿Confirmás borrar estos {len(users)} profesional(es)? [s/N]: ").strip().lower()
        if answer != "s":
            print("Cancelado.")
            sys.exit(0)

        # Borrado a nivel SQL (no db.delete(user) uno por uno): el borrado
        # ORM intenta primero poner en NULL professionals.user_id antes de
        # borrar al User, y esa columna es NOT NULL -> IntegrityError. Con
        # un DELETE directo, el ON DELETE CASCADE de la base de datos borra
        # el Professional asociado sin pasar por ese paso intermedio.
        ids = [user.id for user in users]
        await db.execute(delete(User).where(User.id.in_(ids)))
        await db.commit()
        print(f"✅ {len(users)} profesional(es) eliminado(s).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2026-08-25", help="Fecha inicial YYYY-MM-DD (hora Bolivia), inclusive")
    parser.add_argument("--end", default="2026-08-26", help="Fecha final YYYY-MM-DD (hora Bolivia), inclusive")
    parser.add_argument("--confirm", action="store_true", help="Borra de verdad (si no, solo lista)")
    args = parser.parse_args()

    asyncio.run(run(args.start, args.end, args.confirm))
