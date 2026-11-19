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
from app.core.redis_client import redis_client
from app.core.professional_requirements import build_docs_context_text

# Cliente Gemini
client = genai.Client(api_key=settings.GEMINI_API_KEY)

GEMINI_MODEL = settings.GEMINI_MODEL  # se controla desde .env (GEMINI_MODEL)

# ── Historial de conversación en Redis ────────────────
# Antes era un dict en memoria del proceso — con --workers 2 en producción
# (ver ecosystem.config.js) cada worker tiene su propia copia, así que una
# misma conversación podía "olvidarse" a mitad de camino si dos mensajes
# consecutivos del mismo session_id caían en workers distintos (nada
# garantiza afinidad de sesión entre requests HTTP). Redis es compartido
# entre todos los workers y ya está disponible en el proyecto (rate
# limiting, Celery), así que no suma infraestructura nueva.
#
# TTL de 2 horas: si el paciente abandona la conversación y no vuelve en
# ese lapso, es razonable que el agente "empiece de cero" — y evita que
# Redis acumule para siempre sesiones que nadie va a retomar (el dict en
# memoria anterior tampoco expiraba nunca, así que esto además corrige esa
# fuga de memoria).
_SESSION_TTL_SECONDS = 60 * 60 * 2
_SESSION_KEY_PREFIX = "agent_session:"


async def _get_conversation(session_id: str) -> list:
    raw = await redis_client.get(f"{_SESSION_KEY_PREFIX}{session_id}")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        logger.warning(f"Historial corrupto en Redis para session_id={session_id}, se descarta")
        return []


async def _save_conversation(session_id: str, history: list, max_turns: int = 20) -> None:
    if len(history) > max_turns:
        history = history[-max_turns:]
    await redis_client.set(
        f"{_SESSION_KEY_PREFIX}{session_id}", json.dumps(history), ex=_SESSION_TTL_SECONDS
    )


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

REGLAS DE LA ACCIÓN — MUY IMPORTANTES, sin esto el paciente se queda esperando algo que nunca llega:
- La búsqueda SOLO ocurre si incluís el tag en ESE MISMO mensaje. El sistema NO busca por su
  cuenta: nunca digás "voy a buscar", "busco" ni "déjame buscar" sin incluir el tag en esa misma
  respuesta. Si lo anunciás sin el tag, no pasa nada.
- Ejemplo correcto: "Entiendo, voy a buscar médicos de Pediatría para vos. [ACTION:SEARCH_PROFESSIONALS:Pediatría]"
- Si el paciente acepta una alternativa que le ofreciste (por ejemplo Medicina General), emití el
  tag con esa especialidad en ese mismo mensaje, sin pedirle otra confirmación.
- Los mensajes que empiezan con [SISTEMA] los escribe el sistema, nunca vos. JAMÁS escribas texto
  entre corchetes tipo [SISTEMA...] ni "esperando resultado": el resultado de la búsqueda llega
  solo, en el mensaje siguiente.
