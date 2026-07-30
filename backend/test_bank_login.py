import asyncio
from app.services.bank_qr import _get_token

async def main():
    try:
        token = await _get_token(force_refresh=True)
        print("LOGIN OK. Token recibido, largo:", len(token))
    except Exception as e:
        print("LOGIN FALLO:", e)

asyncio.run(main())