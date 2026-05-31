"""
app/api/v1/endpoints/agent.py
Endpoints del agente IA: chat, onboarding, historial.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.models.models import User, Patient, Professional, ProfessionalStatus, AvailabilityMode
from app.schemas.schemas import AgentChatRequest, AgentChatResponse, ProfessionalPublicResponse
from app.agents.coordinator import (
    run_coordinator, run_onboarding, get_conversation_history
)

router = APIRouter()


# ── POST /api/v1/agent/chat ──────────────────────────
@router.post(
    "/chat",
    response_model=AgentChatResponse,
    summary="Chatear con el agente coordinador IA"
)
async def agent_chat(
    data: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    session_id = data.session_id or str(uuid.uuid4())

    # Construir contexto del paciente
    patient_context = None
    if current_user.role == "PATIENT":
        result = await db.execute(
            select(Patient).where(Patient.user_id == current_user.id)
        )
        patient = result.scalar_one_or_none()
        if patient:
            patient_context = {
                "nombre": f"{patient.first_name} {patient.last_name}",
                "alergias": patient.allergies,
                "condiciones_cronicas": patient.chronic_conditions,
                "medicacion_actual": patient.current_medications,
            }

    # Ejecutar agente coordinador
    result = await run_coordinator(
        session_id=session_id,
        user_id=current_user.id,
        message=data.message,
        patient_context=patient_context,
        db=db
    )

    # Si el agente pide buscar profesionales, hacerlo automáticamente
    available_professionals = None
    if result.get("action") and result["action"].get("type") == "SEARCH_PROFESSIONALS":
        specialty = result["action"].get("param", "")
        prof_result = await db.execute(
            select(Professional).where(
                Professional.status == ProfessionalStatus.APPROVED,
                Professional.availability == AvailabilityMode.ONLINE_NOW,
            )
        )
        all_profs = prof_result.scalars().all()

        # Filtrar por especialidad si se especificó
        if specialty:
            from sqlalchemy import func
            prof_result2 = await db.execute(
                select(Professional).where(
                    Professional.status == ProfessionalStatus.APPROVED,
                    Professional.availability == AvailabilityMode.ONLINE_NOW,
                    func.lower(Professional.specialty).contains(specialty.lower())
                )
            )
            filtered = prof_result2.scalars().all()
            if filtered:
                all_profs = filtered

        available_professionals = [
            ProfessionalPublicResponse.model_validate(p) for p in all_profs[:5]
        ]

    return AgentChatResponse(
        session_id=session_id,
        message=result["message"],
        action=result.get("action"),
        available_professionals=available_professionals,
    )


# ── POST /api/v1/agent/onboarding ───────────────────
@router.post(
    "/onboarding",
    response_model=AgentChatResponse,
    summary="Agente de onboarding para nuevos usuarios"
)
async def agent_onboarding(
    data: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Si ya completó el onboarding, no hacer nada
    if current_user.onboarding_completed:
        return AgentChatResponse(
            session_id=data.session_id or str(uuid.uuid4()),
            message="¡Ya completaste tu registro inicial! Puedes usar la plataforma con normalidad.",
        )

    session_id = data.session_id or f"onboarding-{current_user.id}"

    result = await run_onboarding(
        session_id=session_id,
        user_id=current_user.id,
        user_role=current_user.role.value,
        message=data.message,
        db=db
    )

    return AgentChatResponse(
        session_id=session_id,
        message=result["message"],
        action=result.get("action"),
        onboarding_completed=result.get("onboarding_completed", False),
    )


# ── GET /api/v1/agent/history/{session_id} ──────────
@router.get(
    "/history/{session_id}",
    summary="Obtener historial de conversación de una sesión"
)
async def get_history(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    history = get_conversation_history(session_id)
    return {"session_id": session_id, "messages": history, "count": len(history)}