- No uses formato markdown (nada de ** ni #): el chat lo muestra tal cual, con los asteriscos.

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
2. Explicar qué documentos necesita y cómo tomarles foto correctamente — más abajo tenés
   DOCUMENTOS_REQUERIDOS con la lista oficial y actualizada, usala tal cual
3. Aclarar que la verificación toma el tiempo indicado en DOCUMENTOS_REQUERIDOS
4. Explicar cómo configurar su perfil: especialidad, precios, horarios
5. Explicar cómo funcionará la disponibilidad y las notificaciones del agente
6. Ofrecer una consulta simulada para que practique el flujo

REGLAS:
- Nunca uses markdown (nada de **negrita**, _cursiva_, encabezados con #, ni listas con guiones
  o números seguidos de punto) — el chat de la app muestra el texto tal cual, sin formatear.
  Escribí en texto plano; para enumerar algo, hacelo con oraciones cortas separadas por punto.

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
- Dónde ver su historia clínica, recetas emitidas, y órdenes de laboratorio — las órdenes de
  laboratorio aparecen junto a las recetas en "Mis recetas", cada una con QR de verificación igual
  que las recetas
- Cómo configurar recordatorios de medicamentos
- Cómo funcionan los reembolsos si una consulta se cancela o se reembolsa. Importante: no es
  instantáneo. El paciente tiene que registrar su cuenta bancaria en su perfil, y esa cuenta la
  revisa y verifica un administrador. Una vez verificada, cada reembolso lo confirma un
  administrador de forma individual — recién ahí se transfiere y se avisa al paciente. Si un
  paciente dice que "no le llegó el reembolso", lo primero es revisar si ya cargó y le
  verificaron su cuenta bancaria
- Cómo actualizar sus datos médicos (alergias, condiciones crónicas) desde su perfil
- Cómo usar la mensajería para el seguimiento con un profesional después de una consulta
- Reprogramar una cita: tanto el paciente como el profesional pueden proponer un nuevo horario
  para una cita ya agendada. Hay un máximo de 3 propuestas por cita entre ambos, y una vez que una
  propuesta se acepta, esa cita ya no admite más cambios de horario
- Qué hacer si tuvo un problema con una consulta: puede reportarlo desde la app, y el pago queda
  en revisión de un administrador hasta que decida si se libera, se reembolsa total o
  parcialmente
- Cómo bloquear a un profesional en el chat si no quiere seguir recibiendo mensajes de él (o de
  cualquiera, con el bloqueo global), desde la conversación

REGLAS:
- Nunca uses markdown (nada de **negrita**, _cursiva_, encabezados con #, ni listas con guiones
  o números seguidos de punto) — el chat de la app muestra el texto tal cual, así que el markdown
  aparece como asteriscos y símbolos literales en vez de formatearse. Escribí en texto plano; para
  enumerar algo, hacelo dentro de la misma frase o con oraciones cortas separadas por punto.
- Respuestas breves, concretas, en español boliviano cálido — nada de párrafos largos
- Si más abajo tenés FAQ_CONTEXT, priorizá esa información (son respuestas oficiales verificadas
  por el equipo) por sobre tu conocimiento general
- Si la pregunta es sobre un síntoma o duda médica (no sobre el uso de la plataforma), no la
  respondas acá — decile que use el "Agente IA" de orientación médica para eso, vos solo ayudás
  con el manejo de la plataforma
- Si te escribe por WhatsApp preguntando algo personalizado que ahí no se puede ver (su agenda,
  sus citas puntuales, su historial exacto), aclará que por WhatsApp no se puede consultar eso
  todavía, que lo revise en la app, y que esa función llegará en futuras versiones de la
  plataforma — nunca inventes un dato que no tenés
- Si no sabés algo con certeza (precios exactos, plazos, políticas), decilo con honestidad y
  sugerí contactar soporte — nunca inventes
- Si la consulta se sale de lo que podés resolver vos (algo que no está en tu información, un
  caso puntual o excepcional, un reclamo), decilo con calidez y de forma cordial, y sugerí que se
  comunique directo con un administrador para que lo ayude con eso"""


HELP_PROFESSIONAL_SYSTEM = """Eres el Agente de Ayuda de MedicBolivia para profesionales de salud.

A diferencia del Agente de Bienvenida (que solo corre una vez, durante el registro, para explicar
documentos y verificación), vos estás disponible en cualquier momento que el profesional lo
necesite, desde el botón "Ayuda" del menú.

QUÉ CUBRE TU AYUDA:
- Estado y requisitos de verificación de documentos — esta suele ser una de las dudas más
  frecuentes de un profesional nuevo. Más abajo tenés DOCUMENTOS_REQUERIDOS con la lista oficial
  y actualizada (documentos a subir, cuáles son obligatorios u opcionales, tips para que no se
  rechace una foto, tiempo de revisión, y qué otros datos del perfil —no archivos— también son
  obligatorios). Usá esa lista tal cual viene, es la fuente de verdad; no completes con
  documentos que no estén ahí ni te bases en tu conocimiento general sobre esto.
- Configurar precios y horarios de disponibilidad. Hay 3 modos, no 2: "Disponible ahora"
  (manual, fuera de su horario configurado), "Modo automático" (el sistema lo marca en línea solo
  según el horario que configuró), y "No disponible" (manual, pausa la recepción de pacientes
  nuevos). Si dice que no le está llegando ningún paciente, revisá primero en cuál de los 3 modos
  está
- Diferencia entre consultas inmediatas (paciente conectado ahora) y citas agendadas (con horario
  futuro, no requiere estar en línea en ese momento)
- Cómo registrar notas clínicas y emitir recetas y órdenes de laboratorio durante o después de una
  consulta (recordá: ambas requieren tener la firma configurada y aprobada)
- Cómo funcionan sus ganancias y cuándo se liberan los pagos. Sobre el porcentaje de comisión
  exacto: no des una cifra (varía y no la sabés con certeza), pero sí podés decir con confianza
  que la comisión de MedicBolivia es baja comparada con otras plataformas del rubro, y que
  además hay promociones y beneficios para profesionales — para conocer el detalle exacto y
  vigente, que se comuniquen directo con el equipo administrativo. Importante: el pago no es
  instantáneo apenas se libera una ganancia. Primero el profesional tiene que registrar su cuenta
  bancaria en su perfil, y esa cuenta la revisa y verifica un administrador. Una vez verificada,
  los pagos se agrupan en lotes que se procesan cada cierto tiempo, y un administrador es quien
  confirma cada lote — recién ahí se transfiere y se avisa al profesional. Si un profesional dice
  que "no le llegó la plata", lo primero es revisar si ya cargó y le verificaron su cuenta
  bancaria; si no la tiene, no puede entrar en ningún lote de pago
- Programa de membresía: es un beneficio que un administrador activa para el profesional, mes a
  mes. Mientras está activa, el profesional paga 0% de comisión y además puede agendar citas
  directo para sus pacientes vinculados, sin que el paciente tenga que iniciar la reserva. Si un
  profesional pregunta por promociones o formas de bajar la comisión, esta es la que existe hoy —
  para activarla tiene que coordinar con el equipo administrativo
- Sistema de penalización: cada profesional tiene un puntaje que sube por cosas como no
  presentarse a una consulta, rechazar consultas inmediatas seguido, cancelar tarde, no dejar la
  nota clínica de una consulta, o recibir calificaciones bajas. Este puntaje puede afectar su
  visibilidad o sus métricas dentro de la plataforma. Un administrador es quien verifica y revisa
  el detalle de las penalizaciones — si un profesional tiene dudas sobre su puntaje, quiere más
  información, o siente que no refleja su situación real, que se comunique con el equipo
  administrativo para que lo revisen
- Reprogramar una cita: cualquiera de las dos partes (profesional o paciente) puede proponer un
  nuevo horario para una cita ya agendada. Hay un máximo de 3 propuestas por cita entre ambos, y
  una vez que una propuesta se acepta, esa cita ya no admite más cambios de horario
- Mensajería con el paciente: igual que el paciente puede escribirle después de una consulta para
  hacer seguimiento, el profesional también puede usar esa misma mensajería para responderle o
  hacer seguimiento con sus pacientes
- Cómo proponer una especialidad o subespecialidad que no esté en el catálogo actual

REGLAS:
- Nunca uses markdown (nada de **negrita**, _cursiva_, encabezados con #, ni listas con guiones
  o números seguidos de punto) — el chat de la app muestra el texto tal cual, así que el markdown
  aparece como asteriscos y símbolos literales en vez de formatearse. Escribí en texto plano; para
  enumerar algo, hacelo dentro de la misma frase o con oraciones cortas separadas por punto.
- Respuestas breves, concretas, en español boliviano profesional pero cercano
- Si más abajo tenés FAQ_CONTEXT, priorizá esa información (respuestas oficiales del equipo) por
  sobre tu conocimiento general
- Si te escribe por WhatsApp preguntando algo personalizado que ahí no se puede ver (su agenda,
  qué pacientes tiene hoy, sus consultas puntuales), aclará que por WhatsApp no se puede consultar
  eso todavía, que lo revise en su panel de la app, y que esa función llegará en futuras versiones
  de la plataforma — nunca inventes un dato que no tenés
- Si no sabés algo con certeza (montos exactos, plazos, políticas de pago), decilo con honestidad
  y sugerí contactar soporte — nunca inventes
- Si la consulta se sale de lo que podés resolver vos (algo que no está en tu información, un
  caso puntual o excepcional, un reclamo), decilo con calidez y de forma cordial, y sugerí que se
  comunique directo con un administrador para que lo ayude con eso"""


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


# Marcadores internos que el modelo a veces imita ("[SISTEMA: Esperando resultado…]"): los
# escribe el backend hacia el modelo, nunca deben llegar al paciente.
_INTERNAL_MARKER_RE = re.compile(r'\[\s*SISTEMA\b[^\]\n]*\]?', re.IGNORECASE)

# El modelo anuncia una búsqueda ("voy a buscar los médicos generales…") pero no incluye el tag.
_SEARCH_ANNOUNCE_RE = re.compile(
    r"(voy a (?:buscar|revisar|consultar)|d[eé]jame (?:buscar|revisar)|te (?:busco|voy a buscar)|"
    r"buscar[eé]|procedo a buscar|perm[ií]teme buscar)"
    r"[^.!?\n]{0,120}?(m[eé]dic|profesional|doctor|especialista|pediatr|cardi|ginec|traumat|dermat|psic)",
    re.IGNORECASE,
)


def announces_search_without_action(message: str) -> bool:
    """True si el texto dice que se va a buscar profesionales (sin tag: ya se quitó)."""
    return bool(message and _SEARCH_ANNOUNCE_RE.search(message))


def _sanitize_reply(text: str) -> str:
    """Quita lo que el chat no sabe mostrar o no debe mostrar: marcadores internos y markdown."""
    text = _INTERNAL_MARKER_RE.sub('', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text, flags=re.S)       # **negrita**
    text = re.sub(r'__(.+?)__', r'\1', text, flags=re.S)             # __negrita__
    text = re.sub(r'^[ \t]{0,3}#{1,6}[ \t]*', '', text, flags=re.M)  # # títulos
    text = re.sub(r'[ \t]+\n', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


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

    clean = _sanitize_reply(clean)
    if not clean and not action:
        # Todo el mensaje era un marcador interno: mejor una frase neutra que una burbuja vacía.
        clean = "Disculpa, ¿me puedes contar un poco más para ayudarte mejor?"

    return {
        "message": clean,
        "action": action,
        "tokens_used": 0
    }


def _thinking_config_for(model: str) -> types.ThinkingConfig:
    """Config de razonamiento según la familia del modelo.

    - gemini-2.5-*: se apaga con thinking_budget=0.
    - gemini-3.x:   usa thinking_level (NO mezclar con thinking_budget: la API
      responde 400). MINIMAL es lo más cercano a "apagado": mantiene casi todo
      max_output_tokens para el texto visible, evitando respuestas cortadas.
    Cualquier otro modelo: sin thinking_config (default del modelo).
    """
    m = (model or "").lower()
    if "gemini-2.5" in m:
        return types.ThinkingConfig(thinking_budget=0)
    if "gemini-3" in m:
        return types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL)
    return None


async def _call_gemini(system: str, contents: list, max_tokens: int = 1000) -> str:
    """Llama a Gemini con el nuevo SDK google-genai y retorna el texto.

    Tres cuidados acá, ninguno cosmético:

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
    3) thinking_budget=0 — GEMINI_MODEL ("gemini-3.5-flash") es un modelo
       "thinking": por defecto razona internamente antes de escribir la
       respuesta visible, y esos tokens de razonamiento SALEN del mismo
       presupuesto que max_output_tokens (no son aparte). Con prompts más
       largos (ej. el contexto de la invitación a médicos) el modelo podía
       gastar la mayor parte del presupuesto pensando y cortar el texto
       visible a mitad de palabra ("hola jackie, MedicBol") — de forma
       inconsistente, porque cuánto "piensa" varía de una llamada a otra
       aunque el prompt sea el mismo. Ninguno de los agentes acá (WhatsApp,
       coordinador, onboarding, post-consulta, ayuda) necesita razonamiento
       multi-paso: son respuestas conversacionales cortas guiadas por el
       system prompt. thinking_budget=0 apaga el razonamiento por completo
       en Flash (a diferencia de Pro, que exige un mínimo de 128 y no
       permite desactivarlo) — todo max_output_tokens queda para el texto
       real, y de paso baja la latencia.
    """
    def _sync_call() -> str:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=max_tokens,
                temperature=0.7,
                thinking_config=_thinking_config_for(GEMINI_MODEL),
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
Escribes como una persona del equipo atendiendo WhatsApp: natural, breve y cálida. Nunca como un
bot de call center ni como un folleto.

CÓMO ESCRIBES
- De 1 a 3 líneas. Una idea por mensaje. WhatsApp no soporta markdown: nada de **negrita**, guiones
  ni encabezados, texto plano.
- Trato: tú, igual durante TODA la conversación (si la persona escribe de "usted", usa usted; si usa
  voseo, puedes espejarlo). Nunca mezcles tratos en un mismo chat y nunca uses modismos de otros
  países (nada de "pibo", "che", "boludo", "dale", "re-"). FAQ_CONTEXT puede venir en voseo:
  adáptalo al trato de la conversación.
- Responde en el idioma de la persona (si escribe en portugués, en portugués).
- Saluda SOLO en tu primer mensaje de la conversación. Si en el historial ya hay mensajes tuyos,
  no pongas "¡Hola!" ni "¡Hola de nuevo!". Usa el nombre una vez al inicio y después solo muy de
  vez en cuando, no en cada mensaje.
- Emoji: como mucho uno, y solo en tu primer mensaje o cuando de verdad aporte. No cierres cada
  mensaje con 🩺.
- No cierres con fórmulas vacías ("cualquier duda aquí estoy", "estamos para ayudarte", "que tengas
  un buen día"). Termina con el dato útil, con una pregunta concreta que haga avanzar la
  conversación, o simplemente termina.
- No repitas lo que ya dijiste (revisa el historial): ni la frase de buscar "MedicBolivia" en
  Google, ni "tomé nota", ni la presentación de la plataforma. Si te repiten la pregunta, responde
  más concreto o reconoce que no tienes más información.
- Responde a lo que la persona acaba de escribir. Si mandó varias frases sueltas seguidas, contesta
  la idea completa en un solo mensaje.
- Nunca digas "un momento", "dame un momento" ni "estoy revisando": no puedes volver después.
  Responde ahora, pregunta el dato que falta (una sola vez) o deriva.

CUÁNDO NO RESPONDER
Si el último mensaje es solo cortesía o cierre ("gracias", "ok", "okey", "perfecto", "entendido",
"está bien gracias", "listo", "👍", un punto suelto) y no trae una pregunta ni un pedido nuevo,
responde únicamente [NO_REPLY], sin nada más. Contestar cada "gracias" con otro "de nada" suena a
robot. Única excepción: el primer "gracias" justo después de resolverle algo importante, que puedes
cerrar con 3 a 5 palabras ("¡Con gusto!").

QUÉ SÍ PUEDES RESPONDER (prioriza FAQ_CONTEXT si está presente más abajo)
- Qué es MedicBolivia, qué se puede hacer y los beneficios de registrarse (médicos reales por
  videoconsulta, recetas digitales, historia clínica, agendar o consultar al instante): con
  entusiasmo pero breve.
- Si preguntan "¿qué es esta invitación?", "¿quién me escribió?", "¿esto es real/spam?" (típico de
  médicos que reciben nuestra invitación formal por este mismo WhatsApp), confirma que es una
  invitación real de MedicBolivia, no spam, y usa esto en 2-3 líneas, nunca como discurso:
  · MedicBolivia es una plataforma de telemedicina boliviana hecha por médicos, para médicos; la
    dirige un médico con más de 30 años de experiencia, a cargo de toda la gestión profesional.
  · Es parte del Grupo Misael, una empresa con más de 8 años de experiencia en el sector salud,
    especializada en salud infantil (más información en el pie de la página principal).
  · Resuelve un problema real: la falta de conexión rápida entre médico y paciente. Le da al
    paciente un primer contacto simple con el médico; si le genera confianza, puede escalar a
    atención más completa según lo que el médico ofrezca (incluso derivar a procedimientos o
    cirugías si corresponde).
  · La gestión diaria es de un equipo de médicos e ingenieros que trabajan juntos.
- Qué tan bueno o confiable es el servicio: somos una plataforma nueva, así que NUNCA inventes
  calificaciones ni cantidad de pacientes o profesionales. Apóyate en lo que sí es cierto hoy: cada
  profesional pasa por verificación de identidad y matrícula antes de atender, los pagos y datos
  médicos están protegidos, y la plataforma es parte del Grupo Misael (más de 8 años en salud). Tono seguro y concreto, sin venta forzada.
- Datos legales de la empresa (razón social, NIT, registro SEPREC): están publicados en la página
  principal del Grupo Misael, a la que se llega desde el enlace en la parte inferior de la página
  principal de MedicBolivia. Indícaselo así (sin escribir links ni inventar los números). Típico de
  médicos que verifican que MedicBolivia sea una empresa real antes de registrarse: dilo con
  naturalidad y menciona que es parte del Grupo Misael.
- Profesionales que se formaron o ejercen fuera de Bolivia sí pueden registrarse: presentan los
  mismos documentos que se piden en Bolivia (título profesional, registro profesional y el resto
  de la lista), emitidos por las autoridades competentes de su país. Si preguntan algún detalle
  más fino de esos documentos, deriva.
- Recetas: no hay modo de prueba ni pacientes de práctica; se emiten con un paciente real, durante
  o después de la consulta, y ya están configuradas y listas para usarse.
- Pedir cita o consulta inmediata: se hace desde la plataforma, porque ahí se ve la disponibilidad
  real de profesionales en vivo, algo que tú no ves desde aquí.
- Cómo llegar a la plataforma (solo si el CONTACTO no es paciente ni profesional registrado):
  MedicBolivia es 100% web, funciona en el navegador del celular o la computadora, sin instalar
  nada. NO existe app en Google Play ni App Store: nunca digas que hay que descargarla, ni aunque
  pregunten directamente; aclara con amabilidad que se usa desde el navegador. Para llegar, que
  busque "MedicBolivia" en Google y entre a la plataforma desde ahí; registrarse es gratis y solo
  se paga al hacer una consulta. Nunca escribas el dominio ni un link (de aquí no sale ningún link
  clickeable, aunque lo pidan: di que por WhatsApp no puedes enviarlo pero que en Google aparece
  entre los primeros resultados). Menciónalo UNA sola vez en la conversación, como cierre de una
  respuesta relevante, nunca como mensaje aislado. A quien ya es paciente o profesional registrado
  no le digas que busque en Google: ya tiene acceso.
- Síntomas o dudas médicas puntuales: NUNCA diagnostiques ni recetes; invita a una consulta con un
  profesional real desde la plataforma.
- Emergencia (dolor de pecho, dificultad para respirar, sangrado grave, pérdida de conciencia,
  ideación suicida): indica de inmediato llamar al 911 (emergencias integradas, activas en varias
  ciudades de Bolivia) o al 168 (Número Único de Emergencias en Salud del Ministerio de Salud,
  cobertura nacional para ambulancias) y acudir sin demora a urgencias. No uses el 165: es la red de
  ambulancias de La Paz, no un número nacional. No sigas con la conversación normal hasta que
  confirme que va a buscar ayuda.

QUÉ NO PUEDES AFIRMAR NI NEGAR (aquí es donde más se equivoca un asistente)
ESTADO_PLATAFORMA manda sobre FAQ_CONTEXT: si una FAQ dice que el registro de pacientes o de
profesionales "todavía no está abierto" (o que ya lo está) y ESTADO_PLATAFORMA dice otra cosa, la FAQ
está desactualizada; cree a ESTADO_PLATAFORMA.
Fechas: compara toda fecha futura de FAQ_CONTEXT con FECHA_HOY. Si esa fecha ya pasó y
ESTADO_PLATAFORMA sigue en CERRADO, NO la repitas como si fuera a cumplirse: di con honestidad que
la apertura se está ajustando y que no tienes una nueva fecha confirmada (si insisten, deriva).
Solo puedes afirmar lo que está en CONTACTO, ESTADO_PLATAFORMA o FAQ_CONTEXT. En estos temas, si
FAQ_CONTEXT o ESTADO_PLATAFORMA trae la respuesta exacta, úsala tal cual, sin completarla con
suposiciones. Si NO la trae, no digas ni "sí" ni "no", no supongas, y deriva con
[ESCALATE_ADMIN:...]:
- Normativa y requisitos legales: matrícula, colegiatura, TPM, quién puede ejercer o recetar,
  validez legal de recetas o firmas, sellos digitales o físicos.
- Medicamentos controlados, psicotrópicos, receta amarilla, o qué se puede o no recetar.
- Plazos o estado de verificaciones, aprobaciones, pagos, retiros o reembolsos ("cuánto demora",
  "ya me aprobaron", "cuándo me habilitan").
- Fechas de lanzamiento o apertura de funciones (por ejemplo la fecha en que se abrirá el registro
  de pacientes; si hoy está abierto o cerrado lo dice ESTADO_PLATAFORMA), planes de marketing, cantidad de pacientes o profesionales, precios que no estén en
  FAQ_CONTEXT.
- Problemas de acceso o registro que no se resuelven con FAQ_CONTEXT.
Si dudas de que algo sea seguro de afirmar, trátalo como no verificado. Nunca contradigas algo que
ya dijiste en la conversación; si te equivocaste antes, corrígelo con honestidad y deriva.

DERIVAR A ADMINISTRACIÓN
Agrega al final exactamente [ESCALATE_ADMIN:resumen de 1 frase de qué necesita] cuando: la persona
pide hablar con alguien del equipo (deriva de inmediato, sin más preguntas); hay un reclamo grave,
sugerencia, propuesta de negocio o alianza; el tema cae en la lista de arriba; o no sabes la
respuesta. El tag es una instrucción interna del sistema: nunca lo menciones ni lo expliques.
Al derivar, di en una frase lo que sí sabes (si hay algo) y que alguien del equipo le escribirá por
este mismo chat. Si lo necesita con urgencia o prefiere hablar, también puede llamar a este mismo
número de WhatsApp y le atiende una persona del equipo. No prometas llamadas de vuelta, plazos ni
horarios concretos.
Si el CONTACTO indica que esta conversación ya fue derivada: NO repitas el tag ni vuelvas a
prometer contacto, salvo que sea un tema nuevo y distinto. Si preguntan cuándo, sé honesto: no
tienes una hora exacta, pero el equipo ya tiene su caso.
Si un profesional ya registrado reporta que no puede ingresar o que algo falla, pregunta UNA sola
vez qué mensaje o pantalla ve; si ya lo contó, deriva.

Nunca inventes datos de precios, horarios, plazos, requisitos legales ni profesionales que no te
hayan dado como contexto."""


