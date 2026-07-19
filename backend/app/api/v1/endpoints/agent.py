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
from sqlalchemy.orm import selectinload
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.core.config import settings
from app.models.models import (
    User, Patient, Professional, ProfessionalStatus, AvailabilityMode,
    Specialty, SubSpecialty,
)
from app.schemas.schemas import AgentChatRequest, AgentChatResponse, ProfessionalPublicResponse
from app.agents.coordinator import (
    run_coordinator, run_onboarding, run_help, get_conversation_history
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


async def _resolve_specialty(db: AsyncSession, term: str) -> str | None:
    """
    Intenta mapear un término libre (dicho por el paciente o elegido por el
    modelo) al nombre CANÓNICO de una especialidad activa del catálogo real
    (tablas Specialty/SubSpecialty), en vez de confiar en una lista fija en
    el prompt que se desactualiza apenas se agrega o cambia una especialidad.

    Orden de intento:
    1) Match exacto contra el nombre de una especialidad.
    2) El término es en realidad una SUBespecialidad conocida (ej. paciente
       o modelo dice "Electrofisiología cardíaca") -> devuelve la especialidad
       padre ("Cardiología"), porque ahí es donde hay que buscar profesionales.
    3) Coincidencia parcial en cualquier dirección contra especialidades
       (cubre variantes de nombre, ej. "Ginecología" ⊂ "Ginecología y Obstetricia").
    4) Coincidencia parcial contra subespecialidades -> especialidad padre.

    Devuelve None si no se pudo mapear a nada del catálogo — en ese caso NO
    se debe asumir que la especialidad existe en la plataforma.
    """
    term = (term or "").strip()
    if not term:
        return None
    term_l = term.lower()

    result = await db.execute(
        select(Specialty).where(Specialty.is_active == True, func.lower(Specialty.name) == term_l)
    )
    specialty = result.scalar_one_or_none()
    if specialty:
        return specialty.name

    result = await db.execute(
        select(SubSpecialty)
        .options(selectinload(SubSpecialty.specialty))
        .where(SubSpecialty.is_active == True, func.lower(SubSpecialty.name) == term_l)
    )
    sub = result.scalar_one_or_none()
    if sub and sub.specialty and sub.specialty.is_active:
        return sub.specialty.name

    result = await db.execute(select(Specialty).where(Specialty.is_active == True))
    for s in result.scalars().all():
        name_l = s.name.lower()
        if term_l in name_l or name_l in term_l:
            return s.name

    result = await db.execute(
        select(SubSpecialty).options(selectinload(SubSpecialty.specialty)).where(SubSpecialty.is_active == True)
    )
    for sub in result.scalars().all():
        name_l = sub.name.lower()
        if (term_l in name_l or name_l in term_l) and sub.specialty and sub.specialty.is_active:
            return sub.specialty.name

    return None


async def _search_professionals(db: AsyncSession, specialty: str) -> dict:
    """
    Busca profesionales aprobados de una especialidad, sin inventar
    sustitutos de otra especialidad cuando no hay cobertura real.

    Devuelve:
    - specialty_requested: el término tal como llegó
    - specialty_resolved: nombre canónico del catálogo si se pudo mapear, o None
    - covered: True si existe al menos un profesional aprobado (online u
      offline) de esa especialidad en la plataforma
    - online: aprobados y ONLINE_NOW ahora mismo (pueden dar consulta inmediata)
    - offline: aprobados pero no conectados ahora (solo se pueden agendar)
    """
    resolved = await _resolve_specialty(db, specialty) if specialty else None
    match_name = resolved or specialty

    online, offline = [], []
    if match_name:
        query = select(Professional).where(
            Professional.status == ProfessionalStatus.APPROVED,
            (
                func.lower(Professional.specialty).contains(match_name.lower())
                | Professional.sub_specialties.any(match_name)
            ),
        )
        result = await db.execute(query)
        for p in result.scalars().all():
            (online if p.availability == AvailabilityMode.ONLINE_NOW else offline).append(p)

    return {
        "specialty_requested": specialty,
        "specialty_resolved": resolved,
        "covered": bool(online or offline),
        "online": [ProfessionalPublicResponse.model_validate(p) for p in online[:5]],
        "offline": [ProfessionalPublicResponse.model_validate(p) for p in offline[:5]],
    }


# Cliente HTTP persistente para Google TTS (evita reconexión TCP/TLS por cada llamada)
_tts_client: httpx.AsyncClient | None = None

async def _get_tts_client() -> httpx.AsyncClient:
    global _tts_client
    if _tts_client is None or _tts_client.is_closed:
        _tts_client = httpx.AsyncClient(
            timeout=10.0,
            http2=True,  # HTTP/2 reduce latencia
            limits=httpx.Limits(max_keepalive_connections=5, keepalive_expiry=30)
        )
    return _tts_client


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
            "audioEncoding": "LINEAR16",
            "speakingRate": 1.0,
            "pitch": 0.0,
            "sampleRateHertz": 16000,
        }
    }

    try:
        client = await _get_tts_client()
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
        search = await _search_professionals(db, specialty)
        online, offline = search["online"], search["offline"]
        resolved = search["specialty_resolved"] or specialty

        def _brief(p):
            return {
                "id": p.id,
                "nombre": f"{p.first_name} {p.last_name}",
                "especialidad": p.specialty,
                "precio_general": p.price_general,
                "experiencia_años": p.years_experience,
                "calificacion": p.average_rating,
            }

        # Se muestran tarjetas si hay online, offline, o ambos — la tarjeta
        # real (frontend) ya distingue "Consultar ahora" (solo online) de
        # "Agendar cita" (siempre disponible), así que mostrar offline no es
        # engañoso, siempre que el mensaje del agente lo aclare.
        available_professionals = (online + offline) or None

        if online:
            followup_message = (
                f"[SISTEMA] Se encontraron {len(online)} profesional(es) de {resolved} "
                f"CONECTADOS ahora mismo:\n{[_brief(p) for p in online]}\n\n"
                f"Preséntaselos al paciente de forma amigable con su nombre real, especialidad y "
                f"precio. Dile que puede tocar 'Consultar ahora' en la tarjeta para conectarse ya."
            )
        elif offline:
            followup_message = (
                f"[SISTEMA] Nadie de {resolved} está conectado ahora mismo, pero sí hay "
                f"{len(offline)} profesional(es) de esa especialidad en la plataforma:\n"
                f"{[_brief(p) for p in offline]}\n\n"
                f"Explícale con honestidad al paciente que por ahora no hay nadie en línea, pero que "
                f"puede tocar 'Agendar cita' en la tarjeta de abajo para reservar un horario. "
                f"NUNCA digas que puede 'consultar ya' o que están disponibles ahora mismo."
            )
        elif search["specialty_resolved"]:
            followup_message = (
                f"[SISTEMA] Por ahora no tenemos ningún profesional de {resolved} en la plataforma, "
                f"ni conectado ni para agendar. Dile esto con honestidad al paciente, sin prometer que "
                f"aparecerá alguien pronto. Ofrécele como alternativa una primera evaluación con "
                f"Medicina General, aclarando que ese médico lo puede orientar o derivar si hace falta."
            )
        else:
            followup_message = (
                f"[SISTEMA] '{specialty}' no coincide con ninguna especialidad de nuestro catálogo. "
                f"Pídele al paciente que te cuente un poco más sobre el síntoma para orientarlo mejor, "
                f"o sugiere Medicina General como punto de partida."
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


# ── GET /api/v1/agent/search-professionals ──────────
@router.get(
    "/search-professionals",
    summary="Buscar profesionales disponibles por especialidad (usado por el agente de voz vía function calling)"
)
async def search_professionals_endpoint(
    specialty: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Mismo mecanismo de búsqueda que usa el agente coordinador de texto
    ([ACTION:SEARCH_PROFESSIONALS:...]), expuesto como endpoint propio para
    que el agente de voz (Gemini Live, function calling) pueda invocarlo
    directamente y así tener el mismo comportamiento real que el chat de
    texto, en vez de solo prometerlo por voz sin ejecutarlo.
    """
    search = await _search_professionals(db, specialty)
    online, offline = search["online"], search["offline"]

    def _brief(p, en_linea: bool):
        return {
            "id": p.id,
            "nombre": f"{p.first_name} {p.last_name}",
            "especialidad": p.specialty,
            "precio_general": float(p.price_general),
            "experiencia_años": p.years_experience,
            "calificacion": float(p.average_rating),
            "en_linea": en_linea,
        }

    return {
        "specialty_requested": specialty,
        "specialty_resolved": search["specialty_resolved"],
        "covered": search["covered"],
        "count_online": len(online),
        "count_offline": len(offline),
        "professionals": [_brief(p, True) for p in online] + [_brief(p, False) for p in offline],
        "professionals_public": [p.model_dump(mode="json") for p in online] + [p.model_dump(mode="json") for p in offline],
    }

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


# ── POST /api/v1/agent/help ─────────────────────────
@router.post(
    "/help",
    response_model=AgentChatResponse,
    summary="Agente de Ayuda — guía de la plataforma, disponible en cualquier momento"
)
async def agent_help(
    data: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    A diferencia de /onboarding (una sola vez, en el primer registro, para
    recolectar datos médicos), este endpoint no depende de
    onboarding_completed — el paciente o profesional puede volver a
    preguntar cómo funciona la plataforma cuando quiera, desde el botón
    "Ayuda" del menú.
    """
    session_id = data.session_id or f"help-{current_user.id}-{uuid.uuid4().hex[:8]}"

    result = await run_help(
        session_id=session_id,
        user_id=current_user.id,
        user_role=current_user.role.value,
        message=data.message,
        db=db,
    )

    return AgentChatResponse(
        session_id=session_id,
        message=result["message"],
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

        # Vapi envía el texto dentro de body["message"]["text"]
        msg = body.get("message", {})
        text = ""
        if isinstance(msg, dict):
            text = msg.get("text", "") or msg.get("content", "")
        elif isinstance(msg, str):
            text = msg
        if not text:
            text = body.get("text", "")

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