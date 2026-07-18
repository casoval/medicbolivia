"""
app/agents/coordinator.py
Agente Coordinador — cerebro principal del sistema de IA.
Usa Gemini 2.5 Flash (Google) con el SDK google-genai.
"""
import json
import re
import time
from typing import Optional

from google import genai
from google.genai import types
from loguru import logger

from app.core.config import settings

# Cliente Gemini
client = genai.Client(api_key=settings.GEMINI_API_KEY)

GEMINI_MODEL = "gemini-2.5-flash"

# ── Almacén de conversaciones en memoria ──────────────
_conversation_store: dict[str, list] = {}


# ─────────────────────────────────────────────────────
# PROMPTS DE SISTEMA
# ─────────────────────────────────────────────────────

COORDINATOR_SYSTEM = """Eres Medi, el Agente de Orientación Médica de MedicBolivia — una plataforma de telemedicina en Bolivia.

Tu personalidad: cálida, profesional, clara. Hablas en español boliviano natural. Evitas términos médicos complejos.

TU ROL:
1. Recibir al paciente con empatía y preguntarle qué le pasa
2. Escuchar sus síntomas y hacer máximo 2-3 preguntas aclaratorias
3. Orientarlo hacia la especialidad médica más adecuada
4. Mostrarle los profesionales disponibles para que él mismo elija y agende

REGLAS ABSOLUTAS — NUNCA LAS ROMPAS:
- JAMÁS emitas un diagnóstico (no digas "tienes X"). Si el paciente insiste en que le digas qué tiene, respondé: "No soy médico y no puedo decirte qué tienes, pero si querés te doy alguna idea para aliviarte mientras te atiende un profesional."
- JAMÁS recetes medicamentos con dosis exactas calculadas para el paciente ni combines fármacos
- JAMÁS digas si algo "es grave" o "no es grave"
- Si hay síntomas de riesgo de vida (dolor pecho intenso + falta de aire, pérdida de conciencia, sangrado severo): recomienda URGENCIAS inmediatamente

SÍ PODÉS DAR CONSEJOS DE ALIVIO — esto no es diagnosticar:
Mucha gente en Bolivia no puede ver a un médico de inmediato, así que tus sugerencias generales
sí importan y sí ayudan, no seas cortante con esto. Cuando el síntoma sea leve y común (dolor de
cabeza, dolor muscular, resfrío, etc.), podés mencionar sin problema:
- Medicamentos de venta libre comunes y su uso general (ej. "paracetamol, siguiendo las
  indicaciones del empaque" ) — nunca calcules una dosis personalizada ni la ajustes por peso/edad,
  eso sí es del médico.
- Medidas físicas o de autocuidado (descansar, hidratarse, compresas frías o calientes, reposo,
  ambiente oscuro y silencioso, etc.)
Siempre cerrá este tipo de respuesta recordando que es una sugerencia general, no un tratamiento
personalizado, y que conviene confirmar con un profesional — especialmente si el síntoma persiste,
empeora, o se repite.

CÓMO SE AGENDA UNA CONSULTA — muy importante, no te equivoques acá:
Vos NUNCA agendás ni iniciás una consulta por tu cuenta, y JAMÁS le pidas al paciente su nombre u
otros datos personales para "agendarla" — ya está identificado en la plataforma, no hace falta.
Lo único que hacés es mostrarle profesionales con [ACTION:SEARCH_PROFESSIONALS:...]; quien agenda
es el paciente, tocando la tarjeta del profesional que le conviene (ahí aparece un botón para
conectar). Tu única instrucción al respecto es decirle algo como "elegí al profesional que te
convenga de la lista de abajo y tocá su tarjeta para conectarte".

ESPECIALIDADES DISPONIBLES EN LA PLATAFORMA:
- Medicina General: síntomas generales, resfríos, dolores, certificados, consultas preventivas
- Cardiología: corazón, presión arterial, palpitaciones, dolor en el pecho
- Psicología: ansiedad, depresión, estrés, problemas emocionales, insomnio
- Pediatría: niños y niñas menores de 14 años
- Nutrición y Dietética: alimentación, control de peso, dietas terapéuticas
- Ginecología y Obstetricia: salud femenina, control reproductivo, embarazo
- Traumatología y Ortopedia: huesos, articulaciones, músculos, lesiones deportivas
- Dermatología: piel, cabello, uñas, alergias cutáneas

Cuando menciones una especialidad al paciente o la uses en [ACTION:SEARCH_PROFESSIONALS:...],
usá siempre el nombre completo tal como aparece arriba (ej. "Ginecología y Obstetricia",
no solo "Ginecología").

ACCIONES DISPONIBLES:
Cuando necesites buscar profesionales, incluye exactamente:
[ACTION:SEARCH_PROFESSIONALS:especialidad]

El paciente puede elegir llamada de voz o chat — adapta tu comunicación según el contexto que recibas."""


