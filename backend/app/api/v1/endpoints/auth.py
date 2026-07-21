"""
app/api/v1/endpoints/auth.py
Endpoints de autenticación: registro, login, logout, perfil.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from datetime import datetime
from loguru import logger

from app.db.database import get_db
from app.core.config import settings
from app.core.redis_client import security_redis_client as redis_client
from app.core.security import hash_password, verify_password, create_access_token
from app.core.dependencies import get_current_user
from app.models.models import (
    User, Patient, Professional, UserRole, UserStatus,
    DoctorLead, DoctorLeadStatus, AuditLog,
)
from app.schemas.schemas import (
    PatientRegisterRequest, ProfessionalRegisterRequest,
    LoginRequest, TokenResponse, UserResponse,
    OTPSendRequest, OTPVerifyRequest,
    ForgotPasswordRequest, ResetPasswordRequest
)
from app.services.whatsapp import send_whatsapp_otp

router = APIRouter()


# ── POST /api/v1/auth/register/patient ──────────────
@router.post(
    "/register/patient",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar nuevo paciente"
)
async def register_patient(
    data: PatientRegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    # El teléfono debe haber pasado por /auth/otp/send + /auth/otp/verify
    # en los últimos 30 minutos antes de poder completar el registro.
    if not await redis_client.get(f"phone_verified:{data.phone}"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verificá tu número de WhatsApp antes de registrarte."
        )

    # Verificar si ya existe el teléfono o email
    conditions = [User.phone == data.phone]
    if data.email:
        conditions.append(User.email == data.email)

    result = await db.execute(select(User).where(or_(*conditions)))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El teléfono o email ya está registrado"
        )

    # Crear usuario + paciente en una transacción
    user = User(
        phone=data.phone,
        email=data.email,
        password_hash=hash_password(data.password),
        role=UserRole.PATIENT,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()  # Obtener el ID antes del commit

    patient = Patient(
        user_id=user.id,
        first_name=data.first_name,
        last_name=data.last_name,
        ci=data.ci,
        birth_date=datetime.strptime(data.birth_date, "%Y-%m-%d"),
        department=data.department,
        gender=data.gender,
    )
    db.add(patient)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(subject=user.id, role=user.role)
    logger.info(f"Nuevo paciente registrado: {user.id} | {data.phone}")

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user)
    )


# ── POST /api/v1/auth/register/professional ─────────
@router.post(
    "/register/professional",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar nuevo profesional de salud"
)
async def register_professional(
    data: ProfessionalRegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    # El teléfono debe haber pasado por /auth/otp/send + /auth/otp/verify
    # en los últimos 30 minutos antes de poder completar el registro.
    if not await redis_client.get(f"phone_verified:{data.phone}"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verificá tu número de WhatsApp antes de registrarte."
        )

    # Verificar si ya existe el teléfono o email (el email es opcional
    # acá — si no vino, solo chequeamos el teléfono; comparar
    # User.email == None matchearía por error a cualquier otro usuario
    # que tampoco tenga email cargado, vía IS NULL)
    conditions = [User.phone == data.phone]
    if data.email:
        conditions.append(User.email == data.email)

    result = await db.execute(select(User).where(or_(*conditions)))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El teléfono o email ya está registrado"
        )

    user = User(
        phone=data.phone,
        email=data.email,
        password_hash=hash_password(data.password),
        role=UserRole.PROFESSIONAL,
        status=UserStatus.PENDING_VERIFICATION,
    )
    db.add(user)
    await db.flush()

    professional = Professional(
        user_id=user.id,
        first_name=data.first_name,
        last_name=data.last_name,
        ci=data.ci,
        birth_date=datetime.strptime(data.birth_date, "%Y-%m-%d") if data.birth_date else None,
        department=data.department,
        gender=data.gender,
        specialty=data.specialty,
        sub_specialties=data.sub_specialties or [],
        languages=data.languages,
    )
    db.add(professional)
    await db.flush()

    # Auto-vínculo: si este mismo teléfono ya estaba cargado como
    # DoctorLead (campaña de captación del admin) y todavía no figuraba
    # como REGISTRADO, lo marcamos ahora automáticamente — así el panel
    # de admin refleja de inmediato que el prospecto ya es usuario real,
    # sin que un admin tenga que revisarlo y cambiarlo a mano.
    # register_professional() es el único lugar del backend donde se crea
    # un Professional, así que este chequeo cubre el 100% de los registros.
    lead_result = await db.execute(
        select(DoctorLead).where(
            DoctorLead.phone == data.phone,
            DoctorLead.status != DoctorLeadStatus.REGISTRADO.value,
        )
    )
    lead = lead_result.scalar_one_or_none()
    if lead:
        lead.status = DoctorLeadStatus.REGISTRADO.value
        lead.converted_professional_id = professional.id
        db.add(AuditLog(
            user_id=user.id,
            action="DOCTOR_LEAD_AUTO_CONVERTED",
            entity_type="DoctorLead",
            entity_id=lead.id,
            metadata_={"phone": data.phone, "professional_id": professional.id},
        ))
        logger.info(f"DoctorLead {lead.id} auto-vinculado a nuevo profesional {professional.id} por teléfono coincidente")

    await db.commit()
    await db.refresh(user)

    token = create_access_token(subject=user.id, role=user.role)
    logger.info(f"Nuevo profesional registrado: {user.id} | {data.specialty}")

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user)
    )


# ── POST /api/v1/auth/otp/send ───────────────────────
@router.post(
    "/otp/send",
    status_code=status.HTTP_200_OK,
    summary="Enviar código OTP por WhatsApp"
)
async def send_otp(data: OTPSendRequest):
    cooldown_key = f"otp_cooldown:{data.phone}"
    if await redis_client.get(cooldown_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Esperá {settings.OTP_RESEND_COOLDOWN_SECONDS} segundos antes de pedir otro código."
        )

    code = "".join(secrets.choice("0123456789") for _ in range(settings.OTP_LENGTH))

    sent = await send_whatsapp_otp(data.phone, code)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo enviar el código por WhatsApp. Probá de nuevo en un momento."
        )

    await redis_client.set(f"otp:{data.phone}", code, ex=settings.OTP_EXPIRE_MINUTES * 60)
    await redis_client.delete(f"otp_attempts:{data.phone}")
    await redis_client.set(cooldown_key, "1", ex=settings.OTP_RESEND_COOLDOWN_SECONDS)

    logger.info(f"OTP generado y enviado por WhatsApp a {data.phone}")
    return {
        "message": "Código enviado por WhatsApp",
        "expires_in_minutes": settings.OTP_EXPIRE_MINUTES
    }


# ── POST /api/v1/auth/otp/verify ─────────────────────
@router.post(
    "/otp/verify",
    status_code=status.HTTP_200_OK,
    summary="Verificar código OTP recibido por WhatsApp"
)
async def verify_otp(data: OTPVerifyRequest):
    attempts_key = f"otp_attempts:{data.phone}"
    attempts = await redis_client.incr(attempts_key)
    if attempts == 1:
        await redis_client.expire(attempts_key, settings.OTP_EXPIRE_MINUTES * 60)

    if attempts > settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos. Pedí un nuevo código."
        )

    stored_code = await redis_client.get(f"otp:{data.phone}")
    if not stored_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El código expiró o no fue solicitado. Pedí uno nuevo."
        )

    if stored_code != data.code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Código incorrecto")

    # Código correcto: se consume y se marca el teléfono como verificado
    # por 30 minutos, ventana en la que debe completarse el registro.
    await redis_client.delete(f"otp:{data.phone}", attempts_key)
    await redis_client.set(f"phone_verified:{data.phone}", "1", ex=30 * 60)

    logger.info(f"Teléfono verificado por WhatsApp: {data.phone}")
    return {"message": "Teléfono verificado correctamente", "verified": True}


# ── POST /api/v1/auth/password/forgot ────────────────
@router.post(
    "/password/forgot",
    status_code=status.HTTP_200_OK,
    summary="Solicitar código de WhatsApp para restablecer contraseña"
)
async def forgot_password(
    data: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    # DECISIÓN DE PRODUCTO (no la default de seguridad): este endpoint
    # revela explícitamente si el número está registrado o no, para que
    # la persona sepa de una si se equivocó de número — a costa de
    # permitir enumeración de cuentas por teléfono. Como contrapeso,
    # se limita cuántos números puede consultar una misma IP en la
    # ventana de tiempo definida en settings, para que no sea viable
    # escanear números en masa.
    client_ip = request.client.host if request.client else "unknown"
    ip_key = f"forgot_pwd_ip:{client_ip}"
    ip_attempts = await redis_client.incr(ip_key)
    if ip_attempts == 1:
        await redis_client.expire(ip_key, settings.FORGOT_PASSWORD_IP_WINDOW_MINUTES * 60)
    if ip_attempts > settings.FORGOT_PASSWORD_IP_MAX_ATTEMPTS:
        logger.warning(f"Rate limit de IP alcanzado en /password/forgot: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas solicitudes desde esta conexión. Probá de nuevo más tarde."
        )

    cooldown_key = f"otp_pwd_cooldown:{data.phone}"
    if await redis_client.get(cooldown_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Esperá {settings.OTP_RESEND_COOLDOWN_SECONDS} segundos antes de pedir otro código."
        )

    result = await db.execute(select(User).where(User.phone == data.phone))
    user = result.scalar_one_or_none()
    if not user:
        logger.info(f"Reseteo de password solicitado para teléfono no registrado: {data.phone}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese número no está registrado en MedicBolivia."
        )

    code = "".join(secrets.choice("0123456789") for _ in range(settings.OTP_LENGTH))

    sent = await send_whatsapp_otp(data.phone, code)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="No se pudo enviar el código por WhatsApp. Probá de nuevo en un momento."
        )

    await redis_client.set(f"otp_pwd:{data.phone}", code, ex=settings.OTP_EXPIRE_MINUTES * 60)
    await redis_client.delete(f"otp_pwd_attempts:{data.phone}")
    await redis_client.set(cooldown_key, "1", ex=settings.OTP_RESEND_COOLDOWN_SECONDS)

    logger.info(f"OTP de reseteo de password enviado a {data.phone}")
    return {
        "message": "Código enviado por WhatsApp",
        "expires_in_minutes": settings.OTP_EXPIRE_MINUTES
    }


# ── POST /api/v1/auth/password/reset ─────────────────
@router.post(
    "/password/reset",
    status_code=status.HTTP_200_OK,
    summary="Restablecer contraseña usando el código recibido por WhatsApp"
)
async def reset_password(
    data: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db)
):
    attempts_key = f"otp_pwd_attempts:{data.phone}"
    attempts = await redis_client.incr(attempts_key)
    if attempts == 1:
        await redis_client.expire(attempts_key, settings.OTP_EXPIRE_MINUTES * 60)

    if attempts > settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos. Pedí un nuevo código desde 'Olvidé mi contraseña'."
        )

    stored_code = await redis_client.get(f"otp_pwd:{data.phone}")
    if not stored_code or stored_code != data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código incorrecto o expirado"
        )

    result = await db.execute(select(User).where(User.phone == data.phone))
    user = result.scalar_one_or_none()
    if not user:
        # No debería ocurrir (el código solo se genera si el usuario
        # existe), pero por las dudas no distinguimos el error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código incorrecto o expirado"
        )

    user.password_hash = hash_password(data.new_password)
    await db.commit()

    # El usuario acaba de demostrar que controla el número por WhatsApp:
    # limpiamos el código y cualquier bloqueo de login previo por
    # intentos fallidos, para que pueda entrar de una con la clave nueva.
    # OJO: los JWT ya emitidos (por ej. en otro dispositivo) siguen
    # siendo válidos hasta que expiren solos (ACCESS_TOKEN_EXPIRE_MINUTES),
    # porque hoy no hay blacklist de tokens del lado del servidor — mismo
    # límite que ya existe en /auth/logout.
    await redis_client.delete(
        f"otp_pwd:{data.phone}", attempts_key,
        f"login_attempts:{data.phone}", f"login_lockout:{data.phone}"
    )

    logger.warning(f"Password restablecida vía OTP de WhatsApp: {user.id} | {data.phone}")
    return {"message": "Contraseña actualizada correctamente"}


# ── POST /api/v1/auth/login ──────────────────────────
@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Iniciar sesión"
)
async def login(
    data: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    lockout_key = f"login_lockout:{data.phone}"
    attempts_key = f"login_attempts:{data.phone}"

    if await redis_client.get(lockout_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos fallidos. Probá de nuevo en {settings.LOGIN_LOCKOUT_MINUTES} minutos."
        )

    result = await db.execute(select(User).where(User.phone == data.phone))
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        attempts = await redis_client.incr(attempts_key)
        if attempts == 1:
            await redis_client.expire(attempts_key, settings.LOGIN_LOCKOUT_MINUTES * 60)
        if attempts >= settings.LOGIN_MAX_ATTEMPTS:
            await redis_client.set(lockout_key, "1", ex=settings.LOGIN_LOCKOUT_MINUTES * 60)
            logger.warning(f"Login bloqueado por fuerza bruta: {data.phone} ({attempts} intentos)")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Teléfono o contraseña incorrectos"
        )

    if user.status == UserStatus.SUSPENDED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta suspendida. Contacte a soporte."
        )

    # Login exitoso: limpiar contador de intentos fallidos
    await redis_client.delete(attempts_key, lockout_key)

    token = create_access_token(subject=user.id, role=user.role)
    logger.info(f"Login exitoso: {user.id} | rol: {user.role}")

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user)
    )


# ── GET /api/v1/auth/me ──────────────────────────────
@router.get(
    "/me",
    response_model=UserResponse,
    summary="Obtener perfil del usuario actual"
)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# ── POST /api/v1/auth/logout ─────────────────────────
@router.post("/logout", summary="Cerrar sesión")
async def logout():
    # Con JWT stateless el logout es del lado cliente
    # En producción invalidar el token en Redis (blacklist)
    return {"message": "Sesión cerrada correctamente"}