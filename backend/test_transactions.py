import asyncio
from datetime import datetime, timezone

from app.services.bank_qr import list_daily_transactions

async def main():
    hoy = datetime.now(timezone.utc)
    try:
        print(f"Consultando órdenes del día {hoy.strftime('%d/%m/%Y')}...")
        orders = await list_daily_transactions(start_date=hoy, end_date=hoy)
        print(f"OK. {len(orders)} orden(es) encontradas hoy:")
        for o in orders:
            print(f"  - qrId={o.get('qrId')} estado={o.get('orderState')} monto={o.get('amount')} {o.get('currency')} tipo={o.get('type')}")
    except Exception as e:
        print("FALLO:", type(e).__name__, "-", e)

asyncio.run(main())