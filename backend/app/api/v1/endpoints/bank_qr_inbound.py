"""
app/api/v1/endpoints/bank_qr_inbound.py
Endpoints INBOUND de la integración con Banco Ganadero — el banco nos
llama a nosotros. Cubre las secciones 6 y 7 de la Especificación
Técnica v1.7 ("Autenticación en Empresa" y "Registro de Pago de Orden
de Cobro en Empresa").

Esto es lo opuesto a app.services.bank_qr (donde MedicBolivia llama al
banco). Va en un router propio, no dentro de consultations.py, porque
lo llama el banco directamente — no un usuario autenticado de la app —
así que necesita su propio esquema de auth (JWT firmado con
BANK_INBOUND_TOKEN_SECRET, no el de sesión de usuarios).

Notas sobre el header de autorización:
La spec (sección 8, "Notas Adicionales") es ambigua: en la tabla de
"Datos del Encabezado" de /login y /payments usa "token" como en los
demás endpoints, pero la tabla de "Parámetros Authorization Header" al
final dice "JWT: Bearer Token". En vez de apostar a una interpretación,
_extract_bank_token acepta las dos formas.
"""
import hmac
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header, Request, status
from jose import JWTError, jwt
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import utcnow_naive
from app.core.redis_client import redis_client
from app.db.database import get_db
from app.models.models import Payment, PaymentStatus
from app.schemas.schemas import (
    BankLoginRequest, BankLoginResponse,
    BankPaymentConfirmRequest, BankPaymentConfirmResponse,
)
# Reusa la misma lógica de activación de consulta que el webhook legado
# (ver refactor en consultations.py) — un solo lugar decide qué pasa con
# la Consultation cuando un pago se confirma, sin importar por qué canal
# llegó la confirmación.
from app.api.v1.endpoints.consultations import confirm_payment_and_activate_consultation

router = APIRouter()

BANK_JWT_ALGORITHM = "HS256"

# Rate limit de /bank-integration/login por IP. En uso normal, el banco
# solo pide un token nuevo cada ~5 min (el token dura 300s, ver
# bank_qr.py) — 20 intentos cada 5 minutos le sobra de margen a cualquier
# reintento legítimo, pero ya alcanza para frenar en serio un intento de
# fuerza bruta contra BANK_INBOUND_USERNAME/PASSWORD, que a diferencia del
# resto del login de la app (con bloqueo por intentos) no tenía ningún
# límite.
_BANK_LOGIN_RATE_LIMIT_MAX = 20
_BANK_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 300


async def _check_bank_login_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"bank_login_rate:{ip}"
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _BANK_LOGIN_RATE_LIMIT_WINDOW_SECONDS)
    except Exception as e:
        # Si Redis está caído, no tiene sentido bloquear al banco por esto.
        logger.warning(f"No se pudo chequear rate limit de bank_login: {e}")
        return
    if count > _BANK_LOGIN_RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Demasiados intentos, esperá unos minutos")


def _bank_token_secret() -> str:
    """
    Si el operador todavía no generó un secreto dedicado
    (BANK_INBOUND_TOKEN_SECRET vacío), cae a SECRET_KEY para que el
    endpoint no crashee al arrancar — pero esto es solo un colchón de
    arranque: en producción real conviene setear el dedicado (ver
    config.py) para poder rotarlo sin invalidar sesiones de usuarios.
    """
    return settings.BANK_INBOUND_TOKEN_SECRET or settings.SECRET_KEY


def _issue_bank_token() -> tuple[str, int]:
    expire_seconds = settings.BANK_INBOUND_TOKEN_EXPIRE_SECONDS
    expire_at = utcnow_naive() + timedelta(seconds=expire_seconds)
    payload = {"sub": "banco_ganadero", "type": "bank_inbound", "exp": expire_at, "iat": utcnow_naive()}
    token = jwt.encode(payload, _bank_token_secret(), algorithm=BANK_JWT_ALGORITHM)
    return token, expire_seconds


