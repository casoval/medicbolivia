"""
app/core/crypto.py
Cifrado simétrico (Fernet) para datos financieros sensibles que sí
necesitamos poder leer de vuelta — a diferencia de una contraseña, que se
hashea y nunca se descifra. Hoy solo lo usa ProfessionalBankAccount
(account_number, account_holder_ci) — ver app/models/models.py.

Usa una clave separada de SECRET_KEY (mismo criterio que ya se usa para
BANK_INBOUND_TOKEN_SECRET en config.py) para poder rotarla sin invalidar
sesiones de usuarios.

La clave se valida recién al primer uso (no al arrancar la app) para no
romper un ambiente que todavía no maneja pagos a profesionales — ver
BANK_ACCOUNT_ENCRYPTION_KEY en app/core/config.py.
"""
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


@lru_cache
def _fernet() -> Fernet:
    key = settings.BANK_ACCOUNT_ENCRYPTION_KEY
    if not key:
        raise RuntimeError(
            "BANK_ACCOUNT_ENCRYPTION_KEY no está configurado. Generá uno con: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" '
            "y ponelo en tu .env — sin esto no se pueden guardar cuentas bancarias."
        )
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_value(plain: str) -> str:
    """Cifra un string (ej. número de cuenta o CI del titular)."""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_value(token: str) -> str:
    """Descifra un valor cifrado con encrypt_value. Lanza ValueError si la
    clave no corresponde o el dato está corrupto — nunca falla en silencio
    con datos bancarios."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise ValueError("No se pudo descifrar el valor — clave incorrecta o dato corrupto")
