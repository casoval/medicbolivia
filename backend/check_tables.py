import asyncio
from sqlalchemy import text
from app.core.config import settings
import sqlalchemy.ext.asyncio as sa_asyncio

async def check():
    engine = sa_asyncio.create_async_engine(settings.DATABASE_URL)
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
        tables = [row[0] for row in result]
        nuevas = ['whatsapp_conversation','whatsapp_message','agent_config','reminder_rule','reminder_log','db_backup_config','db_backup_log']
        print('--- TODAS LAS TABLAS ---')
        for t in tables:
            print(t)
        print()
        print('--- CHEQUEO DE TABLAS NUEVAS ---')
        for n in nuevas:
            print(n, '-> OK' if n in tables else 'FALTA')
    await engine.dispose()

asyncio.run(check())