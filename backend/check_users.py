import asyncio
from app.db.database import AsyncSessionLocal
from app.models.models import User
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
        if not users:
            print("No hay usuarios registrados")
        for u in users:
            print(f"Usuario: {u.phone} | Rol: {u.role} | Estado: {u.status}")

asyncio.run(check())