import asyncio
from app.services.bank_qr import cancel_collection

# Los 4 qrId reales generados durante las pruebas de headers (30/07/2026)
QR_IDS_DE_PRUEBA = [
    "26073001018000002051",
    "26073001018000002052",
    "26073001018000002053",
    "26073001018000002054",
]

async def main():
    for qr_id in QR_IDS_DE_PRUEBA:
        try:
            await cancel_collection(qr_id)
            print(f"Anulado OK: {qr_id}")
        except Exception as e:
            print(f"FALLO al anular {qr_id}: {e}")

asyncio.run(main())