def _verify_bank_token(token: str) -> None:
    try:
        payload = jwt.decode(token, _bank_token_secret(), algorithms=[BANK_JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    if payload.get("type") != "bank_inbound":
        raise HTTPException(status_code=401, detail="Token inválido")


def _extract_bank_token(
    token: str | None,
    authorization: str | None,
) -> str:
    """
    Acepta el token tanto en el header "token" (nombre literal que usa
    la spec en /login y /payments) como en "Authorization: Bearer ..."
    (mencionado aparte en la sección 8) — ver nota en el docstring del
    módulo sobre por qué no se apuesta a una sola interpretación.
    """
    if token:
        return token
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    raise HTTPException(status_code=401, detail="Falta el token de autorización")


# ── POST /api/v1/bank-integration/login ──────────────
# Sección 6 de la spec: "Autenticación en Empresa" — el banco inicia
# sesión contra MedicBolivia para obtener el token que usará en /payments.
@router.post("/login", response_model=BankLoginResponse, summary="El banco se autentica contra MedicBolivia")
async def bank_login(data: BankLoginRequest, request: Request):
    await _check_bank_login_rate_limit(request)

    if not settings.BANK_INBOUND_USERNAME or not settings.BANK_INBOUND_PASSWORD:
        # No configurado todavía — devolver un error claro en vez de un
        # 500 críptico si el banco prueba esto antes de que coordinemos
        # las credenciales que le vamos a entregar.
        raise HTTPException(
            status_code=503,
            detail="Servicio de autenticación no configurado todavía del lado de MedicBolivia",
        )

    # Comparación en tiempo constante — son credenciales que MedicBolivia
    # define y rota (no hay hash de bcrypt guardado, viven directo en el
    # .env del servidor), pero un endpoint de login público sigue
    # mereciendo el mismo cuidado que el resto de las comparaciones
    # sensibles del proyecto (ver el mismo patrón en auth.py y en el
    # webhook de pagos legado).
    if not hmac.compare_digest(data.userName, settings.BANK_INBOUND_USERNAME) or \
       not hmac.compare_digest(data.password, settings.BANK_INBOUND_PASSWORD):
        logger.warning(f"[BANK-INBOUND] Intento de login fallido con userName={data.userName}")
        return BankLoginResponse(result="COD002", message="Usuario o contraseña incorrectos", token="", expirationTime=0)

    token, expire_seconds = _issue_bank_token()
    logger.info("[BANK-INBOUND] Login del banco exitoso")
    return BankLoginResponse(result="COD000", message="Autenticación exitosa", token=token, expirationTime=expire_seconds)


# ── POST /api/v1/bank-integration/payments ────────────
# Sección 7 de la spec: "Registro de Pago de Orden de Cobro en Empresa"
# — el banco nos confirma que una orden (qrId) fue pagada. Este es el
# reemplazo real del webhook legado /consultations/webhook/payment.
@router.post("/payments", response_model=BankPaymentConfirmResponse, summary="El banco confirma el pago de una orden")
async def bank_confirm_payment(
    data: BankPaymentConfirmRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    bank_token = _extract_bank_token(token, authorization)
    _verify_bank_token(bank_token)

    payment_result = await db.execute(
        select(Payment).where(
            Payment.bank_qr_id == data.qrId,
            Payment.status == PaymentStatus.PENDING,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if not payment:
        # COD003 según la spec: "Problemas de procesamiento, vuelva a
        # intentar" — cubre tanto "no existe" como "ya estaba confirmado"
        # (este último no es realmente un error del banco, pero tampoco
        # hay un código dedicado a "duplicado" en la spec).
        logger.warning(f"[BANK-INBOUND] Pago reportado para qrId={data.qrId} sin match PENDING")
        return BankPaymentConfirmResponse(result="COD003", message="Orden no encontrada o ya procesada")

    if payment.qr_expires_at and payment.qr_expires_at < utcnow_naive():
        return BankPaymentConfirmResponse(result="COD003", message="La orden ya había expirado")

    await confirm_payment_and_activate_consultation(
        db, payment, background_tasks,
        bank_tx_id=str(data.transactionId),
        bank_name="Banco Ganadero",
    )
    logger.info(f"[BANK-INBOUND] Pago confirmado por el banco: payment={payment.id} qrId={data.qrId}")
    return BankPaymentConfirmResponse(result="COD000", message="Pago registrado correctamente")
