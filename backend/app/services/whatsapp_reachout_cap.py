"""
app/services/whatsapp_reachout_cap.py
Tope diario de a cuántos números NUNCA antes contactados por la
plataforma se les puede mandar WhatsApp — configurable desde el panel
admin (PlatformSettings.whatsapp_new_contacts_daily_cap, ver Settings →
Contactos nuevos por WhatsApp).

Por qué existe: WhatsApp (vía whatsapp-web.js, no es la Business API
oficial) restringe en silencio los envíos a contactos nuevos por cuenta —
el "Reachout Timelock" (error 463), confirmado de forma independiente
por varias librerías del ecosistema (WAHA, Baileys) como una política del
lado del SERVIDOR de WhatsApp, no un bug de cliente ni algo relacionado
al contenido del mensaje. Con una cuenta que ya tuvo restricciones
previas, el margen real puede ser mucho más chico que lo esperable para
una cuenta sana — de ahí que esto exista como un tope explícito y
conservador, no una corazonada de "no mandar tanto".

Deliberadamente separado de whatsapp_throttle.py (ese archivo es sobre
ESPACIADO entre envíos que van a pasar sí o sí) y de whatsapp_pause.py
(ese es un corte total, todo o nada) — este es un tercer tipo de control:
un CONTEO diario que solo mira contactos NUEVOS, dejando pasar sin límite
los mensajes a conversaciones ya existentes.

Qué pasa al llegar al tope: el mensaje NO se pierde ni falla — se
reprograma para el día siguiente (ver requeue_for_tomorrow más abajo),
mismo criterio que WhatsAppPausedError en whatsapp_tasks.py.
"""
from datetime import timedelta

from loguru import logger

from app.core.redis_client import redis_client
from app.core.timezone import bolivia_now_naive, bolivia_today_midnight_naive

_COUNT_KEY_PREFIX = "whatsapp:new_contacts_count:"
_INCIDENT_LOG_KEY = "whatsapp:new_contacts_cap:incidents"
_MAX_INCIDENT_LOG_ENTRIES = 200


class WhatsAppReachoutCapExceededError(Exception):
    """Se levanta cuando ya se llegó al tope diario de contactos nuevos."""
    pass


def _today_key() -> str:
    # Fecha calendario de Bolivia, no UTC — mismo criterio que membresías
    # (ver app/core/timezone.py): un mensaje a las 21:30 hora Bolivia ya
    # es "mañana" en UTC, y contarlo en el día UTC equivocado corta la
    # rampa a mitad de la noche local sin motivo.
    return _COUNT_KEY_PREFIX + bolivia_today_midnight_naive().strftime("%Y-%m-%d")


async def get_new_contacts_sent_today() -> int:
    raw = await redis_client.get(_today_key())
    return int(raw) if raw is not None else 0


async def register_new_contact_sent() -> int:
    """Suma 1 al contador de HOY (llamar solo tras un envío real exitoso
    a un contacto nuevo — ver _send_and_log / _send_document_and_log en
    whatsapp_tasks.py). TTL de 26h: sobra margen para que el contador de
    ayer no se borre antes de tiempo por un reloj corrido, pero igual se
    autolimpia solo, sin acumular claves viejas para siempre."""
    key = _today_key()
    new_count = await redis_client.incr(key)
    if new_count == 1:
        await redis_client.expire(key, 26 * 3600)
    return new_count


async def check_reachout_cap(daily_cap: int, unlimited: bool = False) -> None:
    """
    Levanta WhatsAppReachoutCapExceededError si ya se llegó al tope de
    HOY. daily_cap viene de PlatformSettings — lo pasa el caller (ver
    _send_and_log) para no acoplar este módulo a una sesión de DB.
    daily_cap <= 0 significa "pausa total de contactos nuevos" (0 no es
    "sin límite" — para eso está el parámetro `unlimited` de acá abajo).

    unlimited=True desactiva el chequeo por completo, sin importar
    daily_cap (ver PlatformSettings.whatsapp_new_contacts_unlimited) — el
    contador de Redis igual sigue sumando en segundo plano (no se
    desactiva el conteo, solo la restricción), así que si se vuelve a
    apagar el toggle a mitad del día, el tope retoma desde el número real
    de contactos ya alcanzados hoy, no desde cero.
    """
    if unlimited:
        return
    sent_today = await get_new_contacts_sent_today()
    if sent_today >= daily_cap:
        raise WhatsAppReachoutCapExceededError(
            f"Tope diario de contactos nuevos alcanzado ({sent_today}/{daily_cap})"
        )


def seconds_until_tomorrow() -> float:
    """Segundos hasta la medianoche de MAÑANA, hora Bolivia — para
    reprogramar un envío pospuesto por el tope (ver requeue vía
    apply_async(countdown=...) en whatsapp_tasks.py). Un par de minutos
    de margen extra para no reencolar justo al filo del corte."""
    tomorrow_midnight = bolivia_today_midnight_naive() + timedelta(days=1, minutes=2)
    return max(60.0, (tomorrow_midnight - bolivia_now_naive()).total_seconds())


async def log_cap_incident(phone: str, sent_today: int, daily_cap: int) -> None:
    """
    Registra en Redis (lista acotada, no una tabla — esto es un log
    operativo para que el admin vea si el tope se está llegando a topear
    seguido, no un dato de negocio que necesite SQL) cada vez que se
    pospone un mensaje por el tope. Pensado para mostrarse en el panel
    Settings junto al campo del tope, así el admin ve de un vistazo si
    conviene subir la rampa o si todavía está bien donde está.
    """
    import json
    entry = json.dumps({
        "phone": phone,
        "at": bolivia_now_naive().isoformat(),
        "sent_today": sent_today,
        "daily_cap": daily_cap,
    })
    await redis_client.lpush(_INCIDENT_LOG_KEY, entry)
    await redis_client.ltrim(_INCIDENT_LOG_KEY, 0, _MAX_INCIDENT_LOG_ENTRIES - 1)
    logger.warning(f"whatsapp_reachout_cap: mensaje a {phone} pospuesto para mañana ({sent_today}/{daily_cap} de hoy)")


async def get_recent_cap_incidents(limit: int = 50) -> list[dict]:
    import json
    raw_entries = await redis_client.lrange(_INCIDENT_LOG_KEY, 0, limit - 1)
    out = []
    for raw in raw_entries:
        try:
            out.append(json.loads(raw))
        except (json.JSONDecodeError, TypeError):
            continue
    return out
