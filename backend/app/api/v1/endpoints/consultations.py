"""
app/api/v1/endpoints/consultations.py
Endpoints de consultas médicas.
"""
import hmac
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.models.models import (
    User, UserRole, Patient, Professional, Consultation, Payment,
    ConsultationStatus, ConsultationType, PaymentStatus, ProfessionalStatus,
    Notification, Earning, Prescription, ClinicalNote
)
from app.schemas.schemas import (
    ConsultationCreateRequest, ConsultationResponse,
    QRPaymentResponse, PaymentWebhookRequest,
    RescheduleProposeRequest, RescheduleRespondRequest,
    DisputeCreateRequest
)
from app.services.payment import generate_qr_data, calculate_amounts
from app.core.config import settings
from livekit import api as lk

router = APIRouter()

PROFESSIONAL_TIMEOUT_MINUTES_IMMEDIATE = 2     # médico tiene 2 min para aceptar una consulta inmediata
PROFESSIONAL_TIMEOUT_MINUTES_SCHEDULED = 1440  # médico tiene hasta 24h para aceptar/rechazar una cita agendada
PROFESSIONAL_RESPONSE_CUTOFF_BEFORE_APPOINTMENT_MINUTES = 30  # nunca debe responder a menos de 30 min de la cita
PAYMENT_TIMEOUT_MINUTES = 5                    # paciente tiene 5 min para pagar una consulta INMEDIATA aceptada
PAYMENT_TIMEOUT_SCHEDULED_MINUTES = 30         # paciente tiene 30 min para pagar una cita AGENDADA al crearla
SCHEDULED_BUFFER_MINUTES = 90                  # margen mínimo entre citas agendadas del paciente
VIDEO_START_GRACE_MINUTES_IMMEDIATE = 15       # tiempo desde el pago antes de habilitar el botón de cancelar (inmediata)
VIDEO_START_GRACE_MINUTES_SCHEDULED = 15       # tiempo desde la hora de la cita antes de habilitar el botón de cancelar (agendada)
NO_SHOW_PATIENT_GRACE_MINUTES_SCHEDULED = 60   # tiempo de espera antes de que el profesional pueda reportar inasistencia del paciente
RESCHEDULE_MAX_ATTEMPTS = 3                    # máximo total de propuestas de reprogramación por cita (acept. o rechaz.)


# ── Tarea background: cancelar consultas vencidas ────
async def auto_cancel_expired(consultation_id: str, db_url: str, timeout_minutes: int):
    """Cancela automáticamente si el médico no acepta a tiempo."""
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    await asyncio.sleep(timeout_minutes * 60)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        result = await db.execute(
            select(Consultation).where(Consultation.id == consultation_id)
        )
        consultation = result.scalar_one_or_none()
        if consultation and consultation.status == ConsultationStatus.WAITING_PROFESSIONAL:
            consultation.status = ConsultationStatus.CANCELLED
            consultation.outcome_note = "AUTO_TIMEOUT_PROFESSIONAL"
            await db.commit()
            logger.info(f"[AUTO-CANCEL] Consulta {consultation_id} cancelada — médico no respondió en {timeout_minutes} min")
    await engine.dispose()


async def auto_cancel_professional_timeout_with_refund(consultation_id: str, db_url: str, timeout_minutes: int):
    """
    Cancela una cita AGENDADA ya pagada si el profesional no acepta a tiempo.
    Devuelve el dinero al paciente automáticamente.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    await asyncio.sleep(timeout_minutes * 60)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
        consultation = result.scalar_one_or_none()
        if not consultation or consultation.status != ConsultationStatus.WAITING_PROFESSIONAL:
            await engine.dispose()
            return

        consultation.status = ConsultationStatus.CANCELLED
        consultation.outcome_note = "AUTO_TIMEOUT_PROFESSIONAL_PAID"

        # Devolver el pago si ya existe
        pay_result = await db.execute(
            select(Payment).where(
                Payment.consultation_id == consultation_id,
                Payment.status == PaymentStatus.CONFIRMED,
            )
        )
        payment = pay_result.scalar_one_or_none()
        if payment:
            payment.status = PaymentStatus.REFUNDED_FULL
            payment.refunded_at = datetime.utcnow()
            payment.refund_note = "Devolución automática: el profesional no respondió a tiempo."

        # Notificar al paciente
        patient_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient = patient_result.scalar_one_or_none()
        if patient:
            db.add(Notification(
                user_id=patient.user_id,
                title="Cita cancelada — devolución en camino",
                body="El profesional no confirmó tu cita a tiempo. Se procesará la devolución completa de tu pago.",
                type="AUTO_CANCELLED_REFUND",
                entity_type="Consultation",
                entity_id=consultation_id,
            ))

        await db.commit()
        logger.info(f"[AUTO-CANCEL] Cita agendada {consultation_id} cancelada con devolución — profesional no respondió en {timeout_minutes} min")
    await engine.dispose()

async def auto_release_payment_after_hold(consultation_id: str, db_url: str, hold_minutes: int):
    """
    Libera el pago al profesional automáticamente cuando pasa la ventana de
    reclamo (PAYMENT_HOLD_MINUTES) después de que una consulta termina.

    Si el paciente abrió una disputa dentro de esa ventana, payment.status ya
    no será CONFIRMED (será DISPUTED) y esta tarea no hace nada — queda a la
    espera de que un admin la resuelva manualmente.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    await asyncio.sleep(hold_minutes * 60)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        cons_result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
        consultation = cons_result.scalar_one_or_none()
        if not consultation:
            await engine.dispose()
            return

        pay_result = await db.execute(
            select(Payment).where(
                Payment.consultation_id == consultation_id,
                Payment.status == PaymentStatus.CONFIRMED,
            )
        )
        payment = pay_result.scalar_one_or_none()
        if not payment:
            # Ya fue liberado, reembolsado o está en disputa — no hacer nada.
            await engine.dispose()
            return

        await _release_payment_to_professional(db, consultation)
        await db.commit()
        logger.info(
            f"[AUTO-RELEASE] Pago de consulta {consultation_id} liberado al profesional "
            f"tras {hold_minutes} min sin reclamo del paciente"
        )
    await engine.dispose()

