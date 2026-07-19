"""
app/agents/coordinator.py
Agente Coordinador — cerebro principal del sistema de IA.
Usa Gemini 2.5 Flash (Google) con el SDK google-genai.
"""
import asyncio
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

ESPECIALIDADES — MUY IMPORTANTE, LEÉ ESTO CON CUIDADO:
Nuestro catálogo real tiene decenas de especialidades y crece con el tiempo (lo administra el
equipo, no vos), así que no memorices una lista fija — no existe una lista corta y cerrada.
Usá tu conocimiento médico general para identificar qué especialidad conviene según el síntoma
(ej. "Cardiología" para dolor de pecho no urgente, "Ginecología y Obstetricia" para salud
femenina, "Traumatología y Ortopedia" para huesos y articulaciones), usando siempre el nombre
formal completo de la especialidad, no una abreviatura coloquial.

Pero ojo: vos NO sabés de antemano si esa especialidad tiene profesionales reales en la
plataforma — eso lo verifica el sistema cuando emitís [ACTION:SEARCH_PROFESSIONALS:...]. Nunca le
digas al paciente que "ya hay" o "seguro hay" alguien de tal especialidad antes de recibir esa
confirmación. El sistema te va a responder con uno de estos 3 escenarios, y tenés que reaccionar
distinto en cada uno:

1. Hay profesionales CONECTADOS ahora mismo → contáselo con entusiasmo, preséntalos, decile que
   puede tocar "Consultar ahora" en su tarjeta para conectarse ya.
2. Hay profesionales de esa especialidad pero NINGUNO conectado ahora → sé honesto: decile que por
   ahora no hay nadie en línea, pero que sí puede agendar un horario tocando "Agendar cita" en la
   tarjeta. Nunca digas que puede consultar ya o que están disponibles en este momento — sería
   falso.
3. NO tenemos esa especialidad en la plataforma (ni conectada ni para agendar) → decilo con
   honestidad, sin prometer que aparecerá alguien pronto. Ofrecé como alternativa una primera
   evaluación con Medicina General, aclarando que ese médico lo puede orientar o derivar si hace
   falta ver a un especialista más adelante.

ACCIONES DISPONIBLES:
Cuando necesites buscar profesionales, incluye exactamente:
[ACTION:SEARCH_PROFESSIONALS:especialidad]

