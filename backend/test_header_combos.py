import asyncio
import httpx
from datetime import datetime, timezone, timedelta
from app.core.config import settings
from app.services.bank_qr import _get_token, _body_api_key

async def try_combo(client, url, headers, body, label):
    resp = await client.post(url, headers=headers, json=body)
    print(f"--- {label} ---")
    print("STATUS:", resp.status_code)
    print("BODY:", repr(resp.text[:300]))
    print()

async def main():
    token = await _get_token(force_refresh=True)
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
        "reference": "TESTQR002",
        "gloss": "Prueba MedicBolivia",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        await try_combo(client, url, {"token": token, "Content-Type": "application/json"}, body, "1) header 'token' (como antes)")
        await try_combo(client, url, {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, body, "2) Authorization: Bearer")
        await try_combo(client, url, {"Authorization": f"Bearer {token}", "token": token, "Content-Type": "application/json"}, body, "3) Ambos headers juntos")
        await try_combo(client, url, {"Authorization": f"Bearer {token}", "x-Api-Key": settings.BANK_QR_API_KEY, "Content-Type": "application/json"}, body, "4) Bearer + x-Api-Key")
        await try_combo(client, url, {"token": token, "x-Api-Key": settings.BANK_QR_API_KEY, "Content-Type": "application/json"}, body, "5) token + x-Api-Key")

asyncio.run(main())