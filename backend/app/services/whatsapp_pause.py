"""
app/services/whatsapp_pause.py
Kill switch global de envíos a WhatsApp: un flag en Redis que cualquier
admin puede prender desde el panel para frenar TODO envío real al
instante, sin bajar contenedores ni tocar código.

Motivación: la noche del 13→14 de agosto se banearon las cuentas de
WhatsApp y la única forma de frenar el sangrado fue bajar el worker de
Celery a mano mientras se diagnosticaba en caliente. Este flag es la
respuesta directa a eso — "algo se ve raro, corto ya" — independiente de
cualquier diagnóstico.

Vive en el MISMO Redis que whatsapp_throttle.py (compartido con Celery),
no en security_redis_client: esto no es una medida de seguridad por
usuario, es un interruptor de sistema que tienen que ver todos los
procesos que pueden llegar a mandar un mensaje (uvicorn y Celery worker
por igual).

Deliberadamente separado de whatsapp_throttle.py (ese archivo es sobre
ESPACIADO entre envíos que van a pasar sí o sí; este es sobre si un envío
pasa o no pasa en absoluto) — mismo Redis, responsabilidad distinta.
"""
import json
from typing import Optional

from loguru import logger

from app.core.redis_client import redis_client
from app.core.timezone import utcnow_naive

_PAUSE_KEY = "whatsapp:global:paused"
_PAUSE_META_KEY = "whatsapp:global:paused:meta"

# Sin TTL: un kill switch que se auto-apaga solo por timeout no es un
# kill switch confiable — tiene que quedar prendido hasta que un admin
# lo apague a mano, sin importar cuánto tarde el diagnóstico.


class WhatsAppPausedError(Exception):
    """Se levanta cuando algo intenta mandar un WhatsApp con el kill switch activo."""
    pass


async def is_whatsapp_paused() -> bool:
    return await redis_client.get(_PAUSE_KEY) == "1"


async def get_pause_info() -> Optional[dict]:
    """None si no está pausado; si no, {reason, by, at}."""
    raw = await redis_client.get(_PAUSE_META_KEY)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"reason": raw, "by": None, "at": None}


async def set_whatsapp_paused(paused: bool, reason: str = "", admin_email: str = "") -> None:
    if paused:
        meta = {
            "reason": reason or "(sin motivo especificado)",
            "by": admin_email or "desconocido",
            "at": utcnow_naive().isoformat(),
        }
        await redis_client.set(_PAUSE_KEY, "1")
        await redis_client.set(_PAUSE_META_KEY, json.dumps(meta))
        logger.warning(
            f"🛑 WHATSAPP PAUSADO por {meta['by']}: {meta['reason']}"
        )
    else:
        await redis_client.delete(_PAUSE_KEY)
        await redis_client.delete(_PAUSE_META_KEY)
        logger.warning(f"✅ WhatsApp reanudado por {admin_email or 'desconocido'}")
