"""
app/services/registration_verification.py
Kill switch de la verificación de teléfono por WhatsApp en el registro:
un flag en Redis que un admin puede apagar desde el panel cuando el bot
de WhatsApp no está disponible (caído, número baneado, corte del
proveedor, etc.) y no se quiere frenar el alta de pacientes y
profesionales nuevos mientras se soluciona.

Mismo patrón que whatsapp_pause.py (mismo tipo de interruptor, distinta
responsabilidad): acá no se pausa el ENVÍO de WhatsApp, se hace opcional
el PASO de verificación dentro del registro. Con el flag apagado,
/auth/register/patient y /auth/register/professional aceptan la cuenta
sin exigir que el teléfono haya pasado por /auth/otp/send + /auth/otp/verify.

Vive en security_redis_client (el mismo Redis que ya usa auth.py para
`phone_verified:{phone}`, intentos de login, etc.) porque es un dato que
solo necesita ver el proceso de uvicorn al validar un registro — no hay
Celery de por medio acá, a diferencia del kill switch de envíos.

Sin TTL, por la misma razón que en whatsapp_pause.py: un admin lo prende
a mano cuando hay un problema y lo apaga a mano cuando se resolvió: no
tiene sentido que se reactive solo por timeout mientras el problema
posiblemente siga en pie.
"""
import json
from typing import Optional

from loguru import logger

from app.core.redis_client import security_redis_client as redis_client
from app.core.timezone import utcnow_naive

_DISABLED_KEY = "registration:phone_verification_disabled"
_DISABLED_META_KEY = "registration:phone_verification_disabled:meta"


async def is_phone_verification_required() -> bool:
    """True por defecto (comportamiento actual): hay que verificar el
    teléfono por WhatsApp antes de poder registrarse."""
    return await redis_client.get(_DISABLED_KEY) != "1"


async def get_disabled_info() -> Optional[dict]:
    """None si la verificación sigue obligatoria; si no, {reason, by, at}."""
    raw = await redis_client.get(_DISABLED_META_KEY)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"reason": raw, "by": None, "at": None}


async def set_phone_verification_required(required: bool, reason: str = "", admin_email: str = "") -> None:
    if not required:
        meta = {
            "reason": reason or "(sin motivo especificado)",
            "by": admin_email or "desconocido",
            "at": utcnow_naive().isoformat(),
        }
        await redis_client.set(_DISABLED_KEY, "1")
        await redis_client.set(_DISABLED_META_KEY, json.dumps(meta))
        logger.warning(
            f"🛑 VERIFICACIÓN DE TELÉFONO EN REGISTRO DESACTIVADA por {meta['by']}: {meta['reason']}"
        )
    else:
        await redis_client.delete(_DISABLED_KEY)
        await redis_client.delete(_DISABLED_META_KEY)
        logger.warning(f"✅ Verificación de teléfono en registro reactivada por {admin_email or 'desconocido'}")
