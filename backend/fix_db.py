import asyncio
from app.db.database import get_db
from sqlalchemy import text

async def fix():
    async for db in get_db():
        await db.execute(text("UPDATE consultations SET status = 'CANCELLED' WHERE status NOT IN ('COMPLETED', 'CANCELLED')"))
        await db.commit()
        print('Consultas canceladas OK')
        break

asyncio.run(fix())