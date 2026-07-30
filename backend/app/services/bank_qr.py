"""
app/services/bank_qr.py
Cliente del API real de Banco Ganadero — "Cobros & Pagos con QR" v1.7.

Cubre los 4 servicios que MedicBolivia consume del banco:
  1. POST /enterprise/service/v1/qrcode/access         -> login, token
  2. POST /enterprise/service/v1/qrcode/collections     -> generar QR
  3. POST /enterprise/service/v1/qrcode/cancellations   -> anular QR
  4. POST /enterprise/service/v1/qrcode/transactions    -> lista diaria

Todo lo que expone el banco para que MedicBolivia lo llame vive acá. Lo
inverso (los endpoints que el banco llama a MedicBolivia — /login y
/payments) vive en app.api.v1.endpoints.bank_qr_inbound, porque son
servidor, no cliente.

FALLBACK: mientras no estén los 4 datos bloqueantes en el .env
(BANK_QR_BASE_URL, BANK_QR_API_KEY, BANK_QR_USERNAME/PASSWORD,
BANK_QR_ACCOUNT_REFERENCE), is_bank_configured() devuelve False y
consultations.py sigue usando el QR simulado de siempre — no hay que
tocar nada más para que el sistema arranque sin credenciales reales.
"""
import base64
import uuid
import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

import httpx
from loguru import logger

from app.core.config import settings
from app.core.redis_client import redis_client

BANK_TOKEN_REDIS_KEY = "bank_qr:access_token"


class BankQRError(Exception):
    """Error al hablar con el API del banco (timeout, result != COD000, etc.)."""
    def __init__(self, message: str, result_code: str | None = None):
        super().__init__(message)
        self.result_code = result_code


def is_bank_configured() -> bool:
    """
    True solo si están los 4 datos bloqueantes (ver informe de
    integración, sección 3). Si falta cualquiera, no tiene sentido ni
    intentar la llamada real — mejor caer directo al simulado.
    """
    return bool(
        settings.BANK_QR_BASE_URL
        and settings.BANK_QR_API_KEY
        and settings.BANK_QR_USERNAME
        and settings.BANK_QR_PASSWORD
        and settings.BANK_QR_ACCOUNT_REFERENCE
    )


def _body_api_key() -> str:
    """
    El campo `apiKey` del body (distinto del header `x-Api-Key`, según la
    spec) — probablemente la misma clave, pero si el banco confirma que
    es distinta, se define BANK_QR_BODY_API_KEY aparte en el .env.
    """
    return settings.BANK_QR_BODY_API_KEY or settings.BANK_QR_API_KEY


def _jwt_ttl_seconds(token: str, fallback: int = 240) -> int:
    """
    Lee exp/iat directo del payload del JWT que emite el banco, sin
    validar firma (no tenemos su clave pública/secreta — solo nos
    interesa el campo exp para saber cuánto cachear). Confirmado en
    pruebas reales contra el ambiente QA (30/07/2026): el banco emite
    tokens de 300s (5 min) — la spec PDF no dice nada sobre esto, así
    que más vale leerlo del token real que asumir un número fijo.
    Si el token no trae exp/iat por algún motivo, cae a `fallback`
    (con margen de sobra por debajo de los 300s observados).
    """
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        ttl = int(payload["exp"]) - int(payload["iat"])
        return max(ttl, 30)
    except Exception:
        return fallback


