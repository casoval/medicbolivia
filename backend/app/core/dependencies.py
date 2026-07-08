"""
app/core/dependencies.py
Dependencias de FastAPI: autenticación, roles, base de datos.
Uso: current_user: User = Depends(get_current_user)
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError

from app.db.database import get_db
from app.core.security import decode_token
from app.core.maintenance import is_maintenance_active
from app.models.models import User, UserRole, UserStatus

# Esquema Bearer para el header Authorization
bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependencia principal de autenticación.
    Extrae el usuario del JWT token en el header Authorization.

    Uso en cualquier endpoint:
        @router.get("/perfil")
        async def get_profile(user: User = Depends(get_current_user)):
            ...
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(credentials.credentials)
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Buscar usuario en BD
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise credentials_exception

    if user.status == UserStatus.SUSPENDED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta suspendida. Contacte soporte."
        )

    if user.role != UserRole.ADMIN and await is_maintenance_active(db):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "MAINTENANCE_MODE",
                "message": "La plataforma está en mantenimiento. Volvé en un momento.",
            },
        )

    return user


async def get_current_patient(
    current_user: User = Depends(get_current_user)
) -> User:
    """Solo permite acceso a pacientes."""
    if current_user.role != UserRole.PATIENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para pacientes"
        )
    return current_user


async def get_current_professional(
    current_user: User = Depends(get_current_user)
) -> User:
    """Solo permite acceso a profesionales."""
    if current_user.role != UserRole.PROFESSIONAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para profesionales"
        )
    return current_user


async def get_current_admin(
    current_user: User = Depends(get_current_user)
) -> User:
    """Solo permite acceso a administradores."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso solo para administradores"
        )
    return current_user