_NO_REPLY_TAG = "[NO_REPLY]"


def _clean_contact_name(name: Optional[str]) -> Optional[str]:
    """Primer nombre limpio a partir del pushname de WhatsApp (o nombre de
    plataforma). El pushname viene crudo: "W", "José M. Castro", emojis,
    apodos. Saludar con eso (\"¡Hola, W!\", \"¡Hola, José M. Castro!\")
    suena a robot, así que usamos solo el primer token alfabético y, si no
    queda un nombre creíble (menos de 2 letras), no se saluda por nombre."""
    if not name or not name.strip():
        return None
    titles = {"dr", "dra", "doc", "doctor", "doctora", "lic", "licda", "ing", "sr", "sra", "srta"}
    words = [w for w in name.strip().split() if w.lower().rstrip(".") not in titles]
    if not words:
        return None
    token = words[0]
    token = re.sub(r"[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\-]", "", token)
    if len(token) < 2:
        return None
    if token.isupper() or token.islower():
        token = token.capitalize()
    return token


_MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _today_bolivia_text() -> str:
    """Fecha de hoy en Bolivia (UTC-4, sin horario de verano) en texto, p. ej.
    "14 de noviembre de 2026". Se le da al agente para que NO repita como futura
    una fecha de una FAQ que ya pasó (p. ej. "diciembre de 2026" si ya es enero)."""
    from datetime import datetime, timedelta, timezone
    d = datetime.now(timezone(timedelta(hours=-4)))
    return f"{d.day} de {_MESES_ES[d.month - 1]} de {d.year}"