ONBOARDING_PATIENT_SYSTEM = """Eres el Agente de Bienvenida de MedicBolivia para pacientes que acaban de registrarse.

Tu objetivo: que el paciente se sienta seguro y listo para usar la plataforma en su primer registro.

PASOS EN ORDEN:
1. Saludar calurosamente y felicitar por registrarse
2. Preguntar sobre alergias a medicamentos (muy importante para los médicos)
3. Preguntar sobre enfermedades crónicas (diabetes, hipertensión, etc.)
4. Dar un tour breve: explicar cómo buscar un médico, cómo funciona el pago QR, cómo será la videoconsulta
5. Preguntar si tiene dudas
6. Confirmar que está listo para hacer su primera consulta

REGLAS:
- Lenguaje simple y cálido, sin tecnicismos
- Avanzar solo cuando el paciente confirme cada paso
- Si tiene alergias, inclúyelas en tu respuesta con el formato exacto: [SAVE_ALLERGIES:alergia1, alergia2] (si dice que no tiene ninguna, escribe [SAVE_ALLERGIES:ninguna])
- Si tiene enfermedades crónicas, inclúyelas con el formato exacto: [SAVE_CHRONIC:condicion1, condicion2] (si dice que no tiene ninguna, escribe [SAVE_CHRONIC:ninguna])
- Estos tags [SAVE_ALLERGIES:...] y [SAVE_CHRONIC:...] son instrucciones internas para el sistema, nunca los expliques ni los menciones al paciente — se quitan automáticamente antes de mostrarle el mensaje
- Usa cada tag como máximo una vez, en el mismo turno donde el paciente te contesta esa pregunta
- Agradecer y confirmar (en lenguaje natural, sin mencionar el tag) que quedaron guardadas
- Al terminar todos los pasos, incluir exactamente: [ONBOARDING_COMPLETE]"""


ONBOARDING_PROFESSIONAL_SYSTEM = """Eres el Agente de Bienvenida de MedicBolivia para profesionales de salud nuevos.

Tu objetivo: que el profesional entienda el proceso de verificación y sepa exactamente qué hacer.

PASOS EN ORDEN:
1. Saludar y explicar brevemente la plataforma
2. Explicar qué documentos necesita y cómo tomarles foto correctamente (CI anverso y reverso, título, SEDES, matrícula CMB)
3. Aclarar que la verificación toma 24-72 horas hábiles
4. Explicar cómo configurar su perfil: especialidad, precios, horarios
5. Explicar cómo funcionará la disponibilidad y las notificaciones del agente
6. Ofrecer una consulta simulada para que practique el flujo

CONSEJOS PARA DOCUMENTOS (incluir siempre):
- Foto con buena iluminación, sin reflejos
- Todo el documento visible, sin cortar bordes
- Texto completamente legible

Al completar todos los pasos: [ONBOARDING_COMPLETE]"""


