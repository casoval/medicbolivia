"""
app/services/whatsapp.py
Envío de mensajes vía WhatsApp Cloud API (Meta) para verificación
de teléfono mediante código OTP en el registro de MedicBolivia.
"""
import httpx
from loguru import logger

from app.core.config import settings
from app.core.phone import normalize_bo_phone


def _whatsapp_api_url() -> str:
    return (
        f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}"
        f"/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )


def _to_e164(phone: str) -> str:
    """
    Delega en app.core.phone.normalize_bo_phone — antes esta función
    tenía su propia normalización duplicada (y más laxa: no forzaba el
    código de país). Ver ese módulo para el porqué del formato canónico.
    """
    return normalize_bo_phone(phone)


async def send_whatsapp_otp(phone: str, code: str) -> bool:
    """
    Envía el código OTP usando una plantilla de mensajes (categoría
    "Authentication") previamente aprobada en Meta Business Manager.

    IMPORTANTE: la Cloud API NO permite mandar texto libre a un número
    que nunca te escribió primero (o que no escribió en las últimas 24h).
    Para mensajes iniciados por el negocio (como un OTP) es obligatorio
    usar una plantilla aprobada. Creála en:
    business.facebook.com -> WhatsApp Manager -> Plantillas de mensajes
    -> categoría "Autenticación", con una variable {{1}} para el código.

    Ajustá WHATSAPP_OTP_TEMPLATE_NAME / WHATSAPP_OTP_TEMPLATE_LANG en el
    .env para que coincidan exactamente con el nombre e idioma de tu
    plantilla aprobada.
    """
    payload = {
        "messaging_product": "whatsapp",
        "to": _to_e164(phone),
        "type": "template",
        "template": {
            "name": settings.WHATSAPP_OTP_TEMPLATE_NAME,
            "language": {"code": settings.WHATSAPP_OTP_TEMPLATE_LANG},
            "components": [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": code}],
                }
            ],
        },
    }

    headers = {
        "Authorization": f"Bearer {settings.WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(_whatsapp_api_url(), json=payload, headers=headers)
    except httpx.RequestError as exc:
        logger.error(f"Error de red enviando OTP por WhatsApp a {phone}: {exc}")
        return False

    if resp.status_code >= 400:
        logger.error(
            f"Error enviando OTP por WhatsApp a {phone}: "
            f"{resp.status_code} {resp.text}"
        )
        return False

    logger.info(f"OTP WhatsApp enviado a {phone}")
    return True