async def _get_token(force_refresh: bool = False) -> str:
    """
    Devuelve un token válido de /qrcode/access, cacheado en Redis para no
    loguearse en cada llamada. El TTL de caché se calcula a partir del
    propio token del banco (ver _jwt_ttl_seconds) menos un margen de
    seguridad (BANK_QR_TOKEN_CACHE_MARGIN_SECONDS), para no arriesgarse
    a usar un token ya vencido — el banco emite tokens de vida corta
    (300s observados en pruebas), no de 400 caracteres "eternos".
    """
    if not force_refresh:
        cached = await redis_client.get(BANK_TOKEN_REDIS_KEY)
        if cached:
            return cached

    url = f"{settings.BANK_QR_BASE_URL.rstrip('/')}/access"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            url,
            headers={"x-Api-Key": settings.BANK_QR_API_KEY, "Content-Type": "application/json"},
            json={"userName": settings.BANK_QR_USERNAME, "password": settings.BANK_QR_PASSWORD},
        )
    data = resp.json()
    if resp.status_code >= 400 or data.get("result") != "COD000":
        raise BankQRError(
            f"Login banco falló: {data.get('message', resp.text)}",
            result_code=data.get("result"),
        )
    token = data["token"]
    # TTL = duración real del token (leída de su propio exp/iat) menos un
    # margen de seguridad — evita servir desde caché un token que ya
    # venció del lado del banco. Confirmado en pruebas reales: el banco
    # emite tokens de 300s; con margen de 30s, cacheamos 270s.
    ttl = _jwt_ttl_seconds(token) - settings.BANK_QR_TOKEN_CACHE_MARGIN_SECONDS
    await redis_client.set(BANK_TOKEN_REDIS_KEY, token, ex=max(ttl, 30))
    return token


async def _post_with_token(resource: str, body: dict) -> dict:
    """
    POST autenticado contra el banco. `resource` es solo el nombre final
    (ej. "collections", "cancellations", "transactions") — se concatena
    directo a BANK_QR_BASE_URL, que ya trae el prefijo real completo del
    ambiente (ej. ".../ws-servicio-codigo-qr-empresas/service/v1/qrcode").
    Si el token cacheado ya no sirve (COD distinto de COD000 por motivo
    de auth), se refresca una vez y se reintenta — el banco no
    documenta un código específico para "token expirado", así que
    cualquier error en el primer intento dispara un refresh + reintento
    único antes de rendirse.
    """
    token = await _get_token()
    url = f"{settings.BANK_QR_BASE_URL.rstrip('/')}/{resource.lstrip('/')}"

    async def _call(tok: str) -> httpx.Response:
        async with httpx.AsyncClient(timeout=15.0) as client:
            return await client.post(
                url,
                headers={"token": tok, "Content-Type": "application/json"},
                json=body,
            )

    resp = await _call(token)
    data = resp.json()
    if resp.status_code >= 400 or data.get("result") not in (None, "COD000"):
        # Reintento único con token refrescado por si el problema fue auth.
        token = await _get_token(force_refresh=True)
        resp = await _call(token)
        data = resp.json()

    if resp.status_code >= 400 or (data.get("result") and data.get("result") != "COD000"):
        raise BankQRError(
            f"Llamada a {resource} falló: {data.get('message', resp.text)}",
            result_code=data.get("result"),
        )
    return data


def validate_amount_within_smn_cap(amount: Decimal) -> None:
    """
    La spec exige que ninguna orden supere 5x el SMN vigente (sección 3
    de /qrcode/collections). Se valida ANTES de llamar al banco para
    devolver un error claro al paciente en vez de un rechazo genérico
    del lado del banco.
    """
    cap = Decimal(str(settings.SMN_BOLIVIA)) * 5
    if amount > cap:
        raise BankQRError(
            f"El monto (Bs. {amount}) supera el máximo permitido por el banco "
            f"(5x SMN = Bs. {cap})."
        )


async def create_collection(
    *,
    amount: Decimal,
    currency: str,
    expiration_date: datetime,
    reference: str | None = None,
    transaction_id: str | None = None,
    gloss: str | None = None,
) -> dict:
    """
    Genera una orden de cobro real (POST /qrcode/collections).
    Devuelve {"qr_id": str, "qr_image_base64": str}.
    expiration_date se formatea acá mismo a ddmmyyyy, como pide la spec.
    """
    validate_amount_within_smn_cap(amount)
    body = {
        "accountReference": settings.BANK_QR_ACCOUNT_REFERENCE,
        "amount": float(amount.quantize(Decimal("0.01"))),
        "currency": currency,
        "expirationDate": expiration_date.strftime("%d%m%Y"),
        "singleUse": settings.BANK_QR_SINGLE_USE,
        "userName": settings.BANK_QR_USERNAME,
        "apiKey": _body_api_key(),
    }
    if reference:
        body["reference"] = reference[:20]
    if transaction_id:
        body["transactionId"] = transaction_id
    if gloss:
        body["gloss"] = gloss[:60]

    data = await _post_with_token("collections", body)
    return {"qr_id": data["qrId"], "qr_image_base64": data["qrImage"]}


