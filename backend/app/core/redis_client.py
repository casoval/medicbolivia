"""
app/core/redis_client.py
Cliente Redis async, usado para rate limiting (ej. intentos de login).
"""
import redis.asyncio as redis
from app.core.config import settings

redis_client = redis.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    socket_timeout=None,
)

# Cliente Redis dedicado a seguridad (OTP de WhatsApp, bloqueo de login,
# rate limit de "olvidé mi contraseña"). En producción apunta a una
# instancia separada del Redis compartido con Celery (ver
# scripts/setup_redis_security.sh) para que un incidente en un dominio
# (ej. Celery cayéndose de memoria) no arrastre al otro. Si no se define
# AUTH_REDIS_URL (típico en desarrollo local), cae al mismo REDIS_URL de
# siempre — el namespacing de las keys (otp:, login_attempts:, etc.) ya
# evita colisiones, así que es seguro compartir la instancia en local.
security_redis_client = redis.from_url(
    settings.AUTH_REDIS_URL or settings.REDIS_URL, decode_responses=True
)
