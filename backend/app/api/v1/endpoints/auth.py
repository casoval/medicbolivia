"""
app/api/v1/endpoints/auth.py
Endpoints de autenticación: registro, login, logout, perfil.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from datetime import datetime
from loguru import logger

from app.db.database import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.core.dependencies import get_current_user
from app.models.models import User, Patient, Professional, UserRole, UserStatus
from app.schemas.schemas import (
    PatientRegisterRequest, ProfessionalRegisterRequest,
    LoginRequest, TokenResponse, UserResponse
)

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
    result = await db.execute(
        select(User).where(
            or_(User.phone == data.phone, User.email == data.email)
        )
    )
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
        languages=data.languages,
    )
    db.add(professional)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(subject=user.id, role=user.role)
    logger.info(f"Nuevo profesional registrado: {user.id} | {data.specialty}")

    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user)
    )


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
    result = await db.execute(select(User).where(User.phone == data.phone))
    user = result.scalar_one_or_none()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Teléfono o contraseña incorrectos"
        )

    if user.status == UserStatus.SUSPENDED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta suspendida. Contacte a soporte."
        )

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