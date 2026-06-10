"""
app/api/v1/endpoints/agent.py
Endpoints del agente IA: chat, onboarding, historial, TTS, voice-chat.
"""
import uuid
import base64
import httpx
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.core.config import settings
from app.models.models import User, Patient, Professional, ProfessionalStatus, AvailabilityMode
from app.schemas.schemas import AgentChatRequest, AgentChatResponse, ProfessionalPublicResponse
from app.agents.coordinator import (
    run_coordinator, run_onboarding, get_conversation_history
)

router = APIRouter()


async def _get_patient_context(db: AsyncSession, user_id: str) -> dict | None:
    result = await db.execute(select(Patient).where(Patient.user_id == user_id))
    patient = result.scalar_one_or_none()
    if not patient:
        return None
    return {
        "nombre": f"{patient.first_name} {patient.last_name}",
        "alergias": patient.allergies,
        "condiciones_cronicas": patient.chronic_conditions,
        "medicacion_actual": patient.current_medications,
    }


async def _search_professionals(db: AsyncSession, specialty: str) -> list:
    query = select(Professional).where(
        Professional.status == ProfessionalStatus.APPROVED,
        Professional.availability == AvailabilityMode.ONLINE_NOW,
    )
    if specialty:
        query = query.where(
            func.lower(Professional.specialty).contains(specialty.lower())
        )
    result = await db.execute(query)
    profs = result.scalars().all()

    if not profs and specialty:
        result2 = await db.execute(
            select(Professional).where(
                Professional.status == ProfessionalStatus.APPROVED,
                Professional.availability == AvailabilityMode.ONLINE_NOW,
            )
        )
        profs = result2.scalars().all()

    return [ProfessionalPublicResponse.model_validate(p) for p in profs[:5]]


