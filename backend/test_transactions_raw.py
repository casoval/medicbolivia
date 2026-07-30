import asyncio
import json
from datetime import datetime, timezone

from app.services.bank_qr import list_daily_transactions

async def main():
    hoy = datetime.now(timezone.utc)
    orders = await list_daily_transactions(start_date=hoy, end_date=hoy)
    print(f"{len(orders)} orden(es). Primera orden completa (todas las claves reales):")
    if orders:
        print(json.dumps(orders[0], indent=2, ensure_ascii=False))
    print()
    print("Todas las claves presentes en la primera orden:", list(orders[0].keys()) if orders else "N/A")

asyncio.run(main())