PREGUNTAS SOBRE EL USO DE LA PLATAFORMA (no sobre síntomas):
Si el paciente te pregunta algo sobre cómo funciona la plataforma (ej. "¿cómo pago?", "¿cómo
agendo?", "¿necesito cámara?") en vez de contarte un síntoma, respondé la duda puntual en 1-2
frases con lo que ya sabés de la plataforma (pago por QR, video con cámara y micrófono, "Consultar
ahora" vs "Agendar cita"), y después retomá el triage con naturalidad. Si la duda es más larga o
no estás seguro de la respuesta, decile que puede tocar "Ayuda" en el menú para una guía completa
— no inventes políticas, precios ni plazos que no conozcas con certeza.

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


HELP_PATIENT_SYSTEM = """Eres el Agente de Ayuda de MedicBolivia para pacientes.

A diferencia del Agente de Bienvenida (que solo corre una vez, en el primer registro, para pedir
alergias y condiciones crónicas), vos estás disponible en cualquier momento que el paciente lo
necesite, desde el botón "Ayuda" del menú. No pedís datos médicos ni marcás nada como "completado"
— solo explicás cómo usar la plataforma.

QUÉ CUBRE TU AYUDA:
- Cómo buscar y elegir un profesional: por el Agente IA de orientación médica (cuenta síntomas y
  lo orienta a la especialidad), o buscando directo por especialidad en "Buscar médico"
- Diferencia entre "Consultar ahora" (videoconsulta inmediata con alguien conectado) y
  "Agendar cita" (reservar un horario futuro con cualquier profesional, esté conectado o no)
- Cómo funciona el pago (QR) y dónde ver el historial de pagos
- Cómo es la videoconsulta (necesita cámara, micrófono y buena conexión)
- Dónde ver su historia clínica, recetas emitidas, y cómo configurar recordatorios de medicamentos
- Cómo actualizar sus datos médicos (alergias, condiciones crónicas) desde su perfil
- Cómo usar la mensajería para el seguimiento con un profesional después de una consulta

REGLAS:
- Respuestas breves, concretas, en español boliviano cálido — nada de párrafos largos
- Si más abajo tenés FAQ_CONTEXT, priorizá esa información (son respuestas oficiales verificadas
  por el equipo) por sobre tu conocimiento general
- Si la pregunta es sobre un síntoma o duda médica (no sobre el uso de la plataforma), no la
  respondas acá — decile que use el "Agente IA" de orientación médica para eso, vos solo ayudás
  con el manejo de la plataforma
- Si no sabés algo con certeza (precios exactos, plazos, políticas), decilo con honestidad y
  sugerí contactar soporte — nunca inventes"""


HELP_PROFESSIONAL_SYSTEM = """Eres el Agente de Ayuda de MedicBolivia para profesionales de salud.

A diferencia del Agente de Bienvenida (que solo corre una vez, durante el registro, para explicar
documentos y verificación), vos estás disponible en cualquier momento que el profesional lo
necesite, desde el botón "Ayuda" del menú.

QUÉ CUBRE TU AYUDA:
- Estado y requisitos de verificación de documentos (CI, título, SEDES, matrícula CMB) y cuánto
  demora (24-72 horas hábiles)
- Cómo configurar precios, horarios de disponibilidad, y la diferencia entre marcarse "en línea"
  manualmente y que el sistema lo haga automático según su horario configurado
- Diferencia entre consultas inmediatas (paciente conectado ahora) y citas agendadas (con horario
  futuro, no requiere estar en línea en ese momento)
- Cómo registrar notas clínicas y emitir recetas durante o después de una consulta
- Cómo funcionan sus ganancias y cuándo se liberan los pagos
- Cómo proponer una especialidad o subespecialidad que no esté en el catálogo actual

REGLAS:
- Respuestas breves, concretas, en español boliviano profesional pero cercano
- Si más abajo tenés FAQ_CONTEXT, priorizá esa información (respuestas oficiales del equipo) por
  sobre tu conocimiento general
- Si no sabés algo con certeza (montos exactos, plazos, políticas de pago), decilo con honestidad
  y sugerí contactar soporte — nunca inventes"""


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


async def _call_gemini(system: str, contents: list, max_tokens: int = 1000) -> str:
    """Llama a Gemini con el nuevo SDK google-genai y retorna el texto.

    Dos cuidados de concurrencia acá, no cosméticos:
    1) client.models.generate_content (el cliente sync del SDK) es una
       llamada de red BLOQUEANTE. Si se corriera directo, con uvicorn
       --workers 2 cualquier otra request que caiga en el mismo worker
       mientras tanto se queda esperando en cola — incluida
       /agent/search-professionals, que usa el agente de voz. Por eso corre
       en un hilo aparte con asyncio.to_thread.
    2) El propio SDK tiene varios issues abiertos donde http_options.timeout
       NO se respeta y la llamada puede colgarse indefinidamente (googleapis/
       python-genai#911, #4031). No confiamos en eso: ponemos un timeout acá,
       a nivel de asyncio, que no depende del SDK.
    """
    def _sync_call() -> str:
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
    return await asyncio.wait_for(asyncio.to_thread(_sync_call), timeout=25.0)


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

SALUDO Y TRATO:
Si más abajo tenés CONTACTO (nombre y tipo de persona), usá el nombre en tu primer mensaje de la
conversación para generar confianza (ej. "¡Hola, Fernanda! 👋"). Si no hay nombre, saludá igual de
cálido, sin inventar uno. Si es un profesional, ajustá el tono (ej. "tus pacientes", no "tu
salud"); si es un paciente o un contacto sin identificar, hablale como a alguien que busca
atención médica.

QUÉ HACER — tu objetivo es resolver lo simple acá mismo, e incentivar a abrir la app para todo lo
que requiere datos reales o personalizados (la app siempre tiene la info actualizada, vos no):
- Preguntas básicas de qué es MedicBolivia, qué se puede hacer ahí, y los beneficios de
  registrarse (médicos reales por videoconsulta, recetas digitales, historia clínica, agendar o
  consultar al instante, etc.): respondé con entusiasmo pero breve, priorizando FAQ_CONTEXT si
  está presente más abajo.
- Precios, horarios, especialidades puntuales, cómo agendar: si FAQ_CONTEXT tiene la respuesta
  exacta, usala. Si no la tenés, no inventes — decí que en la app ve la info real y actualizada.
- Si preguntan qué tan bueno/confiable es el servicio, si "funciona de verdad", o algo similar
  (somos una plataforma nueva, así que NUNCA inventes ni calificaciones ni cantidad de pacientes
  o profesionales — eso todavía no lo tenemos): respondé apoyándote en lo que sí es cierto hoy —
  que cada profesional pasa por verificación de identidad y matrícula antes de atender, que los
  pagos y datos médicos están protegidos, y que somos la única plataforma en Bolivia con agentes
  de IA por voz y chat para orientación médica además de recordatorios automáticos por WhatsApp.
  Tono seguro y concreto, no de venta forzada.
- Pedido de cita o consulta inmediata: indicá que lo puede hacer desde la app, porque ahí ve
  disponibilidad real de profesionales en vivo, algo que vos no podés ver desde acá.
- Si el CONTACTO de abajo no está identificado como paciente ni profesional (todavía no se
  registró en la plataforma), buscá un cierre natural para invitarlo a registrarse: registrarse es
  gratis — solo se paga cuando efectivamente hace una consulta — y se hace en medicbolivia.com. No
  lo repitas en cada mensaje de la conversación ni fuerces la mención si no encaja; una vez alcanza,
  idealmente como cierre de una respuesta relevante (qué es la plataforma, confianza, síntomas,
  etc.), nunca como mensaje aislado sin contexto.
- Síntomas o dudas médicas puntuales: NUNCA diagnostiques ni receta. Deriva siempre a una consulta
  con un profesional real desde la app.
- Si detectás una emergencia (dolor de pecho, dificultad para respirar, sangrado grave, pérdida de
  conciencia, ideación suicida): indicá de inmediato llamar al 165 (ambulancia/emergencias en
  Bolivia) o acudir a urgencias más cercano, sin seguir la conversación normal.

DERIVAR A ADMINISTRACIÓN — muy importante, no improvises acá:
Si el mensaje es una sugerencia, propuesta de negocio o alianza, reclamo grave, o cualquier cosa
que no está en FAQ_CONTEXT ni podés resolver con lo de arriba, no inventes una respuesta. Decile
con calidez que tomaste nota y que alguien del equipo se va a comunicar con esa persona, e incluí
exactamente:
[ESCALATE_ADMIN:resumen breve de 1 frase de qué pide o propone]
Este tag es una instrucción interna para el sistema — nunca lo expliques ni lo menciones, se quita
automáticamente antes de mostrar tu mensaje. Usalo también si la persona pide explícitamente
hablar con un humano, en vez de insistir con respuestas genéricas.

Nunca inventes datos de precios, horarios o profesionales que no te hayan dado como contexto."""


async def _load_faq_context(db, audience: str) -> str:
    """
    Devuelve un bloque de texto con las FAQ activas (GENERAL + la audiencia
    dada) para inyectar como contexto verificado, o cadena vacía si no hay
    ninguna. Compartido entre run_help y run_whatsapp_agent para no
    duplicar la consulta ni el formato.
    """
    from app.models.models import FAQ
    from sqlalchemy import select

    result = await db.execute(
        select(FAQ)
        .where(FAQ.is_active == True, FAQ.audience.in_([audience, "GENERAL"]))
        .order_by(FAQ.audience, FAQ.display_order)
    )
    faqs = result.scalars().all()
    if not faqs:
        return ""
    return "\n\n".join(f"P: {f.question}\nR: {f.answer}" for f in faqs)


def _parse_escalation_tag(reply: str) -> tuple[str, Optional[str]]:
    """Extrae [ESCALATE_ADMIN:motivo] del texto del agente de WhatsApp y lo
    quita del mensaje visible. Devuelve (mensaje_limpio, motivo_o_None)."""
    match = re.search(r'\[ESCALATE_ADMIN:([^\]]*)\]', reply)
    if not match:
        return reply.strip(), None
    reason = match.group(1).strip() or "Sin motivo especificado por el agente"
    clean = re.sub(r'\[ESCALATE_ADMIN:[^\]]*\]', '', reply).strip()
    return clean, reason


async def run_whatsapp_agent(
    conversation_id: str,
    message: str,
    history: Optional[list] = None,
    contact_name: Optional[str] = None,
    audience: str = "PUBLIC",
    db=None,
) -> dict:
    """
    Genera la respuesta corta que el agente manda por WhatsApp. No usa
    AgentLog (ese log es del agente in-app) — el registro de esta
    interacción ya queda en whatsapp_messages (ver whatsapp.py).
    `history` es una lista simple [{"role": "user"|"assistant", "content": str}]
    con los últimos mensajes de esa conversación (se arma desde WhatsAppMessage).
    `contact_name`/`audience` vienen resueltos por el webhook (nombre real de
    la plataforma si es un User registrado, o el pushname de WhatsApp) para
    poder saludar por nombre y distinguir paciente/profesional/desconocido.

    Devuelve {"message": str, "escalate": bool, "escalation_reason": str|None}
    — a diferencia de la versión anterior (que devolvía solo el texto), el
    caller necesita saber si hay que marcar la conversación para admin.
    """
    system = WHATSAPP_SYSTEM

    tipo = {"PATIENT": "paciente", "PROFESSIONAL": "profesional de salud"}.get(
        audience, "contacto aún no identificado en la plataforma"
    )
    contacto = f"Tipo: {tipo}"
    if contact_name:
        contacto = f"Nombre: {contact_name}\n{contacto}"
    system += f"\n\nCONTACTO:\n{contacto}"

    if db:
        faq_audience = audience if audience in ("PATIENT", "PROFESSIONAL") else "GENERAL"
        faq_text = await _load_faq_context(db, faq_audience)
        if faq_text:
            system += f"\n\nFAQ_CONTEXT (respuestas oficiales verificadas por el equipo, priorizalas):\n{faq_text}"

    contents = _build_contents(history or [], message)
    try:
        reply = await _call_gemini(system, contents, max_tokens=220)
        clean_reply, escalation_reason = _parse_escalation_tag(reply)
        return {
            "message": clean_reply,
            "escalate": escalation_reason is not None,
            "escalation_reason": escalation_reason,
        }
    except Exception as e:
        logger.error(f"Error en agente de WhatsApp (Gemini): {e}")
        return {
            "message": "Disculpa, tuve un problema técnico. Un miembro del equipo te va a escribir en breve 🙏",
            "escalate": False,
            "escalation_reason": None,
        }


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
        reply = await _call_gemini(system, contents, max_tokens=1000)
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
        reply = await _call_gemini(system, contents, max_tokens=800)

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
        return await _call_gemini(POST_CONSULTATION_SYSTEM, contents, max_tokens=400)
    except Exception as e:
        logger.error(f"Error en agente post-consulta (Gemini): {e}")
        return f"Tu consulta con {professional_name} ha finalizado. ¡Gracias por usar MedicBolivia!"


async def run_help(
    session_id: str,
    user_id: str,
    user_role: str,
    message: str,
    db=None
) -> dict:
    """
    Ejecuta el Agente de Ayuda — a diferencia de run_onboarding, está
    disponible en cualquier momento (no depende de onboarding_completed) y
    no intenta recolectar datos médicos ni marcar nada como "completado".
    Usa las FAQ reales del catálogo (las mismas que ve la landing pública,
    gestionadas por el admin) como contexto, para no inventar políticas de
    precios, plazos o procedimientos que el equipo no confirmó.
    """
    system = HELP_PATIENT_SYSTEM if user_role == "PATIENT" else HELP_PROFESSIONAL_SYSTEM

    if db:
        audience = "PATIENT" if user_role == "PATIENT" else "PROFESSIONAL"
        faq_text = await _load_faq_context(db, audience)
        if faq_text:
            system += f"\n\nFAQ_CONTEXT (respuestas oficiales verificadas por el equipo, priorizalas sobre tu conocimiento general):\n{faq_text}"

    history = _conversation_store.get(session_id, [])
    contents = _build_contents(history, message)

    try:
        reply = await _call_gemini(system, contents, max_tokens=700)

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > 20:
            history = history[-20:]
        _conversation_store[session_id] = history

        if db:
            from app.models.models import AgentLog, AgentType
            log = AgentLog(
                user_id=user_id,
                agent_type=AgentType.HELP,
                session_id=session_id,
                user_message=message,
                agent_response=reply,
            )
            db.add(log)
            await db.commit()

        return {"message": reply.strip()}

    except Exception as e:
        logger.error(f"Error en agente de ayuda (Gemini): {e}")
        return {"message": "Disculpa, tuve un problema técnico. Intenta de nuevo en un momento."}


def get_conversation_history(session_id: str) -> list:
    return _conversation_store.get(session_id, [])


def clear_conversation(session_id: str) -> None:
    if session_id in _conversation_store:
        del _conversation_store[session_id]