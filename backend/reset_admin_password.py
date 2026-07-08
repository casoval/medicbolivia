"""
reset_admin_password.py
Cambia la contraseña de un usuario existente (admin o cualquier rol) por
teléfono. Pide la contraseña nueva de forma interactiva (getpass).

Uso:
    python3 reset_admin_password.py --phone 70000000
"""
import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import User
from app.core.security import hash_password


async def reset_password(phone: str, password: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.phone == phone))
        user = result.scalar_one_or_none()
        if not user:
            print(f"❌ No existe un usuario con el teléfono {phone}")
            sys.exit(1)

        user.password_hash = hash_password(password)
        await db.commit()
        print(f"✅ Contraseña actualizada para {phone} (rol: {user.role})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phone", required=True, help="Teléfono del usuario a actualizar")
    args = parser.parse_args()

    password = getpass.getpass("Nueva contraseña (no se mostrará en pantalla): ")
    password_confirm = getpass.getpass("Confirmar contraseña: ")

    if password != password_confirm:
        print("❌ Las contraseñas no coinciden")
        sys.exit(1)
    if len(password) < 10:
        print("❌ Usá una contraseña de al menos 10 caracteres")
        sys.exit(1)

    asyncio.run(reset_password(args.phone, password))