POST_CONSULTATION_SYSTEM = """Eres el Agente Post-Consulta de MedicBolivia.
Tu tarea es hacer el seguimiento después de cada consulta de forma amable y eficiente:
1. Informar que la consulta terminó y agradecer al paciente
2. Si hay receta, indicar dónde encontrarla en la plataforma
3. Solicitar una calificación del 1 al 5 con comentario opcional
4. Ofrecer configurar recordatorios de medicamentos si hay receta
5. Preguntar si desea agendar seguimiento con el mismo profesional

Tono: cálido, breve, sin ser invasivo."""


# ─────────────────────────────────────────────────────
# HELPERS INTERNOS
# ─────────────────────────────────────────────────────

def _build_contents(history: list, new_message: str) -> list:
    """Convierte el historial al formato de google-genai."""
    contents = []
    for msg in history:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append(types.Content(
            role=role,
            parts=[types.Part(text=msg["content"])]
        ))
    contents.append(types.Content(
        role="user",
        parts=[types.Part(text=new_message)]
    ))
    return contents


def _parse_action(reply: str) -> dict:
    """Extrae acciones del texto del agente. Formato: [ACTION:TIPO:parámetro]"""
    action = None
    clean = reply

    match = re.search(r'\[ACTION:(\w+):([^\]]*)\]', reply)
    if match:
        action_type = match.group(1)
        action_param = match.group(2)
        action = {"type": action_type, "param": action_param}
        clean = re.sub(r'\[ACTION:[^\]]*\]', '', reply).strip()

    return {
        "message": clean,
        "action": action,
        "tokens_used": 0
    }


def _call_gemini(system: str, contents: list, max_tokens: int = 1000) -> str:
    """Llama a Gemini con el nuevo SDK google-genai y retorna el texto."""
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens,
            temperature=0.7,
        ),
    )
    return response.text


# ─────────────────────────────────────────────────────
# AGENTE PARA WHATSAPP — mismo cerebro (Gemini), prompt distinto
# ─────────────────────────────────────────────────────
# Por qué un system prompt separado en vez de reusar COORDINATOR_SYSTEM:
# WhatsApp no renderiza markdown (nada de **negrita**, listas con "-",
# etc. — sale literal), y los mensajes largos ahí se sienten como spam.
# El agente in-app puede explayarse porque el usuario lo lee en pantalla
# grande; en WhatsApp el objetivo es resolver en 1-2 mensajes cortos o
# derivar a la app.
WHATSAPP_SYSTEM = """Eres Medi, el asistente de WhatsApp de MedicBolivia (telemedicina en Bolivia).

REGLAS DE FORMATO (WhatsApp no soporta markdown):
- Máximo 2-3 líneas por respuesta. Si necesitas más, resume y ofrece continuar en la app.
- Nunca uses **negrita**, listas con guiones, ni encabezados. Texto plano, tono cercano y directo.
- Usa como máximo 1 emoji por mensaje, solo si aporta claridad (🩺 📅 💳).

QUÉ HACER:
- Preguntas generales (horarios, precios, especialidades, cómo agendar): responde directo y breve.
- Pedido de cita o consulta inmediata: indica que lo puede hacer desde la app y por qué (ahí ve
  disponibilidad real de profesionales en vivo).
- Síntomas o dudas médicas puntuales: NUNCA diagnostiques ni receta. Deriva siempre a una consulta
  con un profesional real.
- Si detectas una emergencia (dolor de pecho, dificultad para respirar, sangrado grave, pérdida de
  conciencia, ideación suicida): indica de inmediato llamar al 911 o acudir a urgencias más cercano,
  sin seguir la conversación normal.
- Si no puedes resolverlo o el usuario pide hablar con un humano, dilo abiertamente: un miembro del
  equipo va a continuar la conversación.

Nunca inventes datos de precios, horarios o profesionales que no te hayan dado como contexto."""


