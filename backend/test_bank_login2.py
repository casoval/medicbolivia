import asyncio
import httpx
from app.core.config import settings

async def main():
    url = f"{settings.BANK_QR_BASE_URL.rstrip('/')}/access"
    print("URL:", url)
    print("Intentando conectar (timeout 20s)...")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                url,
                headers={"x-Api-Key": settings.BANK_QR_API_KEY, "Content-Type": "application/json"},
                json={"userName": settings.BANK_QR_USERNAME, "password": settings.BANK_QR_PASSWORD},
            )
        print("STATUS:", resp.status_code)
        print("BODY:", resp.text[:500])
    except Exception as e:
        print("TIPO DE ERROR:", type(e).__name__)
        print("REPR:", repr(e))
        if e.__cause__:
            print("CAUSA:", type(e.__cause__).__name__, repr(e.__cause__))

asyncio.run(main())