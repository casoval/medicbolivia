"""
alembic/env.py
Configuración de Alembic para MedicBolivia.
Usa la metadata de los modelos SQLAlchemy y la URL sync de la app.
"""
import sys
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Permite importar el paquete "app" (backend/ es la raíz del proyecto)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.db.database import Base
import app.models.models  # noqa: F401  (registra todos los modelos en Base.metadata)

# Objeto de configuración de Alembic, provee acceso a alembic.ini
config = context.config

# Sobreescribe la URL del .ini con la de la app (así no queda hardcodeada ni duplicada)
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL_SYNC)

# Interpreta el archivo de config para logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata target para el autogenerate
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Ejecuta migraciones en modo 'offline' (genera SQL sin conectarse)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Ejecuta migraciones en modo 'online' (conectado a la BD real)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
