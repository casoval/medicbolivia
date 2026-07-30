import asyncio
from app.services.bank_qr import _get_token, BANK_TOKEN_REDIS_KEY
from app.core.redis_client import redis_client

async def main():
    await redis_client.delete(BANK_TOKEN_REDIS_KEY)
    await _get_token(force_refresh=True)
    ttl = await redis_client.ttl(BANK_TOKEN_REDIS_KEY)
    print("TTL guardado en Redis (segundos):", ttl)

asyncio.run(main())