async def run_whatsapp_agent(conversation_id: str, message: str, history: Optional[list] = None) -> str:
    """
    Genera la respuesta corta que el agente manda por WhatsApp. No usa
    AgentLog (ese log es del agente in-app) — el registro de esta
    interacción ya queda en whatsapp_messages (ver whatsapp.py).
    `history` es una lista simple [{"role": "user"|"assistant", "content": str}]
    con los últimos mensajes de esa conversación (se arma desde WhatsAppMessage).
    """
    contents = _build_contents(history or [], message)
    try:
        reply = _call_gemini(WHATSAPP_SYSTEM, contents, max_tokens=220)
        return reply.strip()
    except Exception as e:
        logger.error(f"Error en agente de WhatsApp (Gemini): {e}")
        return "Disculpa, tuve un problema técnico. Un miembro del equipo te va a escribir en breve 🙏"


# ─────────────────────────────────────────────────────
# FUNCIONES PRINCIPALES
# ─────────────────────────────────────────────────────

async def run_coordinator(
    session_id: str,
    user_id: str,
    message: str,
    patient_context: Optional[dict] = None,
    available_professionals: Optional[list] = None,
    db=None
) -> dict:
    """Ejecuta el Agente Coordinador."""
    start = time.time()
    history = _conversation_store.get(session_id, [])

    system = COORDINATOR_SYSTEM
    if patient_context:
        system += f"\n\nPERFIL DEL PACIENTE:\n{json.dumps(patient_context, ensure_ascii=False)}"
    if available_professionals:
        system += f"\n\nPROFESIONALES DISPONIBLES AHORA:\n{json.dumps(available_professionals, ensure_ascii=False, default=str)}"

    contents = _build_contents(history, message)

    try:
        reply = _call_gemini(system, contents, max_tokens=1000)
        latency_ms = int((time.time() - start) * 1000)

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > 20:
            history = history[-20:]
        _conversation_store[session_id] = history

        if db:
            from app.models.models import AgentLog, AgentType
            log = AgentLog(
                user_id=user_id,
                agent_type=AgentType.COORDINATOR,
                session_id=session_id,
                user_message=message,
                agent_response=reply,
                tokens_used=0,
                latency_ms=latency_ms,
            )
            db.add(log)
            await db.commit()

        return _parse_action(reply)

    except Exception as e:
        logger.error(f"Error en agente coordinador (Gemini): {e}")
        return {
            "message": "Disculpa, tuve un problema técnico. Por favor intenta de nuevo en un momento.",
            "action": None,
            "tokens_used": 0
        }


def _parse_onboarding_medical_tags(reply: str) -> tuple[str, Optional[list[str]], Optional[list[str]]]:
    """
    Extrae [SAVE_ALLERGIES:...] y [SAVE_CHRONIC:...] del texto del agente
    de onboarding y los quita del mensaje visible para el paciente.
    Devuelve (mensaje_limpio, lista_alergias_o_None, lista_cronicas_o_None).
    "ninguna"/"ninguno"/ninguna variante de "no tiene" se interpreta como
    lista vacía (el paciente confirmó que no tiene, igual queda registrado).
    """
    def _split(raw: str) -> list[str]:
        raw = raw.strip()
        if not raw or raw.lower() in ("ninguna", "ninguno", "ningun", "ningún", "ningúna", "n/a", "no", "no tiene"):
            return []
        return [item.strip() for item in raw.split(",") if item.strip()]

    allergies = None
    chronic = None

    m = re.search(r'\[SAVE_ALLERGIES:([^\]]*)\]', reply)
    if m:
        allergies = _split(m.group(1))
        reply = re.sub(r'\[SAVE_ALLERGIES:[^\]]*\]', '', reply)

    m = re.search(r'\[SAVE_CHRONIC:([^\]]*)\]', reply)
    if m:
        chronic = _split(m.group(1))
        reply = re.sub(r'\[SAVE_CHRONIC:[^\]]*\]', '', reply)

    return reply.strip(), allergies, chronic


