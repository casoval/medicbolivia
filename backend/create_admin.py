import asyncio
from app.db.database import AsyncSessionLocal
from app.models.models import User, Admin, UserRole, UserStatus
from app.core.security import hash_password

async def create_admin():
    async with AsyncSessionLocal() as db:
        # Crear usuario admin
        user = User(
            phone="70000000",
            email="admin@medicbolivia.bo",
            password_hash=hash_password("admin123456"),
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
            onboarding_completed=True,
        )
        db.add(user)
        await db.flush()

        # Crear perfil admin
        admin = Admin(
            user_id=user.id,
            name="Administrador MedicBolivia",
        )
        db.add(admin)
        await db.commit()
        print(f"✅ Admin creado exitosamente")
        print(f"   Teléfono: 70000000")
        print(f"   Contraseña: admin123456")

asyncio.run(create_admin())