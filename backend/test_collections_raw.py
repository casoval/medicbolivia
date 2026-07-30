import asyncio
import httpx
from datetime import datetime, timezone, timedelta
from app.core.config import settings
from app.services.bank_qr import _get_token, _body_api_key

async def main():
    token = await _get_token(force_refresh=True)
    print("Token obtenido, largo:", len(token))

    url = f"{settings.BANK_QR_BASE_URL.rstrip('/')}/collections"
    expiration = (datetime.now(timezone.utc) + timedelta(minutes=10)).strftime("%d%m%Y")
    body = {
        "accountReference": settings.BANK_QR_ACCOUNT_REFERENCE,
        "amount": 1.00,
        "currency": "BOB",
        "expirationDate": expiration,
        "singleUse": settings.BANK_QR_SINGLE_USE,
        "userName": settings.BANK_QR_USERNAME,
        "apiKey": _body_api_key(),
        "reference": "TESTQR001",
        "gloss": "Prueba MedicBolivia",
    }
    print("URL:", url)
    print("BODY enviado (sin exponer claves):", {k: (v if k != "apiKey" else "***") for k, v in body.items()})

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            url,
            headers={"token": token, "Content-Type": "application/json"},
            json=body,
        )
    print("STATUS:", resp.status_code)
    print("HEADERS:", dict(resp.headers))
    print("BODY CRUDO:", repr(resp.text))

asyncio.run(main())