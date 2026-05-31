"""
app/agents/coordinator.py
Agente Coordinador — cerebro principal del sistema de IA.
Usa Claude (Anthropic) para orientar al paciente y coordinar consultas.
"""
import json
import uuid
from typing import Optional
import anthropic
from loguru import logger

from app.core.config import settings

# Cliente Anthropic
client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

# ── Almacén de conversaciones en memoria ──────────────
# En producción migrar a Redis para persistencia entre reinicios
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
4. Mostrarle los profesionales disponibles y coordinar la conexión

REGLAS ABSOLUTAS — NUNCA LAS ROMPAS:
- JAMÁS emitas diagnósticos médicos. Si el paciente insiste, di: "No soy médico y no puedo decirte qué tienes. Mi rol es conectarte con quien sí puede ayudarte."
- JAMÁS recetes medicamentos ni dosis
- JAMÁS digas si algo "es grave" o "no es grave"
- Si hay síntomas de riesgo de vida (dolor pecho intenso + falta de aire, pérdida de conciencia, sangrado severo): recomienda URGENCIAS inmediatamente

ESPECIALIDADES DISPONIBLES EN LA PLATAFORMA:
- Medicina General: síntomas generales, resfríos, dolores, certificados, consultas preventivas
- Cardiología: corazón, presión arterial, palpitaciones, dolor en el pecho
- Psicología: ansiedad, depresión, estrés, problemas emocionales, insomnio
- Pediatría: niños y niñas menores de 14 años
- Nutrición: alimentación, control de peso, dietas terapéuticas
- Ginecología: salud femenina, control reproductivo
- Traumatología: huesos, articulaciones, músculos, lesiones deportivas
- Dermatología: piel, cabello, uñas, alergias cutáneas

ACCIONES DISPONIBLES:
Cuando necesites buscar profesionales, incluye exactamente:
[ACTION:SEARCH_PROFESSIONALS:especialidad]

Cuando el paciente confirme a un profesional:
[ACTION:INITIATE_CONSULTATION:professional_id]

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
- Si tiene alergias o condiciones crónicas, agradecer y confirmar que quedaron guardadas
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
    """
    Ejecuta el Agente Coordinador.
    Retorna: { message, action, available_professionals }
    """
    import time
    start = time.time()

    history = _conversation_store.get(session_id, [])

    # Enriquecer el prompt con contexto del paciente
    system = COORDINATOR_SYSTEM
    if patient_context:
        system += f"\n\nPERFIL DEL PACIENTE:\n{json.dumps(patient_context, ensure_ascii=False)}"
    if available_professionals:
        system += f"\n\nPROFESIONALES DISPONIBLES AHORA:\n{json.dumps(available_professionals, ensure_ascii=False, default=str)}"

    messages = history + [{"role": "user", "content": message}]

    try:
        response = client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=settings.CLAUDE_MAX_TOKENS,
            system=system,
            messages=messages,
        )
        reply = response.content[0].text
        latency_ms = int((time.time() - start) * 1000)

        # Guardar en historial (máx 20 mensajes)
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > 20:
            history = history[-20:]
        _conversation_store[session_id] = history

        # Guardar log en BD si tenemos sesión
        if db:
            from app.models.models import AgentLog, AgentType
            log = AgentLog(
                user_id=user_id,
                agent_type=AgentType.COORDINATOR,
                session_id=session_id,
                user_message=message,
                agent_response=reply,
                tokens_used=response.usage.input_tokens + response.usage.output_tokens,
                latency_ms=latency_ms,
            )
            db.add(log)
            await db.commit()

        # Parsear acciones en la respuesta
        return _parse_action(reply, response.usage)

    except Exception as e:
        logger.error(f"Error en agente coordinador: {e}")
        return {
            "message": "Disculpa, tuve un problema técnico. Por favor intenta de nuevo en un momento.",
            "action": None,
            "available_professionals": None
        }


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
    messages = history + [{"role": "user", "content": message}]

    try:
        response = client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=800,
            system=system,
            messages=messages,
        )
        reply = response.content[0].text

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > 30:
            history = history[-30:]
        _conversation_store[session_id] = history

        # Detectar fin de onboarding
        onboarding_done = "[ONBOARDING_COMPLETE]" in reply
        clean_reply = reply.replace("[ONBOARDING_COMPLETE]", "").strip()

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
        logger.error(f"Error en agente onboarding: {e}")
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

    try:
        response = client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=400,
            system=POST_CONSULTATION_SYSTEM,
            messages=[{"role": "user", "content": context}],
        )
        return response.content[0].text
    except Exception as e:
        logger.error(f"Error en agente post-consulta: {e}")
        return f"Tu consulta con {professional_name} ha finalizado. ¡Gracias por usar MedicBolivia!"


def get_conversation_history(session_id: str) -> list:
    """Retorna el historial de conversación de una sesión."""
    return _conversation_store.get(session_id, [])


def clear_conversation(session_id: str) -> None:
    """Limpia el historial de una sesión al terminar la consulta."""
    if session_id in _conversation_store:
        del _conversation_store[session_id]


# ─────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────

def _parse_action(reply: str, usage) -> dict:
    """
    Extrae acciones del texto del agente.
    Formato: [ACTION:TIPO:parámetro]
    """
    import re
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
        "tokens_used": usage.input_tokens + usage.output_tokens if usage else 0
    }
