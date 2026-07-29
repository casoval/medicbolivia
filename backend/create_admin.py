"""
create_admin.py
Crea un usuario admin nuevo. Pide teléfono y contraseña de forma interactiva
(getpass, no queda en el historial de la terminal ni en el código).

Uso:
    python3 create_admin.py
"""
import asyncio
import getpass
import sys

from sqlalchemy.exc import IntegrityError

from app.db.database import AsyncSessionLocal
from app.models.models import User, Admin, UserRole, UserStatus
from app.core.security import hash_password
from app.core.phone import normalize_bo_phone, InvalidPhoneError, display_phone


async def create_admin(phone: str, password: str, name: str):
    async with AsyncSessionLocal() as db:
        user = User(
            phone=phone,
            email=f"admin-{phone}@medicbolivia.bo",
            password_hash=hash_password(password),
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
            onboarding_completed=True,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            print(f"❌ Ya existe un usuario con el teléfono {display_phone(phone)}")
            sys.exit(1)

        admin = Admin(user_id=user.id, name=name)
        db.add(admin)
        await db.commit()
        print(f"✅ Admin creado exitosamente (teléfono: {display_phone(phone)})")


if __name__ == "__main__":
    phone_raw = input("Teléfono del nuevo admin (ej: 72345678): ").strip()
    if not phone_raw:
        print("❌ El teléfono no puede estar vacío")
        sys.exit(1)
    try:
        # Mismo formato canónico ("591XXXXXXXX") que usa el resto del
        # proyecto, incluido el login — si no se normaliza acá, el admin
        # queda guardado con un teléfono que el login nunca va a matchear.
        phone = normalize_bo_phone(phone_raw)
    except InvalidPhoneError as e:
        print(f"❌ {e}")
        sys.exit(1)

    password = getpass.getpass("Contraseña (no se mostrará en pantalla): ")
    password_confirm = getpass.getpass("Confirmar contraseña: ")

    if password != password_confirm:
        print("❌ Las contraseñas no coinciden")
        sys.exit(1)
    if len(password) < 10:
        print("❌ Usá una contraseña de al menos 10 caracteres")
        sys.exit(1)

    name = input("Nombre visible del admin [Administrador MedicBolivia]: ").strip()
    name = name or "Administrador MedicBolivia"

    asyncio.run(create_admin(phone, password, name))
