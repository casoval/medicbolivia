"""
app/core/security.py
Manejo de JWT tokens y hash de contraseñas.
"""
from datetime import timedelta
from typing import Optional, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
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
