"""
app/services/whatsapp_throttle.py
Piso GLOBAL de espaciado entre cualquier envío real a whatsapp-service,
sin importar qué parte del sistema lo dispara.

Por qué existe esto y no alcanza con el rate_limit de Celery:
  - `rate_limit` en las tareas de whatsapp_tasks.py (ver ese archivo) solo
    protege lo que pasa POR Celery. Usa un TokenBucket con capacity=1 por
    tarea (ver celery/worker/consumer/consumer.py::TokenBucket(limit,
    capacity=1)), así que dentro de una misma tarea nunca hay ráfaga —
    pero es un bucket por NOMBRE de tarea (send_whatsapp_message y
    send_whatsapp_document tienen cada uno el suyo, sin coordinarse entre
    sí), y sobre todo: no ve nada que no pase por .delay()/.apply_async().
  - El envío de OTP (app/services/whatsapp.py, llamado síncrono desde
    /auth/otp/send y /auth/password/forgot) le pega a whatsapp-service
    DIRECTO, sin encolar nada — nunca pasa por Celery, así que el
    rate_limit no lo ve. Solo tenía cooldown POR TELÉFONO, no un límite
    global: nada impedía que 5 OTPs a números distintos, o un OTP y un
    recordatorio en background, salieran en el mismo segundo real.

Esta es la única puerta de entrada real hacia whatsapp-service (una sola
sesión de whatsapp-web.js, un solo Chromium) — así que el piso tiene que
vivir acá, en Redis, compartido por TODOS los procesos que pueden llegar
a mandar un mensaje: los workers de uvicorn (OTP, panel admin) y el
worker de Celery (recordatorios, broadcast, agente IA).

Deliberadamente separado del jitter de 12-35s de reminder_tasks.py: ese
jitter es para que un LOTE grande no se vea con ritmo mecánico. Este
piso es más chico (unos segundos) y busca otra cosa: que dos envíos de
ORÍGENES DISTINTOS jamás salgan en el mismo instante real, aunque cada
uno por separado esté bien escalonado puertas adentro.
"""
import asyncio
import time

from loguru import logger

from app.core.redis_client import redis_client
from app.services.whatsapp_pause import WhatsAppPausedError, is_whatsapp_paused

# Separación mínima real entre dos envíos consecutivos a whatsapp-service,
# sin importar el origen. Deliberadamente chico (no son los 12-35s del
# jitter de lotes) para no castigar la latencia del OTP, que el usuario
# está esperando en pantalla — alcanza con evitar la simultaneidad real,
# no con imitar el patrón "humano" de un lote grande.
WHATSAPP_GLOBAL_MIN_GAP_SECONDS = 3.0

_LAST_SEND_KEY = "whatsapp:global:last_send_at"


async def wait_for_whatsapp_slot(min_gap_seconds: float = WHATSAPP_GLOBAL_MIN_GAP_SECONDS) -> None:
    """
    Bloquea hasta que hayan pasado al menos `min_gap_seconds` desde el
    último envío real a whatsapp-service, sin importar qué código lo
    haya hecho. Debe llamarse INMEDIATAMENTE antes del POST a
    whatsapp-service (no antes) — ver los dos call sites:
    app/services/whatsapp.py::send_whatsapp_otp y
    app/tasks/whatsapp_tasks.py::_send_and_log / _send_document_and_log.

    Nota de concurrencia: hay una ventana de milisegundos entre el GET y
    el SET (no es un lock atómico tipo Redlock) — deliberado, porque acá
    lo que importa es no solapar envíos que están separados por segundos
    (el patrón que preocupa: dos mensajes en el mismo segundo real desde
    orígenes que no se conocen entre sí), no una exclusión mutua perfecta
    a nivel de milisegundos.

    Raises:
        WhatsAppPausedError: si el kill switch (whatsapp_pause.py) está
            activo. Se chequea ACÁ, en el portón único hacia
            whatsapp-service, para que sea imposible que un call site
            nuevo se olvide de respetarlo. Deliberadamente falla rápido
            (no espera a que se levante la pausa) — cada call site decide
            qué hacer: OTP la propaga y responde al usuario ya, las
            tareas de Celery la capturan y se reencolan solas más tarde.
    """
    if await is_whatsapp_paused():
        raise WhatsAppPausedError("Envíos de WhatsApp pausados por un admin")

    while True:
        now = time.time()
        last_raw = await redis_client.get(_LAST_SEND_KEY)
        if last_raw is not None:
            elapsed = now - float(last_raw)
            if elapsed < min_gap_seconds:
                wait_s = min_gap_seconds - elapsed
                logger.info(f"whatsapp_throttle: esperando {wait_s:.1f}s (piso global de {min_gap_seconds}s)")
                await asyncio.sleep(wait_s)
                continue
        await redis_client.set(_LAST_SEND_KEY, str(time.time()), ex=300)
        return