async def cancel_collection(qr_id: str) -> None:
    """
    Anula una orden de cobro (POST /qrcode/cancellations). Es
    "best-effort" a propósito por diseño: si el banco no responde o el
    QR ya no existe de su lado, no debe bloquear la cancelación local en
    MedicBolivia — solo se loguea el fallo (ver los 3 call sites en
    consultations.py que la usan dentro de try/except).
    """
    body = {
        "qrId": qr_id,
        "userName": settings.BANK_QR_USERNAME,
        "apiKey": _body_api_key(),
    }
    await _post_with_token("cancellations", body)


async def list_daily_transactions(start_date: datetime, end_date: datetime) -> list[dict]:
    """
    Consulta el resumen diario (POST /qrcode/transactions) — usado para
    reconciliación si algún aviso de pago del banco no llegara por el
    endpoint inbound /bank-integration/payments.
    """
    body = {
        "userName": settings.BANK_QR_USERNAME,
        "startDate": start_date.strftime("%d%m%Y"),
        "endDate": end_date.strftime("%d%m%Y"),
        "apiKey": _body_api_key(),
    }
    data = await _post_with_token("transactions", body)
    return data.get("orders", [])


async def generate_qr_or_fallback(
    *,
    consultation_id: str,
    amount: Decimal,
    professional_name: str,
    expires_at: datetime,
    reference: str | None = None,
) -> dict:
    """
    Punto único que usa consultations.py para generar el QR. Si el banco
    está configurado, llama al API real y devuelve la imagen en
    data:image/png;base64; si no (o si la llamada falla), cae al
    simulado de siempre — así el sistema nunca se cae por falta de
    credenciales o por una caída puntual del banco.

    Devuelve dict compatible con lo que ya esperaba generate_qr_data():
    qr_code, qr_image_url, tx_id, expires_at, amount, bank_qr_id (None si
    es simulado), currency.
    """
    tx_id = str(uuid.uuid4()).replace("-", "")[:16].upper()
    currency = "BOB"

    if is_bank_configured():
        try:
            result = await create_collection(
                amount=amount,
                currency=currency,
                expiration_date=expires_at,
                reference=reference or consultation_id[:20],
                gloss=f"MedicBolivia - {professional_name}"[:60],
            )
            qr_image_url = f"data:image/png;base64,{result['qr_image_base64']}"
            return {
                "qr_code": result["qr_id"],
                "qr_image_url": qr_image_url,
                "tx_id": tx_id,
                "expires_at": expires_at,
                "amount": amount,
                "bank_qr_id": result["qr_id"],
                "currency": currency,
            }
        except Exception as exc:
            logger.error(f"[BANK-QR] Falló generación real, cae a simulado: {exc}")

    # ── Fallback: QR simulado (comportamiento original) ─────────────
    qr_content = f"MEDICBOLIVIA|{consultation_id}|{amount}|{tx_id}|{expires_at.isoformat()}"
    qr_image_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={qr_content}&format=png"
    return {
        "qr_code": qr_content,
        "qr_image_url": qr_image_url,
        "tx_id": tx_id,
        "expires_at": expires_at,
        "amount": amount,
        "bank_qr_id": None,
        "currency": currency,
    }


async def cancel_qr_best_effort(bank_qr_id: Optional[str]) -> None:
    """
    Wrapper best-effort para los 3 call sites de cancelación en
    consultations.py. No hace nada si el pago era simulado (bank_qr_id
    None) o si el banco no está configurado.
    """
    if not bank_qr_id or not is_bank_configured():
        return
    try:
        await cancel_collection(bank_qr_id)
    except Exception as exc:
        logger.error(f"[BANK-QR] No se pudo anular qrId={bank_qr_id} en el banco: {exc}")