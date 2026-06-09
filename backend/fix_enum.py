import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def fix():
    engine = create_async_engine("postgresql+asyncpg://postgres:Ricardomisael.1@localhost/medicbolivia")
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TYPE consultationstatus ADD VALUE IF NOT EXISTS 'PROFESSIONAL_ACCEPTED'"))
        print("✅ Enum actualizado")
    await engine.dispose()

asyncio.run(fix())