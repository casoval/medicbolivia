"""
delete_test_professional.py
Borra un único usuario profesional por teléfono (a diferencia de
delete_professionals.py, que borra TODOS los profesionales).

Uso:
    python3 delete_test_professional.py --phone 71111111
"""
import argparse
import asyncio
import sys

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import User, UserRole


async def delete_professional(phone: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.phone == phone, User.role == UserRole.PROFESSIONAL)
        )
        user = result.scalar_one_or_none()
        if not user:
            print(f"❌ No hay ningún profesional con el teléfono {phone}")
            sys.exit(1)

        confirm = input(f"¿Confirmás borrar al profesional {phone} (id {user.id})? [s/N]: ").strip().lower()
        if confirm != "s":
            print("Cancelado")
            sys.exit(0)

        await db.delete(user)  # cascade borra el registro Professional asociado
        await db.commit()
        print(f"✅ Profesional {phone} eliminado")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phone", required=True, help="Teléfono del profesional a borrar")
    args = parser.parse_args()

    asyncio.run(delete_professional(args.phone))
