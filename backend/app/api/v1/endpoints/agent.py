"""
app/api/v1/endpoints/agent.py
Endpoints del agente IA: chat, onboarding, historial, TTS, voice-chat.
"""
import uuid
import base64
import asyncio
from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from sqlalchemy.orm import selectinload
from loguru import logger

from app.db.database import get_db
from app.core.dependencies import get_current_user
from app.core.config import settings
from app.core.redis_client import redis_client
from app.models.models import (
    User, Patient, Professional, ProfessionalStatus, AvailabilityMode,
    Specialty, SubSpecialty,
)
from app.schemas.schemas import AgentChatRequest, AgentChatResponse, ProfessionalPublicResponse
from app.agents.coordinator import (
    run_coordinator, run_onboarding, run_help, get_conversation_history
)

router = APIRouter()

# ── Rate limit del agente IA (chat, voice-chat, onboarding, help) ────
# Cada llamada acá dispara una llamada real y paga a Gemini (y voice-chat
# además a Google TTS) — a diferencia del rate limit del chat WS (que
# protege contra inundar una conversación), este protege el costo real de
# la API y el cupo compartido de Gemini: un cliente en loop por un bug del
# frontend, o alguien mandando mensajes en ráfaga sin parar, puede generar
# costo real y — más grave — si Gemini devuelve 429 por exceso de cuota,
# eso degrada el agente para TODOS los usuarios, no solo para quien lo
# está abusando. Límite generoso (no lo nota una conversación real) pero
# real: comparte el mismo contador entre los 4 endpoints porque todos
# pagan al mismo cupo de Gemini.
_AGENT_RATE_LIMIT_MAX = 15
_AGENT_RATE_LIMIT_WINDOW_SECONDS = 60