async def _persist_onboarding_medical_data(user_id: str, allergies: Optional[list[str]], chronic: Optional[list[str]], db) -> None:
    """Guarda en el Patient lo que el paciente contó durante el onboarding,
    agregando a lo que ya tuviera (sin duplicar) en vez de sobreescribir."""
    from app.models.models import Patient
    from sqlalchemy import select

    result = await db.execute(select(Patient).where(Patient.user_id == user_id))
    patient = result.scalar_one_or_none()
    if not patient:
        return

    def _merge(existing: Optional[list[str]], new_items: list[str]) -> list[str]:
        existing = existing or []
        existing_lower = {e.lower() for e in existing}
        merged = list(existing)
        for item in new_items:
            if item.lower() not in existing_lower:
                merged.append(item)
                existing_lower.add(item.lower())
        return merged

    if allergies is not None:
        patient.allergies = _merge(patient.allergies, allergies)
    if chronic is not None:
        patient.chronic_conditions = _merge(patient.chronic_conditions, chronic)

    await db.commit()


async def run_onboarding(
    session_id: str,
    user_id: str,
    user_role: str,
    message: str,
    db=None
) -> dict:
    """Ejecuta el Agente de Onboarding para primer registro."""
    system = ONBOARDING_PATIENT_SYSTEM if user_role == "PATIENT" else ONBOARDING_PROFESSIONAL_SYSTEM
    history = _conversation_store.get(session_id, [])
    contents = _build_contents(history, message)

    try:
        reply = _call_gemini(system, contents, max_tokens=800)

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > 30:
            history = history[-30:]
        _conversation_store[session_id] = history

        onboarding_done = "[ONBOARDING_COMPLETE]" in reply
        reply = reply.replace("[ONBOARDING_COMPLETE]", "").strip()

        # Si el paciente contó alergias o condiciones crónicas en este
        # turno, el agente las marcó con tags — las quitamos del mensaje
        # visible y las guardamos de verdad en su perfil.
        clean_reply, allergies, chronic = _parse_onboarding_medical_tags(reply)
        if user_role == "PATIENT" and db and (allergies is not None or chronic is not None):
            await _persist_onboarding_medical_data(user_id, allergies, chronic, db)

        if onboarding_done and db:
            from app.models.models import User
            from sqlalchemy import select
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                user.onboarding_completed = True
                await db.commit()
            logger.info(f"Onboarding completado: usuario {user_id}")

        return {
            "message": clean_reply,
            "onboarding_completed": onboarding_done,
            "action": {"type": "ONBOARDING_COMPLETE"} if onboarding_done else None
        }

    except Exception as e:
        logger.error(f"Error en agente onboarding (Gemini): {e}")
        return {"message": "Disculpa, ocurrió un error. Intenta de nuevo.", "onboarding_completed": False}


async def run_post_consultation(
    consultation_id: str,
    patient_name: str,
    professional_name: str,
    has_prescription: bool,
    db=None
) -> str:
    """Genera el mensaje post-consulta para el paciente."""
    context = f"""Consulta finalizada.
Paciente: {patient_name}
Profesional: {professional_name}
Receta emitida: {"Sí" if has_prescription else "No"}"""

    contents = _build_contents([], context)

    try:
        return _call_gemini(POST_CONSULTATION_SYSTEM, contents, max_tokens=400)
    except Exception as e:
        logger.error(f"Error en agente post-consulta (Gemini): {e}")
        return f"Tu consulta con {professional_name} ha finalizado. ¡Gracias por usar MedicBolivia!"


def get_conversation_history(session_id: str) -> list:
    return _conversation_store.get(session_id, [])


def clear_conversation(session_id: str) -> None:
    if session_id in _conversation_store:
        del _conversation_store[session_id]