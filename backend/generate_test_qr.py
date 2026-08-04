"""
generate_test_qr.py
Genera una orden de cobro REAL contra el ambiente del Banco Ganadero
(usa las credenciales BANK_QR_* del .env del servidor) y guarda la imagen
del QR como PNG, para poder mandársela al banco o escanearla vos mismo
como parte de las pruebas de certificación que piden.

No toca la base de datos ni crea ninguna Consultation/Payment — es un
llamado aislado a app.services.bank_qr.create_collection(), pensado
solo para probar la integración de punta a punta contra el banco.

Uso (en el servidor, con el venv activado y el .env real cargado):
    (venv) /var/www/medicbolivia/backend> python generate_test_qr.py
    (venv) /var/www/medicbolivia/backend> python generate_test_qr.py --amount 5 --reference PRUEBA-BANCO-01
    (venv) /var/www/medicbolivia/backend> python generate_test_qr.py --amount 1 --minutes 60 --gloss "Prueba certificacion QA"

Salida:
    - Imprime en consola el qrId que devolvió el banco (guardalo si el
      banco te pide referenciar la orden de prueba).
    - Guarda test_qr_<qrId>.png en el directorio actual con la imagen
      del QR lista para escanear o adjuntar en un correo al banco.
"""
import argparse
import asyncio
import base64
from datetime import datetime, timedelta
from decimal import Decimal

from app.core.config import settings
from app.services import bank_qr


async def main(amount: Decimal, minutes: int, reference: str, gloss: str):
    if not bank_qr.is_bank_configured():
        print("❌ Faltan credenciales del banco en el .env de este servidor.")
        print("   Se necesitan: BANK_QR_BASE_URL, BANK_QR_API_KEY, BANK_QR_USERNAME,")
        print("   BANK_QR_PASSWORD y BANK_QR_ACCOUNT_REFERENCE.")
        print(f"   BANK_QR_BASE_URL actual: {settings.BANK_QR_BASE_URL or '(vacío)'}")
        return

    expires_at = datetime.utcnow() + timedelta(minutes=minutes)
    print(f"→ Generando orden de cobro de prueba...")
    print(f"   accountReference: {settings.BANK_QR_ACCOUNT_REFERENCE}")
    print(f"   monto: Bs. {amount} | vence: {expires_at.strftime('%d/%m/%Y %H:%M')} UTC")
    print(f"   reference: {reference} | gloss: {gloss}")

    try:
        result = await bank_qr.create_collection(
            amount=amount,
            currency="BOB",
            expiration_date=expires_at,
            reference=reference,
            gloss=gloss,
        )
    except bank_qr.BankQRError as e:
        print(f"\n❌ El banco rechazó la solicitud: {e}")
        if e.result_code:
            print(f"   Código de resultado: {e.result_code}")
        return
    except Exception as e:
        print(f"\n❌ Error de red/conexión llamando al banco: {e}")
        return

    qr_id = result["qr_id"]
    image_bytes = base64.b64decode(result["qr_image_base64"])
    filename = f"test_qr_{qr_id}.png"
    with open(filename, "wb") as f:
        f.write(image_bytes)

    print(f"\n✅ QR generado correctamente.")
    print(f"   qrId (del banco): {qr_id}")
    print(f"   Imagen guardada en: {filename}")
    print(f"\n   Este qrId es el identificador que el banco va a usar para")
    print(f"   confirmarnos el pago en POST /api/v1/bank-integration/payments")
    print(f"   — si el banco pide anularlo después de la prueba, se puede con:")
    print(f"   python -c \"import asyncio; from app.services import bank_qr; "
          f"asyncio.run(bank_qr.cancel_collection('{qr_id}'))\"")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Genera un QR de prueba real contra el banco")
    parser.add_argument("--amount", type=str, default="1.00", help="Monto en Bs. (default: 1.00)")
    parser.add_argument("--minutes", type=int, default=30, help="Minutos hasta que expire (default: 30)")
    parser.add_argument("--reference", type=str, default="MEDICBOLIVIA-TEST", help="Nro. de referencia (máx 20 caracteres)")
    parser.add_argument("--gloss", type=str, default="Prueba de integracion MedicBolivia", help="Glosa (máx 60 caracteres)")
    args = parser.parse_args()

    asyncio.run(main(Decimal(args.amount), args.minutes, args.reference[:20], args.gloss[:60]))
