"""
Prueba de extremo a extremo del flujo INBOUND completo (servicios 6 y 7):
1. Crea un paciente, profesional, consulta y pago de prueba reales en la BD.
2. Genera una orden de cobro real contra el banco (servicio 2).
3. Hace login inbound (servicio 6) igual que lo haría el banco.
4. Llama a /bank-integration/payments (servicio 7) con ese token, igual
   que lo haría el banco al confirmar un pago real.
5. Verifica que el Payment quedó CONFIRMED y la Consultation PAYMENT_CONFIRMED.
6. Limpia todos los datos de prueba (Payment, Consultation, Professional,
   Patient, Users) para no dejar nada abandonado en producción.

NO usar en un ambiente donde CASOVAL_TEST no sea un ambiente de pruebas
del banco — este script genera una orden de cobro real (aunque en QA).
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.models import (
    User, Patient, Professional, Consultation, Payment,
    UserRole, ConsultationType, ConsultationStatus, PaymentStatus,
)
from app.services.bank_qr import create_collection

BASE_URL = "https://medicbolivia.com/api/v1"
INBOUND_USERNAME = "medicbolivia_443273"
INBOUND_PASSWORD = "8+u6XEXdvjU1k%Z1bvwePtNc2j!o"


async def main():
    suffix = uuid.uuid4().hex[:8]
    async with AsyncSessionLocal() as db:
        print("1) Creando datos de prueba (paciente, profesional, consulta, pago)...")
        patient_user = User(
            phone=f"+591700{suffix[:5]}", email=f"test_patient_{suffix}@medicbolivia.com",
            password_hash=hash_password("Test1234!"), role=UserRole.PATIENT,
        )
        prof_user = User(
            phone=f"+591701{suffix[:5]}", email=f"test_prof_{suffix}@medicbolivia.com",
            password_hash=hash_password("Test1234!"), role=UserRole.PROFESSIONAL,
        )
        db.add_all([patient_user, prof_user])
        await db.flush()

        patient = Patient(
            user_id=patient_user.id, first_name="Paciente", last_name=f"Prueba{suffix}",
            ci=f"TEST{suffix}", birth_date=datetime(1990, 1, 1), department="La Paz",
        )
        professional = Professional(
            user_id=prof_user.id, first_name="Profesional", last_name=f"Prueba{suffix}",
            ci=f"TESTP{suffix}", specialty="Medicina General",
        )
        db.add_all([patient, professional])
        await db.flush()

        consultation = Consultation(
            patient_id=patient.id, professional_id=professional.id,
            consultation_type=ConsultationType.IMMEDIATE,
            status=ConsultationStatus.WAITING_PAYMENT,
            specialty="Medicina General",
            amount=Decimal("1.00"), platform_fee=Decimal("0.15"), professional_earning=Decimal("0.85"),
        )
        db.add(consultation)
        await db.flush()

        print("2) Generando orden de cobro real contra el banco...")
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
        qr = await create_collection(
            amount=Decimal("1.00"), currency="BOB", expiration_date=expires_at,
            reference=f"E2E{suffix}", gloss="Prueba E2E inbound MedicBolivia",
        )
        print(f"   qrId real generado: {qr['qr_id']}")

        payment = Payment(
            consultation_id=consultation.id, patient_id=patient.id,
            amount=Decimal("1.00"), platform_fee=Decimal("0.15"), professional_net=Decimal("0.85"),
            bank_qr_id=qr["qr_id"], qr_code=qr["qr_id"], currency="BOB",
            qr_expires_at=expires_at.replace(tzinfo=None), status=PaymentStatus.PENDING,
        )
        db.add(payment)
        await db.commit()
        print(f"   Payment de prueba creado: {payment.id}")

        try:
            print("3) Login inbound (servicio 6, como lo haría el banco)...")
            login_resp = httpx.post(
                f"{BASE_URL}/bank-integration/login",
                json={"userName": INBOUND_USERNAME, "password": INBOUND_PASSWORD},
                timeout=15.0,
            )
            login_data = login_resp.json()
            print(f"   STATUS: {login_resp.status_code} | result: {login_data.get('result')}")
            token = login_data["token"]

            print("4) Confirmando el pago (servicio 7, como lo haría el banco)...")
            pay_resp = httpx.post(
                f"{BASE_URL}/bank-integration/payments",
                json={
                    "qrId": qr["qr_id"],
                    "transactionId": 999999,
                    "payDate": datetime.now(timezone.utc).strftime("%d%m%Y"),
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=15.0,
            )
            pay_data = pay_resp.json()
            print(f"   STATUS: {pay_resp.status_code} | BODY: {pay_data}")

            print("5) Verificando que se haya activado correctamente en la BD...")
            await db.refresh(payment)
            await db.refresh(consultation)
            print(f"   Payment.status = {payment.status}")
            print(f"   Consultation.status = {consultation.status}")

            if payment.status == PaymentStatus.CONFIRMED and consultation.status == ConsultationStatus.PAYMENT_CONFIRMED:
                print("\n✅ PRUEBA END-TO-END EXITOSA: el flujo inbound completo funciona.")
            else:
                print("\n❌ La respuesta HTTP fue OK pero el estado en BD no es el esperado — revisar.")

        finally:
            print("\n6) Limpiando datos de prueba...")
            await db.delete(payment)
            await db.delete(consultation)
            await db.delete(professional)
            await db.delete(patient)
            await db.delete(patient_user)
            await db.delete(prof_user)
            await db.commit()
            print("   Datos de prueba eliminados de la base de datos.")
            print(f"   Nota: la orden {qr['qr_id']} queda registrada como PAGADA en el banco (QA, sin dinero real).")

asyncio.run(main())
