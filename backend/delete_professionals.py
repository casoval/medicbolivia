import asyncio
from app.db.database import AsyncSessionLocal
from app.models.models import Professional, User, UserRole
from sqlalchemy import select, delete

async def clean():
    async with AsyncSessionLocal() as db:
        # Obtener IDs de usuarios profesionales
        result = await db.execute(
            select(User).where(User.role == UserRole.PROFESSIONAL)
        )
        users = result.scalars().all()
        
        for user in users:
            print(f"Borrando profesional: {user.phone}")
        
        # Borrar usuarios profesionales (cascade borra el profesional también)
        await db.execute(
            delete(User).where(User.role == UserRole.PROFESSIONAL)
        )
        await db.commit()
        print(f"✅ {len(users)} profesional(es) eliminado(s)")

asyncio.run(clean())