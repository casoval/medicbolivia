"""
app/core/maintenance.py
Caché en memoria de los flags de plataforma que se chequean en requests
frecuentes: modo mantenimiento y apertura de registro por rol.

Por qué un caché: get_current_user() corre en prácticamente cada request
autenticado, y los endpoints de registro en cada intento de registro.
Consultar la tabla platform_settings en cada uno de esos casos sería una
query extra de más en todo el tráfico. En cambio, los valores se cargan
una sola vez (lazy, la primera vez que se necesitan) y se refrescan al
instante cuando un admin guarda Configuración (ver admin.update_settings()
→ set_platform_flags()).

Regla de negocio: mantenimiento manda por encima de los toggles de
registro. Si maintenance_mode está activo, el registro queda cerrado sin
importar lo que digan open_registration_patients/professionals.

Nota: esto vive en memoria del proceso. Si corrés el backend con más de
un worker/proceso, cada uno tiene su propio caché y un cambio tarda en
reflejarse en los demás hasta que cada proceso lo vuelva a cargar (esto
solo pasa si _cache sigue en None ahí, o sea, recién arrancado). Para
este proyecto (un solo proceso fork en PM2) no es un problema.
"""
from dataclasses import dataclass
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select


@dataclass
class _Flags:
    maintenance_mode: bool = False
    open_registration_patients: bool = True
    open_registration_professionals: bool = True


_cache: Optional[_Flags] = None


async def _load(db: AsyncSession) -> _Flags:
    global _cache
    if _cache is None:
        from app.models.models import PlatformSettings
        result = await db.execute(
            select(
                PlatformSettings.maintenance_mode,
                PlatformSettings.open_registration_patients,
                PlatformSettings.open_registration_professionals,
            ).where(PlatformSettings.id == "global")
        )
        row = result.first()
        _cache = _Flags(*row) if row else _Flags()
    return _cache


async def is_maintenance_active(db: AsyncSession) -> bool:
    flags = await _load(db)
    return flags.maintenance_mode


async def is_patient_registration_open(db: AsyncSession) -> bool:
    flags = await _load(db)
    return (not flags.maintenance_mode) and flags.open_registration_patients


async def is_professional_registration_open(db: AsyncSession) -> bool:
    flags = await _load(db)
    return (not flags.maintenance_mode) and flags.open_registration_professionals


def set_platform_flags(
    maintenance_mode: bool,
    open_registration_patients: bool,
    open_registration_professionals: bool,
) -> None:
    """Actualiza el caché al instante. Se llama desde admin.update_settings() tras guardar en BD."""
    global _cache
    _cache = _Flags(maintenance_mode, open_registration_patients, open_registration_professionals)