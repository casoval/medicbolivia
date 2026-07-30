import asyncio
from decimal import Decimal
from datetime import datetime, timedelta

from app.services.bank_qr import create_collection, cancel_collection

async def main():
    try:
        print("Generando QR de prueba (Bs. 1.00, vence en 10 min)...")
        result = await create_collection(
            amount=Decimal("1.00"),
            currency="BOB",
            expiration_date=datetime.utcnow() + timedelta(minutes=10),
            reference="TESTQR001",
            gloss="Prueba integracion MedicBolivia",
        )
        print("QR GENERADO OK")
        print("qrId:", result["qr_id"])
        print("Largo de la imagen base64:", len(result["qr_image_base64"]))

        print("Anulando la orden de prueba (limpieza, no dejar abandonada)...")
        await cancel_collection(result["qr_id"])
        print("Orden anulada correctamente.")
    except Exception as e:
        print("FALLO:", type(e).__name__, "-", e)

asyncio.run(main())