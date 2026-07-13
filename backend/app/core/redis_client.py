"""
app/core/redis_client.py
Cliente Redis async, usado para rate limiting (ej. intentos de login).
"""
import redis.asyncio as redis
from app.core.config import settings

redis_client = redis.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    # Sin esto, una conexión TCP a Redis que queda "zombie" (cortada por el
    # SO, un firewall intermedio, o el propio Redis por idle) puede quedar
    # colgada indefinidamente sin lanzar ningún error — el pubsub del chat
    # (ver chat_ws_manager.py) dejaría de recibir mensajes en silencio.
    # health_check_interval fuerza un PING periódico que detecta esto y
    # fuerza la reconexión.
    health_check_interval=30,
    socket_keepalive=True,
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