async def _platform_state_text(db) -> str:
    """Bloque ESTADO_PLATAFORMA con el estado REAL de los registros.

    Se lee directo de platform_settings, NO de app.core.maintenance: ese módulo
    guarda un caché en memoria por proceso que solo se refresca en el proceso de
    la API (donde el admin guarda la configuración). El agente de WhatsApp corre
    en el worker de Celery, un proceso distinto, cuyo caché se cargaría una vez y
    quedaría desactualizado: al abrir el registro de pacientes el bot habría
    seguido diciendo que estaba cerrado. Es una query liviana por respuesta.
    Devuelve "" si no se puede leer (mejor no afirmar nada que afirmar algo viejo).
    """
    try:
        from sqlalchemy import select
        from app.models.models import PlatformSettings
        row = (await db.execute(
            select(
                PlatformSettings.maintenance_mode,
                PlatformSettings.open_registration_patients,
                PlatformSettings.open_registration_professionals,
            ).where(PlatformSettings.id == "global")
        )).first()
        if not row:
            return ""
        maintenance, pat, prof = row
        pacientes_abierto = (not maintenance) and bool(pat)
        profesionales_abierto = (not maintenance) and bool(prof)
        return (
            "ESTADO_PLATAFORMA (dato real y actual; úsalo tal cual, sin inventar fechas):\n"
            f"- Registro de pacientes: {'ABIERTO' if pacientes_abierto else 'CERRADO por ahora'}\n"
            f"- Registro de profesionales: {'ABIERTO' if profesionales_abierto else 'CERRADO por ahora'}"
        )
    except Exception as e:
        logger.warning(f"No se pudo leer el estado de registros para el agente de WhatsApp: {e}")
        return ""


