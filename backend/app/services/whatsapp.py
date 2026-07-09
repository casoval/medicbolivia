"""
app/services/whatsapp.py
Envío del código OTP (verificación de teléfono / recuperación de
contraseña) a través de whatsapp-service (whatsapp-web.js) — el mismo
microservicio Node que usa el resto de la app para recordatorios y
respuestas del agente. Ya NO se usa WhatsApp Cloud API (Meta) para esto:
mandar mensajes de negocio vía Cloud API requiere una plantilla
"Authentication" pre-aprobada por Meta, lo cual agregaba una dependencia
externa frágil (ver historial: fallaba con 132001 "template name does
not exist") para algo que whatsapp-web.js ya resuelve sin plantillas,
porque manda texto libre desde un número real conectado por QR.
"""
import httpx
from loguru import logger

from app.core.config import settings
from app.core.phone import normalize_bo_phone


async def send_whatsapp_otp(phone: str, code: str) -> bool:
    """
    Envía el código OTP como mensaje de texto plano vía whatsapp-service.

    Requiere que el microservicio Node (whatsapp-service/) esté corriendo
    y con la sesión de WhatsApp conectada (ver GET /status). Si no lo
    está, whatsapp-service devuelve 503 y acá lo tratamos como fallo,
    igual que cualquier otro error de envío.
    """
    try:
        to = normalize_bo_phone(phone)
    except Exception as exc:
        logger.error(f"Teléfono inválido, no se puede enviar OTP: {phone} ({exc})")
        return False

    message = (
        f"Tu código de verificación de MedicBolivia es: *{code}*\n\n"
        f"Expira en {settings.OTP_EXPIRE_MINUTES} minutos. "
        "No lo compartas con nadie."
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.WHATSAPP_SERVICE_URL}/send",
                json={"to": to, "message": message},
                headers={"X-Internal-Secret": settings.WHATSAPP_SERVICE_INTERNAL_SECRET},
            )
    except httpx.RequestError as exc:
        logger.error(f"Error de red enviando OTP por WhatsApp a {phone}: {exc}")
        return False

    if resp.status_code >= 400:
        logger.error(
            f"Error enviando OTP por WhatsApp a {phone}: "
            f"whatsapp-service {resp.status_code} {resp.text[:250]}"
        )
        return False

    logger.info(f"OTP WhatsApp enviado a {phone} vía whatsapp-service")
    return True