async def _text_to_speech(text: str) -> str | None:
    """
    Convierte texto a audio usando Google Cloud TTS Neural2.
    Retorna el audio en base64 o None si falla.
    """
    if not settings.GOOGLE_TTS_API_KEY:
        return None

    # Limpiar texto — quitar emojis y caracteres especiales para TTS
    import re
    clean_text = re.sub(r'[^\w\s\.,;:!?¡¿áéíóúüñÁÉÍÓÚÜÑ\-]', '', text)
    clean_text = clean_text.strip()
    if not clean_text:
        return None

    # Limitar a 5000 caracteres para evitar costos
    if len(clean_text) > 5000:
        clean_text = clean_text[:5000]

    url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={settings.GOOGLE_TTS_API_KEY}"

    payload = {
        "input": {"text": clean_text},
        "voice": {
            "languageCode": settings.GOOGLE_TTS_LANGUAGE,
            "name": settings.GOOGLE_TTS_VOICE,
            "ssmlGender": "MALE"
        },
        "audioConfig": {
            "audioEncoding": "MP3",
            "speakingRate": 1.0,
            "pitch": 0.0,
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200:
                data = response.json()
                return data.get("audioContent")  # ya viene en base64
            else:
                logger.warning(f"Google TTS error {response.status_code}: {response.text}")
                return None
    except Exception as e:
        logger.error(f"Google TTS exception: {e}")
        return None


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

    patient_context = None
    if current_user.role == "PATIENT":
        patient_context = await _get_patient_context(db, current_user.id)

    result = await run_coordinator(
        session_id=session_id,
        user_id=current_user.id,
        message=data.message,
        patient_context=patient_context,
        db=db
    )

    available_professionals = None

    if result.get("action") and result["action"].get("type") == "SEARCH_PROFESSIONALS":
        specialty = result["action"].get("param", "")
        available_professionals = await _search_professionals(db, specialty)

        if available_professionals:
            profs_data = [
                {
                    "id": p.id,
                    "nombre": f"{p.first_name} {p.last_name}",
                    "especialidad": p.specialty,
                    "precio_general": p.price_general,
                    "experiencia_años": p.years_experience,
                    "calificacion": p.average_rating,
                }
                for p in available_professionals
            ]
            followup_message = (
                f"[SISTEMA] Se encontraron {len(profs_data)} profesional(es) disponible(s) "
                f"para {specialty}:\n{profs_data}\n\n"
                f"Preséntaselos al paciente de forma amigable con su nombre real, especialidad y precio. "
                f"Pregúntale cuál prefiere."
            )
        else:
            followup_message = (
                f"[SISTEMA] No hay profesionales de {specialty} disponibles en este momento. "
                f"Informa al paciente amablemente y ofrece alternativas o sugerir intentar más tarde."
            )

        result2 = await run_coordinator(
            session_id=session_id,
            user_id=current_user.id,
            message=followup_message,
            patient_context=patient_context,
            db=db
        )
        result = result2

    return AgentChatResponse(
        session_id=session_id,
        message=result["message"],
        action=result.get("action"),
        available_professionals=available_professionals,
    )


# ── POST /api/v1/agent/voice-chat ───────────────────
@router.post(
    "/voice-chat",
    summary="Enviar audio al agente y recibir respuesta en audio"
)
async def voice_chat(
    audio: UploadFile = File(...),
    session_id: str = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Flujo completo de voz:
    1. Recibe audio del paciente (webm/mp3/wav)
    2. Gemini transcribe y procesa el audio
    3. Google TTS convierte la respuesta a audio
    4. Devuelve texto + audio base64
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Agente IA no configurado")

    session_id = session_id or str(uuid.uuid4())

    # Leer audio
    audio_bytes = await audio.read()
    audio_b64 = base64.b64encode(audio_bytes).decode()

    # Determinar mime type
    content_type = audio.content_type or "audio/webm"

    # Enviar audio a Gemini para transcripción y respuesta
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    # Obtener contexto del paciente
    patient_context = await _get_patient_context(db, current_user.id)
    context_str = ""
    if patient_context:
        context_str = f"\nPaciente: {patient_context['nombre']}"

    system_prompt = f"""Eres Medi, agente de orientación médica de MedicBolivia Bolivia.
El paciente te envió un mensaje de voz. Transcríbelo, entiéndelo y responde de forma breve y natural (máximo 3 oraciones).
No emitas diagnósticos. Solo orienta y conecta con especialistas.{context_str}
Responde SOLO con tu respuesta al paciente, sin mencionar la transcripción."""

    agent_text = "Disculpa, el servicio está ocupado. Intenta en unos segundos."
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=[
                    genai_types.Content(
                        parts=[
                            genai_types.Part(text=system_prompt),
                            genai_types.Part(
                                inline_data=genai_types.Blob(
                                    mime_type=content_type,
                                    data=audio_b64
                                )
                            )
                        ]
                    )
                ]
            )
            agent_text = response.text.strip()
            break
        except Exception as e:
            logger.error(f"Gemini voice error (intento {attempt+1}): {e}")
            if attempt < 2:
                import asyncio
                await asyncio.sleep(2)

    # Guardar en historial del chat
    from app.agents.coordinator import get_conversation_history
    # Agregar al historial (simplificado — el texto transcrito no lo tenemos, usamos placeholder)
    
    # Convertir respuesta a audio con Google TTS
    audio_response_b64 = await _text_to_speech(agent_text)

    return JSONResponse({
        "session_id": session_id,
        "message": agent_text,
        "audio_base64": audio_response_b64,  # None si TTS falla — frontend usará texto
        "audio_format": "mp3"
    })


# ── POST /api/v1/agent/tts ──────────────────────────
@router.post(
    "/tts",
    summary="Convertir texto a voz (Google TTS Neural2)"
)
async def text_to_speech_endpoint(
    text: str,
    current_user: User = Depends(get_current_user)
):
    """
    Convierte cualquier texto a audio MP3.
    Usado para que el paciente escuche las respuestas del agente.
    """
    if not settings.GOOGLE_TTS_API_KEY:
        raise HTTPException(status_code=503, detail="Google TTS no configurado")

    audio_b64 = await _text_to_speech(text)
    if not audio_b64:
        raise HTTPException(status_code=500, detail="Error al generar audio")

    return {"audio_base64": audio_b64, "audio_format": "mp3"}


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
    summary="Obtener historial de conversación"
)
async def get_history(
    session_id: str,
    current_user: User = Depends(get_current_user)
):
    history = get_conversation_history(session_id)
    return {"session_id": session_id, "messages": history, "count": len(history)}

# ── POST /api/v1/agent/vapi-tts ─────────────────────
@router.post(
    "/vapi-tts",
    summary="TTS para Vapi (sin autenticación)"
)
async def vapi_tts(request: Request):
    """
    Endpoint TTS compatible con Vapi Custom Voice.
    Retorna: audio MP3 binario
    """
    try:
        body = await request.json()
        logger.info(f"Vapi TTS body: {body}")

        # Vapi envía el texto en body["text"] directamente (voice-request)
        text = body.get("text", "")
        if not text and isinstance(body.get("message"), dict):
            text = body["message"].get("content", "")
        if not text and isinstance(body.get("message"), str):
            text = body["message"]

        if not text:
            raise HTTPException(status_code=400, detail="No text provided")

        audio_b64 = await _text_to_speech(text)
        if not audio_b64:
            raise HTTPException(status_code=500, detail="TTS failed")

        audio_bytes = base64.b64decode(audio_b64)
        
        from fastapi.responses import Response
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"Vapi TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── POST /api/v1/agent/vapi-llm/chat/completions ────
from fastapi.responses import StreamingResponse
import json

@router.post("/vapi-llm/chat/completions")
async def vapi_llm_completions(request: Request):
    from google import genai as genai_client
    from google.genai import types as genai_types

    body = await request.json()
    messages = body.get("messages", [])
    stream = body.get("stream", False)

    system_prompt = ""
    last_user_msg = ""

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            system_prompt = content
        elif role == "user":
            last_user_msg = content

    client = genai_client.Client(api_key=settings.GEMINI_API_KEY)

    if stream:
        async def generate():
            try:
                response = client.models.generate_content_stream(
                    model="gemini-2.5-flash",
                    contents=last_user_msg,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=system_prompt,
                    )
                )
                for chunk in response:
                    text = chunk.text if hasattr(chunk, 'text') and chunk.text else ""
                    if text:
                        data = {
                            "id": "chatcmpl-vapi",
                            "object": "chat.completion.chunk",
                            "choices": [{"delta": {"content": text}, "index": 0, "finish_reason": None}]
                        }
                        yield f"data: {json.dumps(data)}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                logger.error(f"Vapi LLM stream error: {e}")
                yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
    else:
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=last_user_msg,
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_prompt,
                )
            )
            return {
                "id": "chatcmpl-vapi",
                "object": "chat.completion",
                "choices": [{"message": {"role": "assistant", "content": response.text}, "index": 0, "finish_reason": "stop"}]
            }
        except Exception as e:
            logger.error(f"Vapi LLM error: {e}")
            raise HTTPException(status_code=500, detail=str(e))