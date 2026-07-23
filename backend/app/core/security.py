"""
app/core/security.py
Manejo de JWT tokens y hash de contraseñas.
"""
from datetime import timedelta
from typing import Optional, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Response
from app.core.config import settings
from app.core.timezone import utcnow_naive


# ── Hash de contraseñas ───────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hashea una contraseña con bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica si una contraseña coincide con su hash."""
    return pwd_context.verify(plain_password, hashed_password)


# ── JWT Tokens ────────────────────────────────────────

def create_access_token(
    subject: str,
    role: str,
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Crea un JWT token de acceso.

    Args:
        subject: ID del usuario
        role: Rol del usuario (PATIENT, PROFESSIONAL, ADMIN)
        expires_delta: Tiempo de expiración personalizado

    Returns:
        Token JWT firmado
    """
    if expires_delta:
        expire = utcnow_naive() + expires_delta
    else:
        expire = utcnow_naive() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    payload = {
        "sub": subject,
        "role": role,
        "exp": expire,
        "iat": utcnow_naive(),
    }

    return jwt.encode(
        payload,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )


def decode_token(token: str) -> dict[str, Any]:
    """
    Decodifica y valida un JWT token.

    Raises:
        JWTError: Si el token es inválido o expiró
    """
    return jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM]
    )


# ── Cookie httpOnly (auth del frontend web) ───────────
# Nombre distinto de "mb_token" (la vieja key de localStorage) a propósito,
# para no confundir el mecanismo viejo con el nuevo durante la migración.
AUTH_COOKIE_NAME = "mb_access_token"


def set_auth_cookie(response: Response, token: str) -> None:
    """
    Guarda el JWT en una cookie httpOnly — es la fuente principal de auth
    para el frontend web (ver get_current_user en dependencies.py, que
    también sigue aceptando el header Authorization como alternativa para
    scripts/Postman/una futura app móvil).

    httponly=True: JavaScript no puede leer esta cookie ni con una
    vulnerabilidad XSS — es la protección real que buscamos con este
    cambio (antes el JWT vivía en localStorage, legible por cualquier
    script que lograra ejecutarse en la página).

    secure solo en producción: los navegadores rechazan cookies Secure
    sobre conexiones HTTP simples, y el desarrollo local (localhost) no
    usa HTTPS.

    samesite="strict": frontend y backend viven bajo el mismo dominio en
    producción (medicbolivia.com, ver ALLOWED_ORIGINS) — no hace falta
    relajarlo a "lax" ni a "none".
    """
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="strict",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    """Borra la cookie de auth — usado en /auth/logout."""
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
        secure=settings.ENVIRONMENT == "production",
        samesite="strict",
    )