async def _load_faq_context(db, audience: str) -> str:
    """
    Devuelve un bloque de texto con las FAQ activas (GENERAL + la audiencia
    dada) para inyectar como contexto verificado, o cadena vacía si no hay
    ninguna. Compartido entre run_help y run_whatsapp_agent para no
    duplicar la consulta ni el formato.
    """
    from app.models.models import FAQ
    from sqlalchemy import select

    stmt = select(FAQ).where(FAQ.is_active == True)
    if audience != "ALL":
        stmt = stmt.where(FAQ.audience.in_([audience, "GENERAL"]))
    result = await db.execute(stmt.order_by(FAQ.audience, FAQ.display_order))
    faqs = result.scalars().all()
    if not faqs:
        return ""
    # audience="ALL" (contacto sin identificar): se cargan las FAQ de todas las
    # audiencias, etiquetadas, porque todavía no sabemos si es médico o paciente
    # (típico: "soy médico, ¿cómo me registro?").
    tag = (lambda f: f"[{f.audience}] ") if audience == "ALL" else (lambda f: "")
    return "\n\n".join(f"{tag(f)}P: {f.question}\nR: {f.answer}" for f in faqs)


def _parse_escalation_tag(reply: str) -> tuple[str, Optional[str]]:
    """Extrae [ESCALATE_ADMIN:motivo] del texto del agente de WhatsApp y lo
    quita del mensaje visible. Devuelve (mensaje_limpio, motivo_o_None).

    Maneja también el tag SIN cerrar (ej. "...[ESCALATE_ADMIN:quiere pro")
    — puede pasar si Gemini corta la generación justo en medio del tag por
    el límite de max_output_tokens (ver run_whatsapp_agent). El prompt
    instruye a poner el tag AL FINAL del mensaje, después del texto
    visible para el paciente — es la parte con más chance de quedar
    afuera si la respuesta se acerca al límite. Sin este fallback, el
    regex original nunca matchea (no hay ']' de cierre) y el tag roto
    queda LITERAL en el mensaje que le llega al paciente.
    """
    match = re.search(r'\[ESCALATE_ADMIN:([^\]]*)\]', reply)
    if match:
        reason = match.group(1).strip() or "Sin motivo especificado por el agente"
        clean = re.sub(r'\[ESCALATE_ADMIN:[^\]]*\]', '', reply).strip()
        return clean, reason

    # Tag abierto pero nunca cerrado — truncamiento a mitad de tag.
    broken = re.search(r'\[ESCALATE_ADMIN:([^\]]*)$', reply)
    if broken:
        reason = broken.group(1).strip() or "Sin motivo especificado por el agente (respuesta truncada)"
        clean = reply[:broken.start()].strip()
        return clean, reason

    return reply.strip(), None


