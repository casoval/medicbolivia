"""
app/db/database.py
Configuración de la conexión a PostgreSQL con SQLAlchemy async.
"""
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
