"""
app/db/database.py
Configuración de la conexión a PostgreSQL con SQLAlchemy async.
"""
import asyncio
from typing import Coroutine

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
from loguru import logger


# ── Motor async ──────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,        # Muestra SQL en consola solo en desarrollo
    pool_size=10,               # Conexiones en el pool
    max_overflow=20,            # Conexiones extras en picos
    pool_pre_ping=True,         # Verifica conexión antes de usarla
)

# ── Fábrica de sesiones ───────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,     # Los objetos no expiran al hacer commit
)


# ── Clase base para todos los modelos ─────────────────
class Base(DeclarativeBase):
    pass


# ── Dependencia para FastAPI ──────────────────────────
async def get_db() -> AsyncSession:
    """
    Inyección de dependencia para obtener una sesión de BD.
    Uso: db: AsyncSession = Depends(get_db)
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            logger.error(f"Error en sesión de BD: {e}")
            raise
        finally:
            await session.close()


# ── Crear todas las tablas (solo en desarrollo) ───────
async def create_all_tables():
    """Crea las tablas si no existen. En producción usar Alembic."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("✅ Tablas de base de datos creadas/verificadas")


# ── Runner para tareas de Celery (fuera del loop de FastAPI) ──
def run_task_with_engine_cleanup(coro: Coroutine) -> None:
    """
    Reemplaza el patrón repetido en las tareas de Celery:

        asyncio.run(alguna_coroutine())
        asyncio.run(engine.dispose())

    que parecía razonable (dispose() explícito para no dejar conexiones
    colgando entre corridas) pero en realidad CAUSA el problema que
    intenta evitar: cada asyncio.run() abre un event loop nuevo y lo
    cierra al terminar. La primera llamada abre conexiones asyncpg en el
    loop A y lo cierra; la segunda llamada abre un loop B nuevo e intenta
    cerrar esas conexiones — que pertenecen al loop A, ya cerrado — y
    asyncpg tira "Event loop is closed" / "attached to a different loop"
    (visible en los logs de celery-worker, ej. en
    check_scheduled_appointment_reminders). La tarea igual queda marcada
    "succeeded" porque el error ocurre en la limpieza posterior, no en el
    trabajo real — pero la conexión nunca se cierra limpio: fuga lenta de
    conexiones/descriptores en cada corrida.

    El fix es correr AMBAS cosas dentro del mismo event loop, para que
    dispose() limpie las conexiones en el loop que las creó:

        run_task_with_engine_cleanup(alguna_coroutine())

    Uso: pasar la coroutine SIN awaitear (ej. `run_task_with_engine_cleanup(
    _mi_funcion_async(arg1, arg2))`), igual que se hacía con
    `asyncio.run(_mi_funcion_async(arg1, arg2))` antes.
    """
    async def _run_and_dispose():
        try:
            await coro
        finally:
            await engine.dispose()
            from app.core.redis_client import redis_client
            await redis_client.aclose()

    asyncio.run(_run_and_dispose())