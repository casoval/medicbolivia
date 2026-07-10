"""
app/api/v1/endpoints/contact.py
Formulario público de "Contáctanos" de la landing (sin cuenta, sin login).

Flujo:
1. Honeypot: si el campo oculto `website` viene con algo, se descarta en
   silencio (201 falso, no se guarda ni se avisa) — es un bot.
2. Rate-limit por IP (Redis) para frenar spam sin necesitar CAPTCHA.
3. Tope diario GLOBAL (Redis) como freno de emergencia contra spam
   repartido entre muchas IPs distintas.
4. Se guarda la consulta en `contact_inquiries` ANTES de intentar el correo
   — así, si el SMTP de Hostinger falla, la consulta no se pierde.
5. Se intenta avisar por correo a info@medicbolivia.com. Si falla, se loguea
   el error pero la petición igual responde 201: para la persona que llenó
   el formulario, su consulta ya quedó registrada.
"""
import smtplib
from datetime import datetime
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from app.db.database import get_db
from app.core.config import settings
from app.core.redis_client import security_redis_client as redis_client
from app.models.models import ContactInquiry
from app.schemas.schemas import ContactInquiryCreateRequest, ContactInquiryResponse

router = APIRouter()

INQUIRY_TYPE_LABELS = {
    "PACIENTE": "Consulta como paciente",
    "PROFESIONAL": "Quiero unirme como profesional de salud",
    "SOPORTE": "Soporte técnico",
    "FACTURACION": "Facturación / pagos",
    "OTRO": "Otro",
}


def _send_notification_email(inquiry: ContactInquiry) -> None:
    if not settings.CONTACT_SMTP_USER or not settings.CONTACT_SMTP_PASSWORD:
        raise RuntimeError(
            "Faltan CONTACT_SMTP_USER / CONTACT_SMTP_PASSWORD en el .env "
            "(credenciales del buzón info@medicbolivia.com en Hostinger)."
        )

    location = f"{inquiry.city}, {inquiry.country}" if inquiry.city else inquiry.country
    inquiry_label = INQUIRY_TYPE_LABELS.get(inquiry.inquiry_type, inquiry.inquiry_type)

    body = (
        "Nueva consulta recibida desde el formulario de contacto de la web.\n\n"
        f"Nombre completo: {inquiry.full_name}\n"
        f"Ciudad / país: {location}\n"
        f"Teléfono: +{inquiry.phone}\n"
        f"Correo: {inquiry.email or '(no proporcionado)'}\n"
        f"Tipo de consulta: {inquiry_label}\n\n"
        "Mensaje:\n"
        f"{inquiry.message}\n\n"
        "—\n"
        f"ID interno: {inquiry.id}\n"
    )

    msg = EmailMessage()
    msg["Subject"] = f"[Web MedicBolivia] Nueva consulta de {inquiry.full_name}"
    msg["From"] = settings.CONTACT_SMTP_USER
    msg["To"] = settings.CONTACT_RECIPIENT_EMAIL
    if inquiry.email:
        # Así, si alguien del equipo le da "Responder" al correo, le
        # contesta directo a la persona que llenó el formulario.
        msg["Reply-To"] = inquiry.email
    msg.set_content(body)

    with smtplib.SMTP_SSL(settings.CONTACT_SMTP_HOST, settings.CONTACT_SMTP_PORT, timeout=15) as server:
        server.login(settings.CONTACT_SMTP_USER, settings.CONTACT_SMTP_PASSWORD)
        server.send_message(msg)


@router.post(
    "",
    response_model=ContactInquiryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Enviar una consulta desde el formulario público de contacto",
)
async def create_contact_inquiry(
    data: ContactInquiryCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Sin autenticación a propósito: lo llena cualquier visitante de la
    landing, con o sin cuenta.
    """
    # Honeypot: un campo oculto que ninguna persona real completa. Si un
    # bot lo llenó, respondemos 201 igual (para no delatar el truco y que
    # el bot no "aprenda" a evitarlo) pero no guardamos nada ni mandamos
    # correo — es puro descarte silencioso.
    if data.website.strip():
        logger.warning(f"Formulario de contacto descartado por honeypot (IP {request.client.host if request.client else 'unknown'})")
        return ContactInquiryResponse(
            id="00000000-0000-0000-0000-000000000000",
            full_name=data.full_name,
            city=data.city,
            country=data.country,
            phone=data.phone,
            email=data.email,
            inquiry_type=data.inquiry_type,
            message=data.message,
            created_at=datetime.utcnow(),
        )

    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"contact_form_ip:{client_ip}"
    attempts = await redis_client.incr(rate_key)
    if attempts == 1:
        await redis_client.expire(rate_key, 3600)
    if attempts > settings.CONTACT_FORM_MAX_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Enviaste demasiadas consultas en poco tiempo. Probá de nuevo en un rato.",
        )

    # Freno de emergencia global: protege contra spam repartido entre
    # muchas IPs distintas, donde el límite de arriba (por IP) no alcanza.
    daily_key = f"contact_form_daily:{datetime.utcnow().strftime('%Y-%m-%d')}"
    daily_count = await redis_client.incr(daily_key)
    if daily_count == 1:
        await redis_client.expire(daily_key, 86400)
    if daily_count > settings.CONTACT_FORM_MAX_PER_DAY:
        logger.warning(f"Tope diario global de consultas de contacto alcanzado ({settings.CONTACT_FORM_MAX_PER_DAY})")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Estamos recibiendo muchas consultas ahora mismo. Probá de nuevo más tarde o escribinos directo a info@medicbolivia.com.",
        )

    inquiry = ContactInquiry(
        full_name=data.full_name,
        city=data.city,
        country=data.country,
        phone=data.phone,
        email=data.email,
        inquiry_type=data.inquiry_type,
        message=data.message,
    )
    db.add(inquiry)
    await db.flush()

    try:
        _send_notification_email(inquiry)
        inquiry.email_sent = True
    except Exception as exc:
        # No tumbamos la petición si falla el correo: la consulta ya quedó
        # guardada en la base y se puede revisar/reenviar a mano después.
        logger.error(f"No se pudo enviar el correo de la consulta {inquiry.id}: {exc}")

    await db.commit()
    await db.refresh(inquiry)
    logger.info(f"Nueva consulta web recibida: {inquiry.id} ({inquiry.full_name}, {inquiry.inquiry_type})")
    return inquiry