async def auto_cancel_payment_expired(consultation_id: str, db_url: str):
    """
    Cancela si el paciente no paga a tiempo.
    - Inmediata: 5 min (ya aceptada por el profesional).
    - Agendada: 30 min (el paciente paga al crear la cita).
    El timeout real se decide leyendo el tipo de consulta.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    # Espera mínima para leer el tipo de consulta de la BD
    await asyncio.sleep(5)

    engine_pre = create_async_engine(db_url)
    async_session_pre = sessionmaker(engine_pre, class_=AS, expire_on_commit=False)
    timeout_minutes = PAYMENT_TIMEOUT_MINUTES  # default: inmediata
    async with async_session_pre() as db_pre:
        r = await db_pre.execute(select(Consultation).where(Consultation.id == consultation_id))
        c = r.scalar_one_or_none()
        if c and c.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
            timeout_minutes = PAYMENT_TIMEOUT_SCHEDULED_MINUTES
    await engine_pre.dispose()

    # Esperar el tiempo restante (ya pasaron 5 seg)
    remaining = max(0, timeout_minutes * 60 - 5)
    await asyncio.sleep(remaining)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        result = await db.execute(
            select(Consultation).where(Consultation.id == consultation_id)
        )
        consultation = result.scalar_one_or_none()
        if consultation and consultation.status == ConsultationStatus.WAITING_PAYMENT:
            consultation.status = ConsultationStatus.CANCELLED
            consultation.outcome_note = "AUTO_TIMEOUT_PAYMENT"
            # Cancelar pago pendiente
            pay_result = await db.execute(
                select(Payment).where(
                    Payment.consultation_id == consultation_id,
                    Payment.status == PaymentStatus.PENDING
                )
            )
            payment = pay_result.scalar_one_or_none()
            if payment:
                # No hubo cobro real (el pago seguía PENDING) — no es un
                # reembolso, es una cancelación sin cobro.
                payment.status = PaymentStatus.CANCELLED_NO_CHARGE
                payment.refund_note = "No se generó cobro: el paciente no completó el pago a tiempo."
            await db.commit()
            logger.info(f"[AUTO-CANCEL] Consulta {consultation_id} cancelada — paciente no pagó en {PAYMENT_TIMEOUT_MINUTES} min")
    await engine.dispose()


# ── Tarea background: gracia de 10 min si inmediata sigue activa al inicio de cita agendada ──
async def notify_and_cancel_if_immediate_running(scheduled_consultation_id: str, db_url: str, minutes_until: float):
    """
    Se programa al confirmar el pago de una cita agendada.
    Cuando llega la hora, verifica si el paciente tiene una consulta inmediata
    activa. Si es así, da 10 min de gracia y luego cancela la agendada
    notificando al paciente y al profesional.
    """
    import asyncio
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    await asyncio.sleep(minutes_until * 60)

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        result = await db.execute(
            select(Consultation).where(Consultation.id == scheduled_consultation_id)
        )
        scheduled = result.scalar_one_or_none()
        if not scheduled or scheduled.status != ConsultationStatus.PAYMENT_CONFIRMED:
            await engine.dispose()
            return

        # Verificar si el paciente tiene una inmediata activa en este momento
        immediate_result = await db.execute(
            select(Consultation).where(
                Consultation.patient_id == scheduled.patient_id,
                Consultation.consultation_type == ConsultationType.IMMEDIATE,
                Consultation.status == ConsultationStatus.IN_PROGRESS,
            )
        )
        immediate = immediate_result.scalar_one_or_none()
        if not immediate:
            await engine.dispose()
            return

        # Hay inmediata activa → notificar y dar 10 min de gracia
        GRACE_MINUTES = 10
        logger.warning(
            f"[SCHEDULE-CONFLICT] Consulta inmediata {immediate.id} activa al inicio "
            f"de la cita agendada {scheduled_consultation_id}. Gracia: {GRACE_MINUTES} min."
        )

        # Notificar al paciente
        patient_result = await db.execute(select(Patient).where(Patient.id == scheduled.patient_id))
        patient = patient_result.scalar_one_or_none()
        if patient:
            db.add(Notification(
                user_id=patient.user_id,
                title="Cita a punto de comenzar",
                body=f"Tu cita agendada debería iniciar ahora, pero sigues en una consulta inmediata. "
                     f"Tienes {GRACE_MINUTES} minutos antes de que se cancele automáticamente.",
                type="SCHEDULE_CONFLICT_WARNING",
                entity_type="Consultation",
                entity_id=scheduled_consultation_id,
            ))

        # Notificar al profesional de la cita agendada
        if scheduled.professional_id:
            prof_result = await db.execute(select(Professional).where(Professional.id == scheduled.professional_id))
            prof = prof_result.scalar_one_or_none()
            if prof:
                db.add(Notification(
                    user_id=prof.user_id,
                    title="Paciente retrasado",
                    body=f"El paciente está en otra consulta. Se esperarán {GRACE_MINUTES} minutos antes de cancelar la cita.",
                    type="SCHEDULE_CONFLICT_WARNING",
                    entity_type="Consultation",
                    entity_id=scheduled_consultation_id,
                ))

        await db.commit()
        await engine.dispose()

        # Esperar la gracia
        await asyncio.sleep(GRACE_MINUTES * 60)

        engine2 = create_async_engine(db_url)
        async_session2 = sessionmaker(engine2, class_=AS, expire_on_commit=False)
        async with async_session2() as db2:
            result2 = await db2.execute(
                select(Consultation).where(Consultation.id == scheduled_consultation_id)
            )
            scheduled2 = result2.scalar_one_or_none()
            # Si en el tiempo de gracia el paciente terminó la inmediata y
            # ya inició la agendada, no hacemos nada.
            if scheduled2 and scheduled2.status == ConsultationStatus.PAYMENT_CONFIRMED:
                scheduled2.status = ConsultationStatus.CANCELLED
                scheduled2.outcome_note = "AUTO_CANCELLED_IMMEDIATE_CONFLICT"
                await db2.commit()
                logger.info(
                    f"[AUTO-CANCEL] Cita agendada {scheduled_consultation_id} cancelada "
                    f"— paciente no liberó la consulta inmediata a tiempo."
                )
        await engine2.dispose()


# ── POST /api/v1/consultations ───────────────────────
@router.post(
    "",
    response_model=ConsultationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear nueva consulta médica"
)
async def create_consultation(
    data: ConsultationCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.role.value != "PATIENT":
        raise HTTPException(status_code=403, detail="Solo los pacientes pueden crear consultas")

    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Perfil de paciente no encontrado")

    # ── Reglas anti-choque de horario ────────────────────────────────────────
    # Estados que se consideran "activos" (la consulta sigue viva)
    active_statuses = [
        ConsultationStatus.AGENT_TRIAGING,
        ConsultationStatus.WAITING_PROFESSIONAL,
        ConsultationStatus.PROFESSIONAL_ACCEPTED,
        ConsultationStatus.WAITING_PAYMENT,
        ConsultationStatus.PAYMENT_CONFIRMED,
        ConsultationStatus.IN_PROGRESS,
    ]
    active_result = await db.execute(
        select(Consultation).where(
            Consultation.patient_id == patient.id,
            Consultation.status.in_(active_statuses)
        )
    )
    active_consultations = active_result.scalars().all()

    IMMEDIATE_BUFFER_MINUTES = 90  # margen de seguridad antes/después de una inmediata

    if data.consultation_type == ConsultationType.IMMEDIATE:
        # Caso A: quiere una INMEDIATA → bloquear si hay cualquier consulta
        # activa que pueda chocar con "ahora".
        for existing in active_consultations:
            if existing.consultation_type == ConsultationType.IMMEDIATE:
                # Ya tiene una inmediata en curso
                raise HTTPException(
                    status_code=409,
                    detail=f"Ya tienes una consulta inmediata activa (ID: {existing.id}). Cancélala antes de crear una nueva."
                )
            if existing.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP) and existing.scheduled_at:
                minutes_to_appointment = (existing.scheduled_at - _bolivia_now()).total_seconds() / 60
                if minutes_to_appointment <= IMMEDIATE_BUFFER_MINUTES:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Tienes una cita agendada en {int(minutes_to_appointment)} minutos "
                            f"(ID: {existing.id}). No puedes iniciar una consulta inmediata "
                            f"con menos de {IMMEDIATE_BUFFER_MINUTES} minutos de anticipación."
                        )
                    )
    else:
        # Caso B: quiere una AGENDADA → bloquear si hay consulta activa
        # que solape con el horario solicitado.
        if not data.scheduled_at:
            raise HTTPException(status_code=400, detail="Debes indicar scheduled_at para una cita agendada")

        new_start = data.scheduled_at
        # Usamos duración del profesional para calcular el fin estimado
        prof_duration = timedelta(minutes=30)  # se reemplaza con el valor real más adelante

        for existing in active_consultations:
            if existing.consultation_type == ConsultationType.IMMEDIATE:
                # Una inmediata activa podría extenderse y chocar con la nueva cita
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Tienes una consulta inmediata activa (ID: {existing.id}). "
                        "Espera a que termine antes de agendar una nueva cita."
                    )
                )
            if existing.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP) and existing.scheduled_at:
                # (se usa 30 min como duración estimada hasta tener al profesional)
                # Se suma el buffer al rango de la cita existente para garantizar
                # al menos 90 min de margen entre el fin de una y el inicio de la otra.
                buffer = timedelta(minutes=SCHEDULED_BUFFER_MINUTES)
                existing_end = existing.scheduled_at + prof_duration + buffer
                new_end = new_start + prof_duration + buffer
                if new_start < existing_end and existing.scheduled_at < new_end:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"El horario solicitado ({new_start.strftime('%d/%m %H:%M')}) "
                            f"choca con una cita que ya tienes agendada "
                            f"el {existing.scheduled_at.strftime('%d/%m %H:%M')} "
                            f"(ID: {existing.id})."
                        )
                    )

    prof_result = await db.execute(
        select(Professional).where(Professional.id == data.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    if professional.status != ProfessionalStatus.APPROVED:
        raise HTTPException(status_code=400, detail="El profesional no está verificado")

    # Si es una cita AGENDADA, el paciente solo puede elegir un horario que
    # esté dentro de lo que el profesional indicó como disponible (y que no
    # esté ya ocupado por otra cita). El profesional decide igual si la
    # acepta o la rechaza — esto solo evita pedir horarios fuera de catálogo.
    # FOLLOW_UP se trata igual que SCHEDULED: también ocupa un horario real
    # del profesional y se agenda como una cita normal.
    if data.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        if not data.scheduled_at:
            raise HTTPException(status_code=400, detail="Debes indicar scheduled_at para una cita agendada")

        from app.api.v1.endpoints.professionals import compute_available_slots
        target_date = data.scheduled_at.date()
        available_slots = await compute_available_slots(db, professional, target_date)
        # Comparamos por minuto exacto, ignorando segundos/microsegundos
        requested = data.scheduled_at.replace(second=0, microsecond=0)
        valid_slots = {s.replace(second=0, microsecond=0) for s in available_slots}
        if requested not in valid_slots:
            raise HTTPException(
                status_code=400,
                detail="Ese horario ya no está disponible. Por favor elige otro de los horarios sugeridos."
            )

    if data.consultation_type == ConsultationType.FOLLOW_UP:
        # Solo se puede pedir seguimiento si el paciente ya tuvo al menos una
        # consulta COMPLETED con este mismo profesional. Se valida en el
        # backend (no solo en el frontend) para que nadie llame a la API
        # directo y pague el precio bajo de seguimiento sin haber sido
        # paciente antes.
        prior_result = await db.execute(
            select(Consultation.id).where(
                Consultation.patient_id == patient.id,
                Consultation.professional_id == professional.id,
                Consultation.status == ConsultationStatus.COMPLETED,
            ).limit(1)
        )
        if not prior_result.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="Solo puedes solicitar una consulta de seguimiento con un profesional que ya te haya atendido antes."
            )

    amount = professional.price_general
    if data.consultation_type == ConsultationType.IMMEDIATE:
        amount = professional.price_urgent
    elif data.consultation_type == ConsultationType.FOLLOW_UP:
        amount = professional.price_follow_up
    amounts = calculate_amounts(amount)

    # ── Flujo según tipo de consulta ──────────────────────────────────────────
    # INMEDIATA          : empieza en WAITING_PROFESSIONAL — el profesional acepta
    #                       primero, luego el paciente paga (flujo original, el
    #                       paciente espera en línea).
    # AGENDADA/SEGUIMIENTO: empiezan en WAITING_PAYMENT — el paciente paga primero
    #                       y el profesional confirma después. Así el paciente no
    #                       se olvida de pagar porque el profesional aceptó tarde,
    #                       y el horario queda reservado desde el momento del pago.
    initial_status = (
        ConsultationStatus.WAITING_PAYMENT
        if data.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP)
        else ConsultationStatus.WAITING_PROFESSIONAL
    )

    consultation = Consultation(
        patient_id=patient.id,
        professional_id=professional.id,
        consultation_type=data.consultation_type,
        status=initial_status,
        specialty=data.specialty or professional.specialty,
        chief_complaint=data.chief_complaint,
        scheduled_at=data.scheduled_at,
        amount=amounts["amount"],
        platform_fee=amounts["platform_fee"],
        professional_earning=amounts["professional_net"],
    )
    db.add(consultation)
    await db.flush()
    await db.commit()
    await db.refresh(consultation)

    if data.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        # El paciente tiene 30 min para pagar desde que crea la cita/seguimiento.
        # Si no paga, se cancela y el horario queda libre.
        background_tasks.add_task(
            auto_cancel_payment_expired,
            consultation.id,
            settings.DATABASE_URL,
        )
        logger.info(f"Cita/seguimiento creado: {consultation.id} → esperando pago del paciente (30 min)")
    else:
        # Inmediata: el profesional tiene 2 min para aceptar.
        background_tasks.add_task(
            auto_cancel_expired,
            consultation.id,
            settings.DATABASE_URL,
            PROFESSIONAL_TIMEOUT_MINUTES_IMMEDIATE,
        )
        logger.info(f"Consulta inmediata creada: {consultation.id} → esperando aceptación del profesional")

        # Aviso por WhatsApp al profesional: "tienes un paciente esperando".
        # Encolado en Celery (no bloquea la respuesta al paciente) — ver
        # app/tasks/reminder_tasks.py::notify_professional_patient_waiting.
        from app.tasks.reminder_tasks import notify_professional_patient_waiting
        notify_professional_patient_waiting.delay(consultation.id)

    return ConsultationResponse.model_validate(consultation)


# ── POST /api/v1/consultations/{id}/accept ──────────
@router.post(
    "/{consultation_id}/accept",
    summary="Profesional acepta la consulta → paciente puede pagar"
)
async def accept_consultation(
    consultation_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verificar que es el profesional de la consulta
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden aceptar consultas")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o ya no está en espera")

    # Si es INMEDIATA, no se puede aceptar mientras el profesional ya está
    # en otra llamada en curso — evita terminar con 2 consultas "en progreso"
    # a la vez. Para AGENDADA no aplica: aceptar una cita futura está bien
    # aunque ahora mismo esté en una llamada.
    if consultation.consultation_type == ConsultationType.IMMEDIATE:
        busy_result = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == professional.id,
                Consultation.status == ConsultationStatus.IN_PROGRESS,
            )
        )
        if busy_result.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="Estás en otra consulta en este momento. Termínala antes de aceptar una nueva."
            )

    # Si es una cita AGENDADA o de SEGUIMIENTO, verificar que no se cruce en
    # horario con otra cita agendada/seguimiento que este mismo profesional ya
    # aceptó previamente (ambas ocupan un horario real de su calendario).
    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP) and consultation.scheduled_at:
        duration = timedelta(minutes=professional.appointment_duration_minutes or 30)
        new_start = consultation.scheduled_at
        new_end = new_start + duration

        confirmed_statuses = [
            ConsultationStatus.WAITING_PAYMENT,
            ConsultationStatus.PAYMENT_CONFIRMED,
            ConsultationStatus.IN_PROGRESS,
        ]
        others_result = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == professional.id,
                Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                Consultation.id != consultation.id,
                Consultation.status.in_(confirmed_statuses),
                Consultation.scheduled_at.isnot(None),
            )
        )
        for other in others_result.scalars().all():
            other_start = other.scheduled_at
            other_end = other_start + timedelta(minutes=professional.appointment_duration_minutes or 30)
            # Para el profesional solo se verifica solapamiento real — sus citas
            # van una detrás de otra sin margen adicional.
            if new_start < other_end and other_start < new_end:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Esta cita ({new_start.strftime('%d/%m %H:%M')}) se solapa con otra "
                        f"que ya aceptaste el {other_start.strftime('%d/%m %H:%M')}. "
                        "Rechaza una de las dos antes de continuar."
                    )
                )

    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        # La cita/seguimiento ya fue pagada por el paciente — el profesional
        # solo confirma. Cambiar estado directamente a PAYMENT_CONFIRMED.
        consultation.status = ConsultationStatus.PAYMENT_CONFIRMED

        # Notificar al paciente que su cita fue confirmada
        patient_result_n = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient_n = patient_result_n.scalar_one_or_none()
        if patient_n:
            db.add(Notification(
                user_id=patient_n.user_id,
                title="¡Cita confirmada!",
                body=f"Tu cita del {consultation.scheduled_at.strftime('%d/%m/%Y a las %H:%M')} fue confirmada por el profesional.",
                type="CONSULTATION_CONFIRMED",
                entity_type="Consultation",
                entity_id=consultation.id,
            ))
    else:
        # Inmediata: flujo original, el paciente paga ahora.
        consultation.status = ConsultationStatus.WAITING_PAYMENT
        background_tasks.add_task(
            auto_cancel_payment_expired,
            consultation.id,
            settings.DATABASE_URL
        )

    await db.commit()

    logger.info(f"Consulta {consultation_id} aceptada por profesional {professional.id}")
    return {"status": "accepted", "consultation_id": consultation_id}


# ── POST /api/v1/consultations/{id}/reject ──────────
@router.post(
    "/{consultation_id}/reject",
    summary="Profesional rechaza la consulta"
)
async def reject_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden rechazar consultas")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
            Consultation.status == ConsultationStatus.WAITING_PROFESSIONAL
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    consultation.status = ConsultationStatus.CANCELLED
    consultation.outcome_note = "REJECTED_BY_PROFESSIONAL"

    # Si era una cita/seguimiento ya pagado, devolver el dinero
    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        pay_result = await db.execute(
            select(Payment).where(
                Payment.consultation_id == consultation_id,
                Payment.status == PaymentStatus.CONFIRMED,
            )
        )
        payment = pay_result.scalar_one_or_none()
        if payment:
            payment.status = PaymentStatus.REFUNDED_FULL
            payment.refunded_at = datetime.utcnow()
            payment.refund_note = "Devolución automática: el profesional no pudo atender la cita."

        # Notificar al paciente
        patient_result_r = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient_r = patient_result_r.scalar_one_or_none()
        if patient_r:
            db.add(Notification(
                user_id=patient_r.user_id,
                title="Cita no disponible — devolución en camino",
                body=f"El profesional no pudo confirmar tu cita del {consultation.scheduled_at.strftime('%d/%m/%Y a las %H:%M')}. Se procesará la devolución completa.",
                type="CONSULTATION_REJECTED_REFUND",
                entity_type="Consultation",
                entity_id=consultation.id,
            ))

    await db.commit()

    logger.info(f"Consulta {consultation_id} rechazada por profesional {professional.id}")
    return {"status": "rejected", "consultation_id": consultation_id}


# ── POST /api/v1/consultations/{id}/payment/qr ──────
@router.post(
    "/{consultation_id}/payment/qr",
    response_model=QRPaymentResponse,
    summary="Generar QR de pago (solo después de que el médico acepte)"
)
async def generate_payment_qr(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
            Consultation.status.in_([
                ConsultationStatus.WAITING_PAYMENT,
                ConsultationStatus.PAYMENT_CONFIRMED,
            ])
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o el médico aún no ha aceptado")

    prof_result = await db.execute(
        select(Professional).where(Professional.id == consultation.professional_id)
    )
    professional = prof_result.scalar_one_or_none()
    prof_name = f"Dr(a). {professional.first_name} {professional.last_name}" if professional else "Profesional"

    # Reutilizar pago pendiente si existe
    existing_payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation.id,
            Payment.status == PaymentStatus.PENDING
        )
    )
    existing_payment = existing_payment_result.scalar_one_or_none()

    # Citas agendadas y seguimientos: el paciente paga antes de que el profesional
    # acepte → 30 min de QR. Consultas inmediatas: el profesional ya aceptó → 5 min
    # (config por defecto).
    qr_expiry = (
        PAYMENT_TIMEOUT_SCHEDULED_MINUTES
        if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP)
        else None
    )

    qr_data = generate_qr_data(
        consultation_id=consultation.id,
        amount=consultation.amount,
        professional_name=prof_name,
        expiry_minutes=qr_expiry,
    )

    if existing_payment:
        # Solo regenerar si el QR ya expiró
        if existing_payment.qr_expires_at and existing_payment.qr_expires_at > datetime.utcnow():
            # QR aún válido — devolver el mismo
            return QRPaymentResponse(
                payment_id=existing_payment.id,
                qr_image_url=f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={existing_payment.qr_code}&format=png",
                amount=consultation.amount,
                expires_at=existing_payment.qr_expires_at,
                consultation_id=consultation.id,
                professional_name=prof_name
            )
        # QR expirado — regenerar
        qr_data = generate_qr_data(
            consultation_id=consultation.id,
            amount=consultation.amount,
            professional_name=prof_name,
            expiry_minutes=qr_expiry,
        )
        existing_payment.qr_code = qr_data["qr_code"]
        existing_payment.qr_expires_at = qr_data["expires_at"]
        await db.commit()
        return QRPaymentResponse(
            payment_id=existing_payment.id,
            qr_image_url=qr_data["qr_image_url"],
            amount=consultation.amount,
            expires_at=qr_data["expires_at"],
            consultation_id=consultation.id,
            professional_name=prof_name
        )

    payment = Payment(
        consultation_id=consultation.id,
        patient_id=patient.id,
        amount=consultation.amount,
        platform_fee=consultation.platform_fee,
        professional_net=consultation.professional_earning,
        qr_code=qr_data["qr_code"],
        qr_expires_at=qr_data["expires_at"],
        status=PaymentStatus.PENDING,
    )
    db.add(payment)
    await db.commit()

    return QRPaymentResponse(
        payment_id=payment.id,
        qr_image_url=qr_data["qr_image_url"],
        amount=consultation.amount,
        expires_at=qr_data["expires_at"],
        consultation_id=consultation.id,
        professional_name=prof_name
    )


# ── POST /api/v1/consultations/{id}/cancel ──────────
@router.post("/{consultation_id}/cancel", summary="Cancelar consulta (antes de que el profesional confirme)")
async def cancel_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    cancellable = [
        ConsultationStatus.WAITING_PROFESSIONAL,
        ConsultationStatus.WAITING_PAYMENT,
    ]
    if consultation.status not in cancellable:
        raise HTTPException(
            status_code=400,
            detail="No se puede cancelar una consulta ya pagada o en curso."
        )

    was_waiting_payment = consultation.status == ConsultationStatus.WAITING_PAYMENT
    consultation.status = ConsultationStatus.CANCELLED

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()
    if payment:
        # El pago seguía PENDING, nunca hubo cobro real.
        payment.status = PaymentStatus.CANCELLED_NO_CHARGE
        payment.refund_note = "No se generó cobro: el paciente canceló antes de pagar."
        consultation.outcome_note = (
            "CANCELLED_BY_PATIENT_BEFORE_PAYMENT" if was_waiting_payment else "CANCELLED_BY_PATIENT"
        )
    else:
        # No había pago PENDING — para citas agendadas/seguimiento, esto puede
        # significar que el paciente ya pagó y está en WAITING_PROFESSIONAL
        # esperando que el profesional confirme (el pago se cobra ANTES de que
        # el profesional acepte en ese flujo). Si es así, hay que reembolsar
        # el cobro real, igual que en reject_consultation / auto_cancel_professional_timeout_with_refund.
        confirmed_result = await db.execute(
            select(Payment).where(
                Payment.consultation_id == consultation_id,
                Payment.status == PaymentStatus.CONFIRMED
            )
        )
        confirmed_payment = confirmed_result.scalar_one_or_none()
        if confirmed_payment:
            confirmed_payment.status = PaymentStatus.REFUNDED_FULL
            confirmed_payment.refunded_at = datetime.utcnow()
            confirmed_payment.refund_note = "Devolución automática: el paciente canceló antes de que el profesional confirmara la cita."
            consultation.outcome_note = "CANCELLED_BY_PATIENT_WITH_REFUND"
        else:
            consultation.outcome_note = "CANCELLED_BY_PATIENT"

    await db.commit()
    logger.info(f"Consulta {consultation_id} cancelada por paciente")
    return {"status": "cancelled", "consultation_id": consultation_id}


# ── POST /api/v1/consultations/webhook/payment ──────
@router.post("/webhook/payment", summary="Webhook del banco: confirmar pago QR")
async def payment_webhook(
    data: PaymentWebhookRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
):
    # El qr_code no es secreto: el paciente lo puede leer directo de la URL
    # de la imagen del QR (qr_image_url). Sin esta verificación, cualquiera
    # que copie ese valor podría llamar este webhook y marcar su propia
    # consulta como pagada sin transferir nada.
    # TEMPORAL hasta integrar la pasarela bancaria real (que traerá su
    # propio esquema de firma) — mientras tanto, esta es la única barrera,
    # así que PAYMENT_WEBHOOK_SECRET tiene que estar configurado siempre.
    if not settings.PAYMENT_WEBHOOK_SECRET or not hmac.compare_digest(
        x_webhook_secret or "", settings.PAYMENT_WEBHOOK_SECRET
    ):
        raise HTTPException(status_code=401, detail="Firma de webhook inválida")

    payment_result = await db.execute(
        select(Payment).where(
            Payment.qr_code == data.qr_code,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()
    if not payment:
        return {"status": "not_found"}

    if payment.qr_expires_at and payment.qr_expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        return {"status": "expired"}

    payment.status = PaymentStatus.CONFIRMED
    payment.bank_tx_id = data.bank_tx_id
    payment.bank_name = data.bank_name
    payment.paid_at = datetime.utcnow()

    cons_result = await db.execute(
        select(Consultation).where(Consultation.id == payment.consultation_id)
    )
    consultation = cons_result.scalar_one_or_none()
    if consultation:
        # Citas AGENDADAS y de SEGUIMIENTO: el paciente paga primero, pero el
        # profesional todavía no confirmó. No podemos poner PAYMENT_CONFIRMED
        # aquí directo: accept_consultation/reject_consultation exigen
        # WAITING_PROFESSIONAL como estado de entrada, auto_cancel_professional_
        # timeout_with_refund solo actúa si sigue en WAITING_PROFESSIONAL, y el
        # frontend solo muestra "Aceptar cita"/"Rechazar" y el aviso "el
        # profesional tiene hasta la hora de la cita para confirmar" en ese
        # estado. Si ponemos PAYMENT_CONFIRMED aquí, todo eso queda inerte.
        if (
            consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP)
            and consultation.scheduled_at
        ):
            consultation.status = ConsultationStatus.WAITING_PROFESSIONAL

            now = datetime.utcnow()
            minutes_until = (consultation.scheduled_at - now).total_seconds() / 60

            # a) Calcular timeout dinámico para que el profesional acepte.
            #    Depende de cuándo es la cita:
            #    - < 4h  → 30 min para aceptar
            #    - 4–24h → 2h para aceptar
            #    - > 24h → hasta 12h antes de la cita
            if minutes_until < 240:          # menos de 4h
                prof_timeout = 30
            elif minutes_until < 1440:       # entre 4h y 24h
                prof_timeout = 120
            else:                            # más de 24h
                prof_timeout = max(1, minutes_until - 720)  # 12h antes

            background_tasks.add_task(
                auto_cancel_professional_timeout_with_refund,
                consultation.id,
                settings.DATABASE_URL,
                prof_timeout,
            )

            # b) Programar tarea que verifica choque con inmediata al llegar la hora.
            if minutes_until > 0:
                background_tasks.add_task(
                    notify_and_cancel_if_immediate_running,
                    consultation.id,
                    settings.DATABASE_URL,
                    minutes_until,
                )
        else:
            # Inmediata: el profesional ya aceptó antes de que el paciente pague,
            # así que el pago confirma la consulta directamente.
            consultation.status = ConsultationStatus.PAYMENT_CONFIRMED

    await db.commit()
    logger.info(f"Pago confirmado: {payment.id} | {data.bank_name} | Bs. {data.amount}")
    return {"status": "confirmed", "payment_id": payment.id}


# ── GET /api/v1/consultations/my ────────────────────
@router.get("/my", summary="Obtener mis consultas")
async def get_my_consultations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # JOIN con Professional y Patient para traer nombre/foto del profesional
    # y nombre del paciente en un solo query (se usa en dashboard e historial
    # tanto del paciente como del profesional)
    base_query = select(
        Consultation,
        Professional.first_name.label("prof_first_name"),
        Professional.last_name.label("prof_last_name"),
        Professional.photo_url.label("prof_photo_url"),
        Professional.appointment_duration_minutes.label("prof_duration_minutes"),
        Patient.first_name.label("pat_first_name"),
        Patient.last_name.label("pat_last_name"),
        Payment.status.label("pay_status"),
        Payment.paid_at.label("pay_paid_at"),
        Payment.refunded_at.label("pay_refunded_at"),
        Payment.refund_note.label("pay_refund_note"),
    ).outerjoin(
        Professional, Professional.id == Consultation.professional_id
    ).outerjoin(
        Patient, Patient.id == Consultation.patient_id
    ).outerjoin(
        Payment, Payment.consultation_id == Consultation.id
    )

    if current_user.role.value == "PATIENT":
        patient_result = await db.execute(
            select(Patient).where(Patient.user_id == current_user.id)
        )
        patient = patient_result.scalar_one_or_none()
        if not patient:
            return []
        result = await db.execute(
            base_query
            .where(Consultation.patient_id == patient.id)
            .order_by(Consultation.created_at.desc())
        )
    else:
        prof_result = await db.execute(
            select(Professional).where(Professional.user_id == current_user.id)
        )
        professional = prof_result.scalar_one_or_none()
        if not professional:
            return []
        result = await db.execute(
            base_query
            .where(Consultation.professional_id == professional.id)
            .order_by(Consultation.created_at.desc())
        )

    rows = result.all()
    responses = []
    for (consultation, prof_first_name, prof_last_name, prof_photo_url, prof_duration_minutes,
         pat_first_name, pat_last_name, pay_status, pay_paid_at,
         pay_refunded_at, pay_refund_note) in rows:
        item = ConsultationResponse.model_validate(consultation)
        item.professional_first_name = prof_first_name
        item.professional_last_name = prof_last_name
        item.professional_photo_url = prof_photo_url
        item.professional_appointment_duration_minutes = prof_duration_minutes
        item.patient_first_name = pat_first_name
        item.patient_last_name = pat_last_name
        item.payment_status = pay_status.value if pay_status else None
        item.payment_paid_at = pay_paid_at
        item.payment_refunded_at = pay_refunded_at
        item.payment_refund_note = pay_refund_note
        responses.append(item)
    return responses


# ── PATCH /api/v1/consultations/{id}/status ─────────
@router.patch("/{consultation_id}/status", summary="Actualizar estado de una consulta")
async def update_consultation_status(
    consultation_id: str,
    new_status: ConsultationStatus,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    # ── Autorización: solo el paciente o el profesional dueños de esta
    # consulta (o un admin) pueden cambiar su estado. Antes cualquier
    # usuario autenticado podía modificar consultas ajenas.
    is_owner = False
    if current_user.role == UserRole.ADMIN:
        is_owner = True
    elif current_user.role == UserRole.PATIENT:
        patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
        patient = patient_result.scalar_one_or_none()
        is_owner = bool(patient and patient.id == consultation.patient_id)
    elif current_user.role == UserRole.PROFESSIONAL:
        prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
        professional = prof_result.scalar_one_or_none()
        is_owner = bool(professional and professional.id == consultation.professional_id)

    if not is_owner:
        raise HTTPException(status_code=403, detail="No tienes permiso para modificar esta consulta")

    consultation.status = new_status
    if new_status == ConsultationStatus.IN_PROGRESS:
        consultation.started_at = datetime.utcnow()
    elif new_status == ConsultationStatus.COMPLETED:
        consultation.ended_at = datetime.utcnow()
        if consultation.started_at:
            delta = datetime.utcnow() - consultation.started_at
            consultation.duration_minutes = int(delta.total_seconds() / 60)

    await db.commit()

    response = {"status": new_status, "consultation_id": consultation_id}
    if new_status == ConsultationStatus.COMPLETED:
        # Liberación automática del pago al profesional, con ventana de
        # reclamo para el paciente (PAYMENT_HOLD_MINUTES). Si el paciente
        # abre una disputa dentro de esa ventana (payment.status pasa a
        # DISPUTED), esta tarea no libera nada y queda pendiente de un admin.
        background_tasks.add_task(
            auto_release_payment_after_hold,
            consultation.id,
            settings.DATABASE_URL,
            settings.PAYMENT_HOLD_MINUTES,
        )
        # GAP 3: avisar al frontend que puede ofrecer al médico emitir la
        # receta inmediatamente, en vez de depender de que se acuerde.
        rx_result = await db.execute(
            select(Prescription).where(Prescription.consultation_id == consultation_id)
        )
        has_prescription = rx_result.scalar_one_or_none() is not None
        response["prescription_pending"] = not has_prescription

        # GAP: mismo aviso pero para la historia clínica — si el médico
        # todavía no dejó ninguna nota SOAP para esta consulta, se lo
        # ofrecemos antes de que salga de la videollamada.
        note_result = await db.execute(
            select(ClinicalNote).where(ClinicalNote.consultation_id == consultation_id)
        )
        has_clinical_note = note_result.scalar_one_or_none() is not None
        response["clinical_note_pending"] = not has_clinical_note
    return response


# ── POST /api/v1/consultations/{id}/simulate-payment ─
@router.post("/{consultation_id}/simulate-payment", summary="[DEV] Simular pago confirmado")
async def simulate_payment(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if settings.ENVIRONMENT != "development":
        raise HTTPException(status_code=403, detail="Solo disponible en entorno de desarrollo")

    cons_result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.PENDING
        )
    )
    payment = payment_result.scalar_one_or_none()

    if payment:
        payment.status = PaymentStatus.CONFIRMED
        payment.bank_tx_id = f"SIM-{consultation_id[:8].upper()}"
        payment.bank_name = "Simulación Local"
        payment.paid_at = datetime.utcnow()
    else:
        patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
        patient = patient_result.scalar_one_or_none()
        if patient:
            db.add(Payment(
                consultation_id=consultation.id,
                patient_id=patient.id,
                amount=consultation.amount,
                platform_fee=consultation.platform_fee,
                professional_net=consultation.professional_earning,
                qr_code=f"SIM-{consultation_id[:8].upper()}",
                status=PaymentStatus.CONFIRMED,
                bank_tx_id=f"SIM-{consultation_id[:8].upper()}",
                bank_name="Simulación Local",
                paid_at=datetime.utcnow(),
            ))

    consultation.status = ConsultationStatus.PAYMENT_CONFIRMED
    await db.commit()
    logger.info(f"[DEV] Pago simulado para consulta {consultation_id}")
    return {"status": "confirmed", "message": "Pago simulado correctamente"}


# ── POST /api/v1/consultations/{id}/start-video ─────────────────────
@router.post("/{consultation_id}/start-video", summary="Médico inicia videollamada — crea sala LiveKit")
async def start_video_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verificar que es el profesional de la consulta
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden iniciar videollamadas")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.status != ConsultationStatus.PAYMENT_CONFIRMED:
        raise HTTPException(
            status_code=400,
            detail=f"La consulta debe tener pago confirmado. Estado actual: {consultation.status}"
        )

    # Para consultas INMEDIATAS: verificar que no haya una cita agendada
    # del paciente en los próximos 90 minutos.
    if consultation.consultation_type == ConsultationType.IMMEDIATE:
        patient_obj_result = await db.execute(
            select(Patient).where(Patient.id == consultation.patient_id)
        )
        patient_obj = patient_obj_result.scalar_one_or_none()
        if patient_obj:
            now = _bolivia_now()
            upcoming_result = await db.execute(
                select(Consultation).where(
                    Consultation.patient_id == patient_obj.id,
                    Consultation.id != consultation.id,
                    Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                    Consultation.status.in_([
                        ConsultationStatus.WAITING_PAYMENT,
                        ConsultationStatus.PAYMENT_CONFIRMED,
                    ]),
                    Consultation.scheduled_at.isnot(None),
                )
            )
            for upcoming in upcoming_result.scalars().all():
                minutes_to_appointment = (upcoming.scheduled_at - now).total_seconds() / 60
                if 0 < minutes_to_appointment <= 90:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Tienes una cita agendada en {int(minutes_to_appointment)} minutos "
                            f"({upcoming.scheduled_at.strftime('%H:%M')}). "
                            "No puedes iniciar una consulta inmediata que podria interferir con ella."
                        )
                    )

    # Para citas agendadas o de seguimiento: solo se puede iniciar desde la hora exacta programada
    if consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP) and consultation.scheduled_at:
        now = _bolivia_now()
        if now < consultation.scheduled_at:
            raise HTTPException(
                status_code=400,
                detail=f"La cita agendada comienza a las {consultation.scheduled_at.strftime('%H:%M')}. Aún no es la hora."
            )

    room_name = f"consulta-{consultation_id[:8]}"

    # Crear sala en LiveKit usando context manager
    async with lk.LiveKitAPI(
        url=settings.LIVEKIT_API_URL,   # <-- https://, no wss://
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    ) as lk_client:
        await lk_client.room.create_room(
            lk.CreateRoomRequest(name=room_name, empty_timeout=600, max_participants=2)
        )

    # Token para el médico
    token_prof = (
        lk.AccessToken(api_key=settings.LIVEKIT_API_KEY, api_secret=settings.LIVEKIT_API_SECRET)
        .with_identity(f"prof-{professional.id[:8]}")
        .with_name(f"Dr. {professional.first_name} {professional.last_name}")
        .with_grants(lk.VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True))
        .to_jwt()
    )

    # Token para el paciente — se guarda en video_room_url para que lo lea después
    token_patient = (
        lk.AccessToken(api_key=settings.LIVEKIT_API_KEY, api_secret=settings.LIVEKIT_API_SECRET)
        .with_identity(f"patient-{consultation.patient_id[:8]}-{consultation_id[:8]}")
        .with_name("Paciente")
        .with_grants(lk.VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True))
        .to_jwt()
    )

    # Guardar en BD y cambiar status a IN_PROGRESS
    consultation.video_room_id = room_name
    consultation.video_room_url = token_patient
    consultation.status = ConsultationStatus.IN_PROGRESS
    consultation.started_at = datetime.utcnow()
    await db.commit()

    logger.info(f"Videollamada iniciada: sala {room_name} | consulta {consultation_id}")

    return {
        "room_name": room_name,
        "livekit_url": settings.LIVEKIT_URL,
        "token": token_prof,
        "consultation_id": consultation_id,
    }


# ── GET /api/v1/consultations/{id}/video-token ───────────────────────
@router.get("/{consultation_id}/video-token", summary="Paciente obtiene su token LiveKit")
async def get_patient_video_token(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=403, detail="Solo pacientes pueden obtener el token de video")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
            Consultation.status == ConsultationStatus.IN_PROGRESS,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o no está en curso")

    # Regenerar token fresco (el guardado en BD puede haber expirado)
    token_patient = (
        lk.AccessToken(api_key=settings.LIVEKIT_API_KEY, api_secret=settings.LIVEKIT_API_SECRET)
        .with_identity(f"patient-{patient.id[:8]}-{consultation_id[:8]}")
        .with_name("Paciente")
        .with_grants(lk.VideoGrants(
            room_join=True,
            room=consultation.video_room_id,
            can_publish=True,
            can_subscribe=True
        ))
        .to_jwt()
    )

    return {
        "room_name": consultation.video_room_id,
        "livekit_url": settings.LIVEKIT_URL,
        "token": token_patient,
        "consultation_id": consultation_id,
    }


# ── GET /api/v1/consultations/{id}/rejoin-video ──────────────────────
@router.get("/{consultation_id}/rejoin-video", summary="Médico regenera su token para volver a la videollamada")
async def rejoin_video_consultation(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(
        select(Professional).where(Professional.user_id == current_user.id)
    )
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden usar este endpoint")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
            Consultation.status == ConsultationStatus.IN_PROGRESS,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada o no está en curso")

    if not consultation.video_room_id:
        raise HTTPException(status_code=400, detail="Esta consulta no tiene sala de video activa")

    # Regenerar token del médico (el token anterior puede haber expirado)
    token_prof = (
        lk.AccessToken(api_key=settings.LIVEKIT_API_KEY, api_secret=settings.LIVEKIT_API_SECRET)
        .with_identity(f"prof-{professional.id[:8]}")
        .with_name(f"Dr. {professional.first_name} {professional.last_name}")
        .with_grants(lk.VideoGrants(
            room_join=True,
            room=consultation.video_room_id,
            can_publish=True,
            can_subscribe=True
        ))
        .to_jwt()
    )

    logger.info(f"Médico reconectado: sala {consultation.video_room_id} | consulta {consultation_id}")

    return {
        "room_name": consultation.video_room_id,
        "livekit_url": settings.LIVEKIT_URL,
        "token": token_prof,
        "consultation_id": consultation_id,
    }


# ── GET /{consultation_id}/status ────────────────────
# Pensado para que la sala de espera del paciente sepa POR QUÉ se está
# atrasando, en vez de mostrar solo "esperando" sin explicación — por
# ejemplo cuando llegó la hora de una cita agendada pero el profesional
# todavía está terminando otra consulta.
@router.get("/{consultation_id}/status", summary="Estado detallado de una consulta (para sala de espera)")
async def get_consultation_status(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    # Solo el paciente dueño de la consulta puede ver su estado — hoy lo usa
    # únicamente la sala de espera del paciente. Sin esto, cualquier usuario
    # autenticado podía consultar el estado de una cita ajena si llegaba a
    # conocer su ID (los IDs son UUID, no adivinables, pero igual es un
    # control de acceso que faltaba).
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient or patient.id != consultation.patient_id:
        raise HTTPException(status_code=403, detail="No tienes acceso a esta consulta")

    professional_busy = False
    if consultation.professional_id and consultation.status in (
        ConsultationStatus.PAYMENT_CONFIRMED, ConsultationStatus.WAITING_PAYMENT
    ):
        busy_result = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == consultation.professional_id,
                Consultation.id != consultation.id,
                Consultation.status == ConsultationStatus.IN_PROGRESS,
            )
        )
        professional_busy = busy_result.scalar_one_or_none() is not None

    is_running_late = (
        professional_busy
        and consultation.consultation_type in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP)
        and consultation.scheduled_at is not None
        and consultation.scheduled_at <= datetime.now(ZoneInfo("America/La_Paz")).replace(tzinfo=None)
    )

    return {
        "consultation_id": consultation.id,
        "status": consultation.status,
        "professional_busy": professional_busy,
        "message": (
            "Tu médico está terminando otra consulta, te atenderá en breve."
            if is_running_late
            else None
        ),
    }


# ── Helper: rol del usuario actual en una consulta ───
async def _get_role_in_consultation(db: AsyncSession, current_user: User, consultation: Consultation) -> str:
    """Devuelve 'PATIENT' o 'PROFESSIONAL' según el rol del usuario actual
    en esta consulta específica, o None si no le pertenece."""
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if patient and patient.id == consultation.patient_id:
        return "PATIENT"

    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if professional and professional.id == consultation.professional_id:
        return "PROFESSIONAL"

    return None


_RESCHEDULABLE_STATUSES = [
    ConsultationStatus.WAITING_PROFESSIONAL,
    ConsultationStatus.WAITING_PAYMENT,
    ConsultationStatus.PAYMENT_CONFIRMED,
]


# ── POST /{consultation_id}/reschedule/propose ───────
@router.post(
    "/{consultation_id}/reschedule/propose",
    summary="Proponer un horario nuevo para una cita agendada"
)
async def propose_reschedule(
    consultation_id: str,
    data: RescheduleProposeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    role = await _get_role_in_consultation(db, current_user, consultation)
    if not role:
        raise HTTPException(status_code=403, detail="Esta consulta no te pertenece")

    if consultation.consultation_type not in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        raise HTTPException(status_code=400, detail="Solo las citas agendadas o de seguimiento se pueden reprogramar")
    if consultation.status not in _RESCHEDULABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Esta cita ya no se puede reprogramar en su estado actual")
    if consultation.reschedule_used:
        raise HTTPException(
            status_code=400,
            detail="Esta cita ya usó su única reprogramación permitida. A partir de aquí aplican las reglas de inasistencia."
        )
    if consultation.reschedule_attempts >= RESCHEDULE_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Ya se alcanzó el máximo de {RESCHEDULE_MAX_ATTEMPTS} propuestas de reprogramación "
                "para esta cita. No se pueden proponer más cambios de horario."
            )
        )

    new_time = data.new_scheduled_at

    # El horario propuesto —ya sea por el paciente o por el profesional—
    # no puede estar en el pasado, y debe dejar al menos un margen mínimo
    # para que ambas partes tengan tiempo de prepararse (no quedar
    # presionados por una cita en pocos minutos).
    RESCHEDULE_MIN_LEAD_MINUTES = 60
    min_allowed = _bolivia_now() + timedelta(minutes=RESCHEDULE_MIN_LEAD_MINUTES)
    if new_time < min_allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"El nuevo horario debe ser al menos {RESCHEDULE_MIN_LEAD_MINUTES} minutos "
                "después de la hora actual."
            )
        )

    professional_result = await db.execute(
        select(Professional).where(Professional.id == consultation.professional_id)
    )
    professional = professional_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=404, detail="Profesional no encontrado")

    # Verificar que el nuevo horario no choque con otra cita agendada
    # activa del mismo paciente (aplica tanto para propuesta del paciente
    # como del profesional).
    duration_check = timedelta(minutes=professional.appointment_duration_minutes or 30)
    patient_scheduled_result = await db.execute(
        select(Consultation).where(
            Consultation.patient_id == consultation.patient_id,
            Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
            Consultation.id != consultation.id,
            Consultation.status.in_([
                ConsultationStatus.WAITING_PROFESSIONAL,
                ConsultationStatus.WAITING_PAYMENT,
                ConsultationStatus.PAYMENT_CONFIRMED,
            ]),
            Consultation.scheduled_at.isnot(None),
        )
    )
    for other_pat in patient_scheduled_result.scalars().all():
        buffer_reprog = timedelta(minutes=SCHEDULED_BUFFER_MINUTES)
        other_end = other_pat.scheduled_at + duration_check + buffer_reprog
        new_end_check = new_time + duration_check + buffer_reprog
        if new_time < other_end and other_pat.scheduled_at < new_end_check:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"El horario propuesto ({new_time.strftime('%d/%m %H:%M')}) queda a menos de "
                    f"{SCHEDULED_BUFFER_MINUTES} min de otra cita que el paciente tiene "
                    f"el {other_pat.scheduled_at.strftime('%d/%m %H:%M')}."
                )
            )

    if role == "PATIENT":
        # El paciente solo puede proponer un horario dentro de lo que el
        # profesional indicó como disponible (igual que al agendar la
        # primera vez) — el profesional decide igual si acepta o no.
        from app.api.v1.endpoints.professionals import compute_available_slots
        slots = await compute_available_slots(db, professional, new_time.date())
        valid = {s.replace(second=0, microsecond=0) for s in slots}
        if new_time.replace(second=0, microsecond=0) not in valid:
            raise HTTPException(
                status_code=400,
                detail="Ese horario no está entre los disponibles del profesional. Elige otro."
            )
    else:
        # El profesional puede proponer cualquier horario, pero no uno que
        # choque con otra cita agendada que ya tiene confirmada.
        duration = timedelta(minutes=professional.appointment_duration_minutes or 30)
        new_end = new_time + duration
        others_result = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == professional.id,
                Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                Consultation.id != consultation.id,
                Consultation.status.in_([
                    ConsultationStatus.WAITING_PAYMENT,
                    ConsultationStatus.PAYMENT_CONFIRMED,
                    ConsultationStatus.IN_PROGRESS,
                ]),
                Consultation.scheduled_at.isnot(None),
            )
        )
        for other in others_result.scalars().all():
            # Para el profesional solo se verifica solapamiento real.
            other_end = other.scheduled_at + duration
            if new_time < other_end and other.scheduled_at < new_end:
                raise HTTPException(
                    status_code=409,
                    detail=f"Ese horario se solapa con otra cita que ya tienes el {other.scheduled_at.strftime('%d/%m %H:%M')}."
                )

    consultation.reschedule_proposed_at = new_time
    consultation.reschedule_proposed_by = role
    consultation.reschedule_attempts += 1
    await db.commit()

    # Notificar a la otra parte
    other_user_id = None
    if role == "PATIENT" and consultation.professional_id:
        other_user_id = professional.user_id
    elif role == "PROFESSIONAL":
        patient_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient = patient_result.scalar_one_or_none()
        if patient:
            other_user_id = patient.user_id

    if other_user_id:
        db.add(Notification(
            user_id=other_user_id,
            title="Propuesta de reprogramación",
            body=f"Te proponen cambiar tu cita al {new_time.strftime('%d/%m/%Y %H:%M')}. Revisa y responde.",
            type="RESCHEDULE_PROPOSED",
            entity_type="Consultation",
            entity_id=consultation.id,
        ))
        await db.commit()

    logger.info(f"Reprogramación propuesta: consulta {consultation_id} → {new_time} por {role}")
    return {
        "message": "Propuesta de reprogramación enviada. Espera la confirmación de la otra parte.",
        "reschedule_proposed_at": new_time,
        "reschedule_proposed_by": role,
        "attempts_used": consultation.reschedule_attempts,
        "attempts_remaining": max(0, RESCHEDULE_MAX_ATTEMPTS - consultation.reschedule_attempts),
    }


# ── POST /{consultation_id}/reschedule/respond ───────
@router.post(
    "/{consultation_id}/reschedule/respond",
    summary="Aceptar o rechazar una propuesta de reprogramación"
)
async def respond_reschedule(
    consultation_id: str,
    data: RescheduleRespondRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Consultation).where(Consultation.id == consultation_id))
    consultation = result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    role = await _get_role_in_consultation(db, current_user, consultation)
    if not role:
        raise HTTPException(status_code=403, detail="Esta consulta no te pertenece")

    if not consultation.reschedule_proposed_at or not consultation.reschedule_proposed_by:
        raise HTTPException(status_code=400, detail="No hay ninguna propuesta de reprogramación pendiente")

    # Solo la otra parte (no quien propuso) puede responder
    if role == consultation.reschedule_proposed_by:
        raise HTTPException(status_code=400, detail="Tú hiciste esta propuesta — espera la respuesta de la otra parte")

    proposed_time = consultation.reschedule_proposed_at
    proposer = consultation.reschedule_proposed_by

    if data.decision == "ACCEPT":
        # Re-validar antes de confirmar: entre que se propuso y se acepta
        # pudo haberse creado otra cita que ahora choque.
        prof_result_v = await db.execute(
            select(Professional).where(Professional.id == consultation.professional_id)
        )
        professional_v = prof_result_v.scalar_one_or_none()
        duration_v = timedelta(minutes=(professional_v.appointment_duration_minutes if professional_v else 30))
        buffer_v = timedelta(minutes=SCHEDULED_BUFFER_MINUTES)
        proposed_end = proposed_time + duration_v

        # Verificar solapamiento en agenda del PROFESIONAL (sin buffer)
        prof_conflicts = await db.execute(
            select(Consultation).where(
                Consultation.professional_id == consultation.professional_id,
                Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                Consultation.id != consultation.id,
                Consultation.status.in_([
                    ConsultationStatus.WAITING_PAYMENT,
                    ConsultationStatus.PAYMENT_CONFIRMED,
                    ConsultationStatus.IN_PROGRESS,
                ]),
                Consultation.scheduled_at.isnot(None),
            )
        )
        for c in prof_conflicts.scalars().all():
            c_end = c.scheduled_at + duration_v
            if proposed_time < c_end and c.scheduled_at < proposed_end:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"El horario propuesto ({proposed_time.strftime('%d/%m %H:%M')}) ya no está "
                        f"disponible — el profesional tiene otra cita el {c.scheduled_at.strftime('%d/%m %H:%M')}."
                    )
                )

        # Verificar margen de 90 min en agenda del PACIENTE
        pat_conflicts = await db.execute(
            select(Consultation).where(
                Consultation.patient_id == consultation.patient_id,
                Consultation.consultation_type.in_([ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP]),
                Consultation.id != consultation.id,
                Consultation.status.in_([
                    ConsultationStatus.WAITING_PROFESSIONAL,
                    ConsultationStatus.WAITING_PAYMENT,
                    ConsultationStatus.PAYMENT_CONFIRMED,
                ]),
                Consultation.scheduled_at.isnot(None),
            )
        )
        for c in pat_conflicts.scalars().all():
            c_end = c.scheduled_at + duration_v + buffer_v
            proposed_end_buf = proposed_time + duration_v + buffer_v
            if proposed_time < c_end and c.scheduled_at < proposed_end_buf:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"El horario propuesto ({proposed_time.strftime('%d/%m %H:%M')}) queda a menos de "
                        f"{SCHEDULED_BUFFER_MINUTES} min de otra cita del paciente "
                        f"el {c.scheduled_at.strftime('%d/%m %H:%M')}."
                    )
                )

        consultation.scheduled_at = proposed_time
        consultation.reschedule_proposed_at = None
        consultation.reschedule_proposed_by = None
        consultation.reschedule_used = True
        message = "Cita reprogramada correctamente. Esta cita ya no admite otra reprogramación."
    else:
        consultation.reschedule_proposed_at = None
        consultation.reschedule_proposed_by = None
        remaining = max(0, RESCHEDULE_MAX_ATTEMPTS - consultation.reschedule_attempts)
        if remaining > 0:
            message = (
                "Propuesta de reprogramación rechazada. La cita mantiene su horario original. "
                f"Quedan {remaining} propuesta(s) disponibles para esta cita."
            )
        else:
            message = (
                "Propuesta de reprogramación rechazada. La cita mantiene su horario original. "
                "Se alcanzó el máximo de propuestas — ya no se puede reprogramar de nuevo."
            )

    await db.commit()

    # Notificar a quien propuso el resultado
    notify_user_id = None
    if proposer == "PATIENT":
        patient_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
        patient = patient_result.scalar_one_or_none()
        if patient:
            notify_user_id = patient.user_id
    else:
        professional_result = await db.execute(
            select(Professional).where(Professional.id == consultation.professional_id)
        )
        professional = professional_result.scalar_one_or_none()
        if professional:
            notify_user_id = professional.user_id

    if notify_user_id:
        db.add(Notification(
            user_id=notify_user_id,
            title="Reprogramación " + ("aceptada" if data.decision == "ACCEPT" else "rechazada"),
            body=(
                f"Tu propuesta de cambiar la cita al {proposed_time.strftime('%d/%m/%Y %H:%M')} fue "
                + ("aceptada." if data.decision == "ACCEPT" else "rechazada. La cita sigue en su horario original.")
            ),
            type="RESCHEDULE_RESOLVED",
            entity_type="Consultation",
            entity_id=consultation.id,
        ))
        await db.commit()

    logger.info(f"Reprogramación {data.decision}: consulta {consultation_id} por {role}")
    return {"message": message, "scheduled_at": consultation.scheduled_at}


NO_SHOW_GRACE_MINUTES = 10   # tiempo de espera antes de poder reportar inasistencia
CANCEL_NOTICE_HOURS = 24     # aviso mínimo para cancelar con devolución


def _bolivia_now() -> datetime:
    return datetime.now(ZoneInfo("America/La_Paz")).replace(tzinfo=None)


# ── POST /{consultation_id}/cancel-with-refund ───────
# Cancelación de una cita AGENDADA y YA PAGADA, avisando con ≥24h de
# anticipación. Solo disponible si todavía no se usó la única
# reprogramación permitida — una vez usada, ya no hay marcha atrás con
# devolución; solo quedan las reglas de inasistencia.
@router.post(
    "/{consultation_id}/cancel-with-refund",
    summary="Paciente cancela una cita agendada pagada, con ≥24h de aviso (devuelve el dinero)"
)
async def cancel_scheduled_with_refund(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.consultation_type not in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        raise HTTPException(status_code=400, detail="Esta acción es solo para citas agendadas o de seguimiento")
    if consultation.status != ConsultationStatus.PAYMENT_CONFIRMED:
        raise HTTPException(status_code=400, detail="Esta cita no está pagada/confirmada")
    if consultation.reschedule_used:
        raise HTTPException(
            status_code=400,
            detail="Ya usaste tu única reprogramación para esta cita — ya no aplica la cancelación con devolución."
        )
    if not consultation.scheduled_at:
        raise HTTPException(status_code=400, detail="Esta cita no tiene horario definido")

    now = _bolivia_now()
    if consultation.scheduled_at - now < timedelta(hours=CANCEL_NOTICE_HOURS):
        raise HTTPException(
            status_code=400,
            detail=f"Solo puedes cancelar con devolución avisando al menos {CANCEL_NOTICE_HOURS}h antes. "
                   "Si ya no llegas a tiempo, puedes proponer una reprogramación en su lugar."
        )

    consultation.status = ConsultationStatus.CANCELLED
    consultation.outcome_note = "CANCELLED_24H_NOTICE"

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if payment:
        payment.status = PaymentStatus.REFUNDED_FULL
        payment.refunded_at = datetime.utcnow()
        payment.refund_note = f"Cancelada por el paciente con aviso de al menos {CANCEL_NOTICE_HOURS}h — devolución completa."

    await db.commit()
    logger.info(f"Cita agendada cancelada con devolución (aviso ≥24h): {consultation_id}")
    return {"message": "Cita cancelada y dinero devuelto.", "consultation_id": consultation_id}


async def _release_payment_to_professional(db: AsyncSession, consultation: Consultation) -> None:
    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation.id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if not payment:
        return
    payment.status = PaymentStatus.RELEASED_TO_PROFESSIONAL
    payment.released_at = datetime.utcnow()
    db.add(Earning(
        professional_id=consultation.professional_id,
        payment_id=payment.id,
        amount=consultation.professional_earning,
        released_at=datetime.utcnow(),
    ))


# ── POST /{consultation_id}/dispute ──────────────────
# El PACIENTE reporta un problema con una consulta ya terminada, dentro de
# la ventana de PAYMENT_HOLD_MINUTES tras finalizar. Esto congela el pago
# (pasa a DISPUTED) para que un admin lo resuelva — el profesional no
# decide si se le devuelve o no su propio cobro.
@router.post(
    "/{consultation_id}/dispute",
    summary="[Paciente] Reportar un problema con la consulta — congela el pago para revisión"
)
async def dispute_consultation(
    consultation_id: str,
    data: DisputeCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.status != ConsultationStatus.COMPLETED or not consultation.ended_at:
        raise HTTPException(status_code=400, detail="Solo puedes reportar un problema en una consulta ya finalizada")

    deadline = consultation.ended_at + timedelta(minutes=settings.PAYMENT_HOLD_MINUTES)
    if datetime.utcnow() > deadline:
        raise HTTPException(
            status_code=400,
            detail=f"El plazo de {settings.PAYMENT_HOLD_MINUTES} minutos para reportar un problema ya venció."
        )

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if not payment:
        raise HTTPException(
            status_code=400,
            detail="Este pago ya no está disponible para reclamo (ya fue liberado, reembolsado o está en disputa)."
        )

    payment.status = PaymentStatus.DISPUTED
    payment.dispute_category = data.category
    payment.dispute_reason = data.reason
    payment.disputed_at = datetime.utcnow()
    await db.commit()

    logger.info(f"[DISPUTA] Consulta {consultation_id} reportada por el paciente — pago {payment.id} congelado")
    return {
        "message": "Reportado. Un administrador revisará tu caso antes de liberar el pago.",
        "consultation_id": consultation_id,
    }


# ── POST /{consultation_id}/no-show/patient ──────────
# El PROFESIONAL reporta que el paciente no llegó a la cita agendada y
# pagada. Pasado el tiempo de gracia, se le paga al profesional por su
# tiempo — el paciente no avisó ni reprogramó, así que no hay devolución.
@router.post(
    "/{consultation_id}/no-show/patient",
    summary="[Profesional] Reportar que el paciente no asistió — libera el pago al profesional"
)
async def report_patient_no_show(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo el profesional puede reportar esto")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.consultation_type not in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        raise HTTPException(status_code=400, detail="Esta acción es solo para citas agendadas o de seguimiento")
    if consultation.status != ConsultationStatus.PAYMENT_CONFIRMED:
        raise HTTPException(status_code=400, detail="Esta cita no está en estado de poder reportarse")
    if not consultation.scheduled_at:
        raise HTTPException(status_code=400, detail="Esta cita no tiene horario definido")

    now = _bolivia_now()
    if now < consultation.scheduled_at + timedelta(minutes=NO_SHOW_PATIENT_GRACE_MINUTES_SCHEDULED):
        raise HTTPException(
            status_code=400,
            detail=f"Debes esperar al menos {NO_SHOW_PATIENT_GRACE_MINUTES_SCHEDULED} minutos después de la hora programada."
        )

    consultation.status = ConsultationStatus.COMPLETED
    consultation.outcome_note = "PATIENT_NO_SHOW"
    await _release_payment_to_professional(db, consultation)
    await db.commit()

    logger.info(f"Paciente no asistió: consulta {consultation_id} — pago liberado al profesional")
    return {"message": "Reportado. El pago fue liberado a tu favor.", "consultation_id": consultation_id}


# ── POST /{consultation_id}/no-show/professional ─────
# El PACIENTE reporta que el profesional no llegó. Pasado el tiempo de
# gracia, se le devuelve el dinero — el profesional no avisó ni reprogramó.
@router.post(
    "/{consultation_id}/no-show/professional",
    summary="[Paciente] Reportar que el profesional no asistió — devuelve el pago al paciente"
)
async def report_professional_no_show(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.consultation_type not in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        raise HTTPException(status_code=400, detail="Esta acción es solo para citas agendadas o de seguimiento")
    if consultation.status != ConsultationStatus.PAYMENT_CONFIRMED:
        raise HTTPException(status_code=400, detail="Esta cita no está en estado de poder reportarse")
    if not consultation.scheduled_at:
        raise HTTPException(status_code=400, detail="Esta cita no tiene horario definido")

    now = _bolivia_now()
    if now < consultation.scheduled_at + timedelta(minutes=NO_SHOW_GRACE_MINUTES):
        raise HTTPException(
            status_code=400,
            detail=f"Debes esperar al menos {NO_SHOW_GRACE_MINUTES} minutos después de la hora programada."
        )

    consultation.status = ConsultationStatus.REFUNDED
    consultation.outcome_note = "PROFESSIONAL_NO_SHOW"

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if payment:
        payment.status = PaymentStatus.REFUNDED_FULL
        payment.refunded_at = datetime.utcnow()
        payment.refund_note = "El profesional no se presentó a la cita — devolución completa al paciente."

    await db.commit()
    logger.info(f"Profesional no asistió: consulta {consultation_id} — dinero devuelto al paciente")
    return {"message": "Reportado. El dinero fue devuelto.", "consultation_id": consultation_id}

# ── POST /{consultation_id}/cancel-by-professional ─────────────────────────
# El PROFESIONAL cancela una cita agendada por percance propio — se devuelve
# el dinero al paciente. Solo disponible antes de iniciar la videollamada.
@router.post(
    "/{consultation_id}/cancel-by-professional",
    summary="[Profesional] Cancelar cita agendada por percance — devuelve el pago al paciente"
)
async def cancel_by_professional(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    prof_result = await db.execute(select(Professional).where(Professional.user_id == current_user.id))
    professional = prof_result.scalar_one_or_none()
    if not professional:
        raise HTTPException(status_code=403, detail="Solo profesionales pueden usar esta acción")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.professional_id == professional.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.consultation_type not in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        raise HTTPException(status_code=400, detail="Esta acción es solo para citas agendadas o de seguimiento")

    if consultation.status not in (
        ConsultationStatus.PAYMENT_CONFIRMED,
        ConsultationStatus.WAITING_PAYMENT,
        ConsultationStatus.PROFESSIONAL_ACCEPTED,
    ):
        raise HTTPException(
            status_code=400,
            detail="La cita ya fue iniciada o ya está cancelada — no se puede cancelar en este estado"
        )

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if payment:
        consultation.status = ConsultationStatus.REFUNDED
        consultation.outcome_note = "PROFESSIONAL_CANCELLED_WITH_REFUND"
        payment.status = PaymentStatus.REFUNDED_FULL
        payment.refunded_at = datetime.utcnow()
        payment.refunded_amount = payment.amount
        payment.refund_note = "El profesional canceló la cita por un percance — devolución completa al paciente."
    else:
        consultation.status = ConsultationStatus.CANCELLED
        consultation.outcome_note = "PROFESSIONAL_CANCELLED_NO_CHARGE"
        pending_result = await db.execute(
            select(Payment).where(
                Payment.consultation_id == consultation_id,
                Payment.status == PaymentStatus.PENDING,
            )
        )
        pending_payment = pending_result.scalar_one_or_none()
        if pending_payment:
            pending_payment.status = PaymentStatus.CANCELLED_NO_CHARGE
            pending_payment.refund_note = "No se generó cobro: el profesional canceló antes de que el paciente pagara."

    # Obtener el user_id del paciente (patient_id es el ID en tabla patients, no en users)
    patient_result = await db.execute(select(Patient).where(Patient.id == consultation.patient_id))
    patient = patient_result.scalar_one_or_none()

    if patient:
        notif = Notification(
            user_id=patient.user_id,
            title="Cita cancelada por el profesional",
            body=(
                "El profesional canceló tu cita agendada. El pago fue reembolsado."
                if payment else
                "El profesional canceló tu cita agendada. No se generó ningún cobro."
            ),
            type="PROFESSIONAL_CANCELLED",
            entity_type="Consultation",
            entity_id=consultation_id,
        )
        db.add(notif)

    await db.commit()
    if payment:
        logger.info(f"Profesional canceló la cita {consultation_id} — dinero devuelto al paciente")
        return {"message": "Cita cancelada y pago reembolsado al paciente.", "consultation_id": consultation_id}
    else:
        logger.info(f"Profesional canceló la cita {consultation_id} — no hubo cobro que devolver")
        return {"message": "Cita cancelada. No se había generado ningún cobro.", "consultation_id": consultation_id}


# ── GAP 1 — POST /{consultation_id}/cancel-no-video-immediate ──────────────
# Consulta INMEDIATA: el paciente ya pagó pero el profesional no inició la
# videollamada. No hay cancelación automática — el paciente decide cuándo
# accionar este botón, que solo se habilita pasados VIDEO_START_GRACE_MINUTES_IMMEDIATE
# desde la confirmación del pago.
@router.post(
    "/{consultation_id}/cancel-no-video-immediate",
    summary="[Paciente] Cancelar consulta inmediata pagada — el profesional no inició la videollamada"
)
async def cancel_no_video_immediate(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.consultation_type != ConsultationType.IMMEDIATE:
        raise HTTPException(status_code=400, detail="Esta acción es solo para consultas inmediatas")
    if consultation.status != ConsultationStatus.PAYMENT_CONFIRMED:
        raise HTTPException(
            status_code=400,
            detail="Esta consulta no está en estado de espera de videollamada"
        )

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if not payment or not payment.paid_at:
        raise HTTPException(status_code=400, detail="No se encontró el pago confirmado de esta consulta")

    now = _bolivia_now()
    elapsed_minutes = (now - payment.paid_at).total_seconds() / 60
    if elapsed_minutes < VIDEO_START_GRACE_MINUTES_IMMEDIATE:
        remaining = round(VIDEO_START_GRACE_MINUTES_IMMEDIATE - elapsed_minutes)
        raise HTTPException(
            status_code=400,
            detail=f"Aún puedes esperar — el profesional tiene hasta {VIDEO_START_GRACE_MINUTES_IMMEDIATE} min "
                   f"desde tu pago para iniciar la videollamada. Quedan ~{remaining} min antes de poder cancelar."
        )

    consultation.status = ConsultationStatus.CANCELLED
    consultation.outcome_note = "PATIENT_CANCELLED_NO_VIDEO_IMMEDIATE"

    payment.status = PaymentStatus.REFUNDED_FULL
    payment.refunded_at = datetime.utcnow()
    payment.refund_note = (
        f"El profesional no inició la videollamada en {VIDEO_START_GRACE_MINUTES_IMMEDIATE} min — "
        "cancelación solicitada por el paciente, devolución completa."
    )

    if consultation.professional_id:
        prof_result = await db.execute(
            select(Professional).where(Professional.id == consultation.professional_id)
        )
        professional = prof_result.scalar_one_or_none()
        if professional:
            db.add(Notification(
                user_id=professional.user_id,
                title="Consulta cancelada por el paciente",
                body="El paciente canceló la consulta inmediata porque la videollamada no se inició a tiempo.",
                type="PATIENT_CANCELLED_NO_VIDEO",
                entity_type="Consultation",
                entity_id=consultation_id,
            ))

    await db.commit()
    logger.info(f"[GAP1] Paciente canceló consulta inmediata {consultation_id} — médico no inició video, devolución completa")
    return {"message": "Consulta cancelada y dinero devuelto.", "consultation_id": consultation_id}


# ── GAP 2 — POST /{consultation_id}/cancel-no-video-scheduled ──────────────
# Consulta AGENDADA: llegó la hora de la cita y el profesional no inició la
# videollamada. No hay cancelación automática — el paciente decide cuándo
# accionar este botón, habilitado pasados VIDEO_START_GRACE_MINUTES_SCHEDULED
# desde scheduled_at.
@router.post(
    "/{consultation_id}/cancel-no-video-scheduled",
    summary="[Paciente] Cancelar cita agendada pagada — el profesional no inició la videollamada a la hora"
)
async def cancel_no_video_scheduled(
    consultation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    patient_result = await db.execute(select(Patient).where(Patient.user_id == current_user.id))
    patient = patient_result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente no encontrado")

    cons_result = await db.execute(
        select(Consultation).where(
            Consultation.id == consultation_id,
            Consultation.patient_id == patient.id,
        )
    )
    consultation = cons_result.scalar_one_or_none()
    if not consultation:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")

    if consultation.consultation_type not in (ConsultationType.SCHEDULED, ConsultationType.FOLLOW_UP):
        raise HTTPException(status_code=400, detail="Esta acción es solo para citas agendadas o de seguimiento")
    if consultation.status != ConsultationStatus.PAYMENT_CONFIRMED:
        raise HTTPException(
            status_code=400,
            detail="Esta cita no está en estado de espera de videollamada"
        )
    if not consultation.scheduled_at:
        raise HTTPException(status_code=400, detail="Esta cita no tiene horario definido")

    now = _bolivia_now()
    elapsed_minutes = (now - consultation.scheduled_at).total_seconds() / 60
    if elapsed_minutes < VIDEO_START_GRACE_MINUTES_SCHEDULED:
        remaining = round(VIDEO_START_GRACE_MINUTES_SCHEDULED - elapsed_minutes)
        if elapsed_minutes < 0:
            raise HTTPException(status_code=400, detail="Todavía no es la hora de tu cita.")
        raise HTTPException(
            status_code=400,
            detail=f"Aún puedes esperar — el profesional tiene hasta {VIDEO_START_GRACE_MINUTES_SCHEDULED} min "
                   f"desde la hora de la cita para iniciar la videollamada. Quedan ~{remaining} min antes de poder cancelar."
        )

    consultation.status = ConsultationStatus.CANCELLED
    consultation.outcome_note = "PATIENT_CANCELLED_NO_VIDEO_SCHEDULED"

    payment_result = await db.execute(
        select(Payment).where(
            Payment.consultation_id == consultation_id,
            Payment.status == PaymentStatus.CONFIRMED,
        )
    )
    payment = payment_result.scalar_one_or_none()
    if payment:
        payment.status = PaymentStatus.REFUNDED_FULL
        payment.refunded_at = datetime.utcnow()
        payment.refund_note = (
            f"El profesional no inició la videollamada en {VIDEO_START_GRACE_MINUTES_SCHEDULED} min "
            "tras la hora programada — cancelación solicitada por el paciente, devolución completa."
        )

    if consultation.professional_id:
        prof_result = await db.execute(
            select(Professional).where(Professional.id == consultation.professional_id)
        )
        professional = prof_result.scalar_one_or_none()
        if professional:
            db.add(Notification(
                user_id=professional.user_id,
                title="Cita cancelada por el paciente",
                body="El paciente canceló la cita agendada porque la videollamada no se inició a la hora.",
                type="PATIENT_CANCELLED_NO_VIDEO",
                entity_type="Consultation",
                entity_id=consultation_id,
            ))

    await db.commit()
    logger.info(f"[GAP2] Paciente canceló cita agendada {consultation_id} — médico no inició video, devolución completa")
    return {"message": "Cita cancelada y dinero devuelto.", "consultation_id": consultation_id}