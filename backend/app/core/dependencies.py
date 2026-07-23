"""
app/core/dependencies.py
Dependencias de FastAPI: autenticación, roles, base de datos.
Uso: current_user: User = Depends(get_current_user)
"""
from fastapi import Depends, HTTPException, status, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from typing import Optional

from app.db.database import get_db
from app.core.security import decode_token, AUTH_COOKIE_NAME
from app.core.maintenance import is_maintenance_active
from app.models.models import User, UserRole, UserStatus

# Esquema Bearer para el header Authorization. auto_error=False porque la
# fuente principal de auth ahora es la cookie httpOnly (AUTH_COOKIE_NAME,
# ver security.py) — el header queda como alternativa para scripts,
# Postman, o una futura app móvil que no maneje cookies. Si ninguna de
# las dos fuentes trae el token, get_current_user es quien decide
# lanzar 401, no este scheme.
bearer_scheme = HTTPBearer(auto_error=False)


def _extract_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
) -> Optional[str]:
    """
    Busca el JWT primero en la cookie httpOnly (uso normal desde el
    frontend web) y, si no está, en el header "Authorization: Bearer"
    (scripts, Postman, apps que no manejan cookies).
    """
    cookie_token = request.cookies.get(AUTH_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    if credentials:
        return credentials.credentials
    return None


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependencia principal de autenticación.
    Extrae el usuario del JWT, ya sea de la cookie httpOnly o del header
    Authorization (ver _extract_token).

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

    token = _extract_token(request, credentials)
    if not token:
        raise credentials_exception

    try:
        payload = decode_token(token)
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


async def get_current_user_optional(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """
    Igual que get_current_user, pero NO lanza 401 si no hay token o es
    inválido — retorna None. Usada en endpoints públicos (ej. directorio
    de profesionales) que deben aplicar filtros extra (como
    ProfessionalPatientVisibility) SOLO si el visitante está logueado
    como paciente, sin romper el acceso anónimo al resto del directorio.
    """
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        if not authorization or not authorization.lower().startswith("bearer "):
            return None
        token = authorization.split(" ", 1)[1].strip()

    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.status == UserStatus.SUSPENDED:
        return None
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