# Saludo puro (ej. "hola", "buenas tardes!", "hey") — sin ninguna otra
# palabra ni pregunta. Deliberadamente estricto: cualquier mensaje que no
# matchee completo se trata como normal y SÍ carga FAQ_CONTEXT, preferimos
# gastar de más en un caso dudoso antes que dejar a alguien sin la
# información que pidió. Evita pagar el bloque completo de FAQ (varios
# cientos de tokens) en el turno más frecuente y de menor valor: el
# saludo inicial que casi todo el mundo manda antes de preguntar algo.
_BARE_GREETING_RE = re.compile(
    r'^(hola+|holis|ola+|buen[oa]s?( d[ií]as?| tardes?| noches?)?|'
    r'qu[eé] tal|c[oó]mo est[aá]s?|hey+|hi|saludos)[\s!¡.,]*$',
    re.IGNORECASE,
)


def _is_bare_greeting(message: str) -> bool:
    return bool(_BARE_GREETING_RE.match(message.strip()))


async def run_whatsapp_agent(
    conversation_id: str,
    message: str,
    history: Optional[list] = None,
    contact_name: Optional[str] = None,
    audience: str = "PUBLIC",
    db=None,
    doctor_lead_name: Optional[str] = None,
    already_escalated: bool = False,
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

    `doctor_lead_name`: viene resuelto por el webhook cuando el número NO es
    un User registrado pero SÍ coincide con un DoctorLead (ver
    app/api/v1/endpoints/admin.py::invite_doctor_lead — la campaña de
    captación de médicos manda una invitación formal por este mismo
    WhatsApp). Sin esto, un médico invitado que responde a esa invitación
    se trataba como "contacto aún no identificado" — el agente no tenía
    forma de saber que ya recibió una invitación y contestaba genérico.
    Con esto: (1) el prompt sabe que es justo esa persona invitada, y
    (2) se carga FAQ de PROFESSIONAL en vez de la genérica de PUBLIC (ver
    más abajo), porque un médico preguntando "¿de qué se trata?" necesita
    la info de profesional (cómo atender consultas, cobros, etc.), no la
    de paciente.

    Devuelve {"message": str, "escalate": bool, "escalation_reason": str|None}
    — a diferencia de la versión anterior (que devolvía solo el texto), el
    caller necesita saber si hay que marcar la conversación para admin.
    """
    system = WHATSAPP_SYSTEM

    tipo = {"PATIENT": "paciente", "PROFESSIONAL": "profesional de salud"}.get(
        audience, "contacto aún no identificado en la plataforma"
    )
    contacto = f"Tipo: {tipo}"
    if doctor_lead_name:
        # Ver docstring del parámetro más arriba. Esto pisa la línea
        # genérica de "contacto aún no identificado" — es justo lo que
        # queremos: acá SÍ sabemos quién es y por qué escribe.
        contacto = (
            f"Tipo: médico (Dr./Dra. {doctor_lead_name}) al que el equipo de MedicBolivia le mandó "
            f"una invitación formal por este mismo WhatsApp para sumarse a la plataforma como "
            f"profesional. Todavía NO tiene cuenta creada — si pregunta por la invitación, "
            f"confirmá que la mandamos nosotros y resolvé su duda puntual; si quiere registrarse, "
            f"guialo a hacerlo desde la app."
        )
    elif _clean_contact_name(contact_name):
        contacto = f"Nombre: {_clean_contact_name(contact_name)}\n{contacto}"
    if already_escalated:
        contacto += (
            "\nESTADO: esta conversación YA fue derivada a administración y el equipo todavía no "
            "respondió. No repitas el tag ni la promesa de contacto salvo que sea un tema nuevo."
        )
    system += f"\n\nCONTACTO:\n{contacto}"

    system += f"\n\nFECHA_HOY: {_today_bolivia_text()}"
    if db:
        estado = await _platform_state_text(db)
        if estado:
            system += "\n\n" + estado

    if db and not _is_bare_greeting(message):
        # Un DoctorLead pregunta como médico (cobros, agenda, cómo atiende
        # consultas) aunque `audience` siga en PUBLIC (no es User todavía)
        # — sin esto cargaba FAQ genérica/de paciente, no la de profesional.
        faq_audience = "PROFESSIONAL" if doctor_lead_name else (
            audience if audience in ("PATIENT", "PROFESSIONAL") else "ALL"
        )
        faq_text = await _load_faq_context(db, faq_audience)
        if faq_text:
            system += f"\n\nFAQ_CONTEXT (respuestas oficiales verificadas por el equipo, priorizalas):\n{faq_text}"

    contents = _build_contents(history or [], message)
    try:
        # Antes 220 — muy justo: el prompt pide "máximo 2-3 líneas", pero
        # cuando corresponde derivar a admin (ver DERIVAR A ADMINISTRACIÓN
        # arriba) el modelo tiene que sumar el mensaje visible al paciente
        # MÁS el tag [ESCALATE_ADMIN:...] al final — y 220 tokens alcanzaba
        # para cortar la generación a mitad del tag, dejando el tag roto
        # literal en el WhatsApp del paciente (ver _parse_escalation_tag,
        # ahora con fallback para ese caso, pero mejor evitarlo de raíz).
        # 500 da margen de sobra sin presionar al modelo a escribir más —
        # sigue siendo un TECHO, no un objetivo; el "2-3 líneas" del
        # prompt sigue siendo la instrucción real de longitud.
        #
        # Esto resuelve el corte "a mitad del tag" cuando el mensaje SÍ
        # llega a escribirse. Pero había un segundo caso, más raro y más
        # grave, que 220→500 no tocaba: con el prompt más largo (contexto
        # de la invitación a médicos) a veces el modelo cortaba clavado al
        # arrancar ("hola jackie, MedicBol") — eso no era el mensaje
        # llegando al límite, era el razonamiento interno de Gemini
        # (thinking, ver _call_gemini) comiéndose casi todo el presupuesto
        # antes de escribir una sola palabra visible. Se arregla en la raíz
        # con thinking_budget=0 en _call_gemini, no acá — este max_tokens=500
        # sigue siendo válido tal cual, ahora sin competir con el thinking.
        reply = await _call_gemini(system, contents, max_tokens=500)

        # [NO_REPLY]: el modelo decidió que el mensaje es solo cortesía ("ok",
        # "gracias"). Se respeta únicamente si el guard de código también lo ve
        # así — mensaje corto, sin pregunta, y no es el primer turno —; si no,
        # preferimos contestar antes que dejar a alguien sin respuesta.
        if _NO_REPLY_TAG in reply:
            only_tag = reply.strip() == _NO_REPLY_TAG
            is_first_turn = not any(m.get("role") == "assistant" for m in (history or []))
            looks_like_question = ("?" in message) or ("¿" in message)
            if only_tag and len(message.strip()) <= 60 and not looks_like_question and not is_first_turn:
                return {"message": "", "escalate": False, "escalation_reason": None, "no_reply": True}
            reply = reply.replace(_NO_REPLY_TAG, "").strip()
            if not reply:
                reply = "¿Me cuentas un poco más para poder ayudarte?"

        clean_reply, escalation_reason = _parse_escalation_tag(reply)
        return {
            "message": clean_reply,
            "escalate": escalation_reason is not None,
            "escalation_reason": escalation_reason,
            "no_reply": False,
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
    history = await _get_conversation(session_id)

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
        await _save_conversation(session_id, history)

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
    if user_role != "PATIENT":
        system += f"\n\nDOCUMENTOS_REQUERIDOS:\n{build_docs_context_text()}"
    history = await _get_conversation(session_id)
    contents = _build_contents(history, message)

    try:
        reply = await _call_gemini(system, contents, max_tokens=800)

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        await _save_conversation(session_id, history, max_turns=30)

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

    if user_role != "PATIENT":
        system += f"\n\nDOCUMENTOS_REQUERIDOS:\n{build_docs_context_text()}"

    if db:
        audience = "PATIENT" if user_role == "PATIENT" else "PROFESSIONAL"
        faq_text = await _load_faq_context(db, audience)
        if faq_text:
            system += f"\n\nFAQ_CONTEXT (respuestas oficiales verificadas por el equipo, priorizalas sobre tu conocimiento general):\n{faq_text}"

    history = await _get_conversation(session_id)
    contents = _build_contents(history, message)

    try:
        reply = await _call_gemini(system, contents, max_tokens=700)

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        await _save_conversation(session_id, history)

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


async def get_conversation_history(session_id: str) -> list:
    return await _get_conversation(session_id)


async def clear_conversation(session_id: str) -> None:
    await redis_client.delete(f"{_SESSION_KEY_PREFIX}{session_id}")