async def _check_agent_rate_limit(user_id: str) -> None:
    key = f"agent_rate:{user_id}"
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, _AGENT_RATE_LIMIT_WINDOW_SECONDS)
    except Exception as e:
        # Si Redis está caído, no tiene sentido tumbar el agente por esto.
        logger.warning(f"No se pudo chequear rate limit del agente IA: {e}")
        return
    if count > _AGENT_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail="Estás mandando mensajes muy rápido. Esperá un momento antes de seguir.",
        )



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
                # sub_specialty ahora es un campo único de texto (ya no un
                # array — un profesional solo puede tener una
                # subespecialidad), así que la comparación en minúsculas es
                # directa, sin necesidad de unnest/EXISTS.
                | func.lower(Professional.sub_specialty).contains(match_name.lower())
            ),
        )
        result = await db.execute(query)
        for p in result.scalars().all():
            (online if p.availability == AvailabilityMode.ONLINE_NOW else offline).append(p)

    return {
        "specialty_requested": specialty,
        "specialty_resolved": resolved,
        "covered": bool(online or offline),
        "online_count": len(online),
        "offline_count": len(offline),
        # Las tarjetas mostradas/verbalizadas se recortan a 5 por prolijidad,
        # pero online_count/offline_count arriba reflejan el total real —
        # sin esto, Medi subestimaba cuántos profesionales hay si eran más
        # de 5 (ej. "encontré 5" con 8 conectados de verdad).
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


def _brief(p) -> dict:
    return {
        "id": p.id,
        "nombre": f"{p.first_name} {p.last_name}",
        "especialidad": p.specialty,
        "precio_general": p.price_general,
        "experiencia_años": p.years_experience,
        "calificacion": p.average_rating,
    }


async def _handle_search_action(
    db: AsyncSession,
    session_id: str,
    user_id: str,
    patient_context: dict | None,
    result: dict,
) -> tuple[dict, list | None]:
    """
    Si run_coordinator devolvió una acción SEARCH_PROFESSIONALS, ejecuta la
    búsqueda real y le devuelve el resultado al modelo para que redacte la
    respuesta final. Devuelve (result_final, available_professionals).

    Compartido entre /chat y /voice-chat — antes voice-chat no tenía este
    mecanismo en absoluto (no podía sugerir tarjetas de médicos, cada nota
    de voz era una llamada aislada a Gemini sin tools ni acción alguna).
    """
    if not (result.get("action") and result["action"].get("type") == "SEARCH_PROFESSIONALS"):
        return result, None

    specialty = result["action"].get("param", "")
    search = await _search_professionals(db, specialty)
    online, offline = search["online"], search["offline"]
    resolved = search["specialty_resolved"] or specialty

    # Se muestran tarjetas si hay online, offline, o ambos — la tarjeta
    # real (frontend) ya distingue "Consultar ahora" (solo online) de
    # "Agendar cita" (siempre disponible), así que mostrar offline no es
    # engañoso, siempre que el mensaje del agente lo aclare.
    available_professionals = (online + offline) or None

    if online:
        followup_message = (
            f"[SISTEMA] Se encontraron {search['online_count']} profesional(es) de {resolved} "
            f"CONECTADOS ahora mismo:\n{[_brief(p) for p in online]}\n\n"
            f"Preséntaselos al paciente de forma amigable con su nombre real, especialidad y "
            f"precio. Dile que puede tocar 'Consultar ahora' en la tarjeta para conectarse ya."
        )
    elif offline:
        followup_message = (
            f"[SISTEMA] Nadie de {resolved} está conectado ahora mismo, pero sí hay "
            f"{search['offline_count']} profesional(es) de esa especialidad en la plataforma:\n"
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
        user_id=user_id,
        message=followup_message,
        patient_context=patient_context,
        db=db,
    )
    return result2, available_professionals


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
    await _check_agent_rate_limit(current_user.id)
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

    result, available_professionals = await _handle_search_action(
        db, session_id, current_user.id, patient_context, result
    )

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

    await _check_agent_rate_limit(current_user.id)
    session_id = session_id or str(uuid.uuid4())

    # Leer audio
    audio_bytes = await audio.read()
    audio_b64 = base64.b64encode(audio_bytes).decode()
    content_type = audio.content_type or "audio/webm"

    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    # Paso 1: SOLO transcribir el audio. Antes este endpoint le pedía a
    # Gemini que escuchara el audio y respondiera directamente en una única
    # llamada aislada — sin historial (cada nota de voz "olvidaba" todo lo
    # dicho antes, incluso en la misma sesión) y sin la herramienta de
    # búsqueda de profesionales (nunca podía mostrar tarjetas de médicos, a
    # diferencia del chat de texto y de la llamada en vivo). Ahora solo
    # transcribe, y el texto resultante pasa por el mismo run_coordinator()
    # que usa el chat de texto — así comparten historial (Redis) y el
    # mecanismo real de ACTION:SEARCH_PROFESSIONALS.
    transcript = ""
    for attempt in range(3):
        try:
            # client.models.generate_content (SDK sync de google-genai) es
            # una llamada de red BLOQUEANTE — igual que en
            # coordinator.py::_call_gemini, si corre directo acá bloquea el
            # event loop completo del worker (2 workers en producción,
            # ecosystem.config.js) mientras dura la transcripción: CUALQUIER
            # otra request cayendo en ese mismo worker (chat, video, lo que
            # sea) se queda esperando en cola, hasta 3 veces en el peor caso
            # si los 3 intentos fallan. Por eso corre en un hilo aparte con
            # asyncio.to_thread, con el mismo timeout defensivo de 25s que
            # ya usa _call_gemini (el propio SDK tiene issues abiertos donde
            # su timeout interno no se respeta: googleapis/python-genai#911,
            # #4031 — no hay que confiar en que el SDK se corte solo).
            def _sync_transcribe():
                return client.models.generate_content(
                    model=settings.GEMINI_MODEL,
                    contents=[
                        genai_types.Content(
                            parts=[
                                genai_types.Part(
                                    text="Transcribe exactamente lo que dice este audio, en español. "
                                         "Responde SOLO con la transcripción textual, sin comillas, sin "
                                         "comentarios ni explicaciones. Si no se entiende nada, responde "
                                         "con una cadena vacía."
                                ),
                                genai_types.Part(
                                    inline_data=genai_types.Blob(mime_type=content_type, data=audio_b64)
                                ),
                            ]
                        )
                    ],
                )
            response = await asyncio.wait_for(asyncio.to_thread(_sync_transcribe), timeout=25.0)
            transcript = (response.text or "").strip()
            break
        except Exception as e:
            logger.error(f"Gemini transcripción error (intento {attempt+1}): {e}")
            if attempt < 2:
                await asyncio.sleep(2)

    if not transcript:
        return JSONResponse({
            "session_id": session_id,
            "message": "No pude entender tu mensaje de voz. ¿Puedes intentarlo de nuevo o escribirlo?",
            "audio_base64": None,
            "audio_format": "mp3",
            "available_professionals": None,
        })

    patient_context = await _get_patient_context(db, current_user.id) if current_user.role == "PATIENT" else None

    result = await run_coordinator(
        session_id=session_id,
        user_id=current_user.id,
        message=(
            "[Este mensaje llegó por nota de voz — tu respuesta se va a leer en voz alta, así que "
            "respondé breve y natural, máximo 3 oraciones, sin listas ni números] " + transcript
        ),
        patient_context=patient_context,
        db=db,
    )
    result, available_professionals = await _handle_search_action(
        db, session_id, current_user.id, patient_context, result
    )
    agent_text = result["message"]

    # Convertir respuesta a audio con Google TTS
    audio_response_b64 = await _text_to_speech(agent_text)

    return JSONResponse({
        "session_id": session_id,
        "message": agent_text,
        "audio_base64": audio_response_b64,  # None si TTS falla — frontend usará texto
        "audio_format": "mp3",
        "available_professionals": (
            [p.model_dump(mode="json") for p in available_professionals] if available_professionals else None
        ),
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


# ── POST /api/v1/agent/live-token ───────────────────
@router.post(
    "/live-token",
    summary="Genera un token efímero para que el navegador se conecte directo a Gemini Live"
)
async def create_live_token(current_user: User = Depends(get_current_user)):
    """
    La llamada de voz (Gemini Live) conecta el navegador DIRECTO a Google por
    WebSocket para minimizar latencia — el audio nunca pasa por nuestro
    backend. El navegador necesita alguna credencial para autenticarse ante
    Google, pero NUNCA debe ser nuestra API key real: si lo fuera, cualquiera
    que abriera las devtools durante una llamada podría copiarla de la URL
    del WebSocket y usarla libremente a nuestra cuenta, sin límite (así
    estaba antes: NEXT_PUBLIC_GEMINI_API_KEY quedaba incrustada tal cual en
    el JS público del navegador).

    En su lugar, generamos acá un ephemeral token — el mecanismo oficial de
    Google para este caso exacto (https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens):
    de un solo uso y válido pocos minutos, así que aunque alguien lo copie
    de las devtools no le sirve de nada. Este endpoint sí requiere sesión
    iniciada en nuestra plataforma (get_current_user) — la seguridad del
    token efímero depende de que solo lo entreguemos a usuarios reales.
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Agente de voz no configurado")

    from google import genai as genai_client

    token_client = genai_client.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options={"api_version": "v1alpha"},  # los ephemeral tokens requieren v1alpha
    )
    now = datetime.now(timezone.utc)
    try:
        token = await asyncio.wait_for(
            asyncio.to_thread(
                token_client.auth_tokens.create,
                config={
                    "uses": 1,
                    # 1 minuto para arrancar la sesión con este token (el
                    # frontend lo pide justo antes de abrir el WebSocket, no
                    # hace falta más), 5 minutos de margen por si el
                    # navegador tarda en conseguir el micrófono antes de
                    # completar el setup — la sesión en sí, una vez
                    # iniciada, no depende más del token.
                    "expire_time": (now + timedelta(minutes=5)).isoformat(),
                    "new_session_expire_time": (now + timedelta(minutes=1)).isoformat(),
                },
            ),
            timeout=10.0,
        )
    except Exception as e:
        logger.error(f"Error generando token efímero de Gemini Live: {e}")
        raise HTTPException(status_code=502, detail="No se pudo iniciar la llamada de voz, intenta de nuevo")

    return {"token": token.name}


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
        "count_online": search["online_count"],
        "count_offline": search["offline_count"],
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

    await _check_agent_rate_limit(current_user.id)
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
    await _check_agent_rate_limit(current_user.id)

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
    history = await get_conversation_history(session_id)
    return {"session_id": session_id, "messages": history, "count": len(history)}

