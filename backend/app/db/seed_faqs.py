"""
app/db/seed_faqs.py
Seed inicial de preguntas frecuentes para la landing pública (/).

Ejecutar una sola vez (o cada vez que se agregue algo a FAQS_SEED):
    python -m app.db.seed_faqs

Es idempotente: si una pregunta con el mismo texto ya existe, no la duplica
— así que es seguro correrlo varias veces.

COMPORTAMIENTO ACTUAL (más seguro que el original):
  - Preguntas NUEVAS (que no existen en la base): se crean.
  - Preguntas que YA existen: NO se tocan, salvo las listadas en UPDATE_EXISTING
    (casos donde el texto viejo es incorrecto). Esto evita pisar ediciones hechas
    desde /admin/faq — p. ej. los textos que dicen que el registro de pacientes
    todavía no está abierto: si el seed los sobrescribiera con su versión (que
    asume el registro abierto) la landing pública diría algo falso.
  - python -m app.db.seed_faqs --dry-run     → muestra qué haría, sin escribir nada.
  - python -m app.db.seed_faqs --update-all  → comportamiento original: actualiza
    TODAS las preguntas existentes con el texto de este archivo (usar con cuidado).

IMPORTANTE: estas preguntas se crean con is_active=True — visibles de una en
la landing pública apenas corrés el script. El contenido (montos, tiempos,
políticas de reembolso, etc.) es un borrador razonable basado en cómo está
armada la plataforma, pero si algún dato no coincide con la realidad del
negocio (comisión exacta, plazo exacto, etc.), lo corregís después desde
/admin/faq sin tener que volver a correr este script.
"""
import asyncio
import sys
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import FAQ, FAQAudience
from app.core.professional_requirements import build_docs_public_text, VERIFICATION_SLA_TEXT


# Cada tupla: (pregunta, respuesta, orden)
FAQS_SEED: dict[FAQAudience, list[tuple[str, str, int]]] = {

    # ── GENERAL ──
    # Orden pensado para la landing: lo primero que ve un visitante es qué es y si ya puede registrarse.
    # Preguntas que dependen del estado/fechas (marcadas con "◀ DEPENDE" abajo) — editar cuando cambie:
    #   · GENERAL      "¿Ya puedo registrarme como paciente?"        (apertura del registro de pacientes)
    #   · PROFESSIONAL "¿Cuándo van a llegar pacientes?"             (apertura del registro de pacientes)
    #   · PROFESSIONAL "¿Qué es la membresía…?"                      (publicación de paquetes y precios)
    # El resto está redactado para ser verdadero con el registro cerrado o abierto.
    FAQAudience.GENERAL: [
        (
            "¿Qué es MedicBolivia?",
            "MedicBolivia es una plataforma de telemedicina que conecta a personas en Bolivia con "
            "profesionales de la salud verificados, a través de videoconsulta en línea. Antes de la "
            "consulta, un asistente de orientación con inteligencia artificial (Medi) te ayuda a "
            "describir tus síntomas y te deriva a la especialidad adecuada.",
            0,
        ),
        (  # ◀ DEPENDE DEL ESTADO
            "¿Ya puedo registrarme como paciente?",
            "Todavía no: por ahora estamos en periodo de registro de profesionales de la salud. "
            "Estamos planificando habilitar el registro de pacientes para diciembre de 2026. Apenas "
            "esté disponible vas a poder crear tu cuenta gratis y consultar con profesionales "
            "verificados.",
            1,
        ),
        (
            "¿Qué puedo hacer en MedicBolivia y qué tiene de gratis?",
            "Registrarte como paciente es 100% gratis: solo pagás cuando efectivamente hacés una "
            "consulta. Con tu cuenta vas a tener: orientación por síntomas con Medi (nuestro agente "
            "de IA), videoconsulta con profesionales verificados, pago seguro por QR, recetas "
            "digitales y órdenes de laboratorio verificables por QR, tu historia clínica y panel "
            "personal con notificaciones, chat directo con tu profesional dentro de la plataforma, "
            "recordatorios automáticos por WhatsApp (citas, pagos, recetas), y un agente de ayuda "
            "dentro de la plataforma para cualquier duda de uso.",
            2,
        ),
        (
            "¿Cómo funciona una consulta en la plataforma?",
            "Una vez registrado, le contás tus síntomas a Medi, y el sistema te sugiere la "
            "especialidad y te muestra profesionales disponibles. Elegís uno, pagás con QR, y en el "
            "horario acordado se conectan por videollamada dentro de la plataforma — no hace falta "
            "instalar nada.",
            3,
        ),
        (
            "¿Qué es Medi, el asistente de orientación con IA?",
            "Medi es un agente conversacional que te hace preguntas sobre tus síntomas para "
            "orientarte hacia la especialidad médica más adecuada. No reemplaza a un profesional de "
            "salud ni da diagnósticos: es un primer paso para ayudarte a elegir con quién consultar. "
            "El diagnóstico y tratamiento siempre lo define el profesional humano.",
            4,
        ),
        (
            "¿Los profesionales de la plataforma están verificados?",
            "Sí. Cada profesional pasa por un proceso de verificación de su identidad, su título y su "
            "matrícula o registro profesional (emitido por el Ministerio de Salud de Bolivia, o por "
            "la autoridad competente de su país si se formó o ejerce en el exterior) antes de poder "
            "atender en la plataforma.",
            5,
        ),
        (
            "¿Cómo se paga la consulta?",
            "El pago se hace con código QR, un método ampliamente usado en Bolivia. El pago se "
            "retiene de forma segura hasta que la consulta se realiza correctamente, y luego se "
            "libera al profesional.",
            6,
        ),
        (
            "¿Mis datos médicos están seguros?",
            "Sí. Las contraseñas se guardan encriptadas, las conexiones son cifradas, y solo el "
            "paciente y el profesional que lo atiende pueden ver su historia clínica y sus recetas. "
            "Las recetas digitales además llevan una firma con hash único para evitar falsificaciones, "
            "verificable en la sección \"Verificar receta\".",
            7,
        ),
        (
            "¿Puedo usar MedicBolivia desde cualquier parte de Bolivia?",
            "Sí, la plataforma funciona en todo el país siempre que tengas conexión a internet. Es "
            "especialmente útil para quienes viven lejos de un centro médico o de la especialidad "
            "que necesitan.",
            8,
        ),
        (
            "¿Qué hago si tengo una emergencia médica?",
            "MedicBolivia no está pensada para emergencias. Si estás ante una urgencia médica (dolor "
            "de pecho intenso, dificultad para respirar, sangrado grave, pérdida de conciencia, "
            "etc.), acudí de inmediato a una sala de emergencias o llamá al 168 (Número Único de "
            "Emergencias en Salud) o al 911.",
            9,
        ),
        (
            "¿Qué tan confiable es MedicBolivia?",
            "Somos una plataforma nueva, así que todavía no tenemos un historial largo de "
            "calificaciones para mostrar — pero cada profesional pasa por un proceso real de "
            "verificación de identidad y matrícula antes de poder atender, tus datos médicos y pagos "
            "están protegidos con cifrado, y somos parte del Grupo Misael, una empresa con más de 8 "
            "años de experiencia en salud.",
            10,
        ),
        (
            "¿Quién está detrás de MedicBolivia?",
            "MedicBolivia es parte del Grupo Misael, una empresa con más de 8 años de experiencia en "
            "el sector salud, especializada en salud infantil. Podés conocer más sobre el grupo en "
            "la parte inferior de nuestra página principal, donde hay un enlace a su sitio.",
            11,
        ),
        (
            "¿Cuál es la razón social y el NIT de MedicBolivia? ¿Está registrada legalmente?",
            "Sí, está registrada. La razón social, el NIT y el registro de comercio (SEPREC) están "
            "publicados en la página principal del Grupo Misael, a la que llegás desde el enlace que "
            "está en la parte inferior de nuestra página principal.",
            12,
        ),
        (
            "¿Tengo que descargar una app para usar MedicBolivia?",
            "No. MedicBolivia funciona 100% desde el navegador de tu celular o computadora (Chrome, "
            "Safari, etc.), sin instalar nada. Solo buscá \"MedicBolivia\" en Google y entrá desde "
            "ahí. No hay una app en Google Play ni en App Store.",
            13,
        ),
        (
            "¿Cómo hablo con una persona del equipo?",
            "Tenés tres vías: escribirnos por mensaje de WhatsApp, usar el chat de soporte dentro "
            "de la plataforma, o llamar directamente a nuestro número de WhatsApp para hablar con "
            "una persona del equipo. Para temas que no resuelve el asistente (reclamos, problemas "
            "con tu cuenta, propuestas), cualquiera de esas vías sirve.",
            14,
        ),
    ],

    # ── PATIENT ──
    FAQAudience.PATIENT: [
        (
            "¿Cómo agendo o inicio una consulta?",
            "Desde tu panel de paciente, iniciás una conversación con Medi contando tus síntomas. "
            "Con esa información, el sistema te muestra profesionales disponibles de la especialidad "
            "recomendada. Elegís uno, pagás con QR, y quedás en sala de espera hasta que el "
            "profesional se conecta.",
            0,
        ),
        (
            "¿Cuánto cuesta una consulta?",
            "El costo lo define cada profesional y se muestra antes de confirmar el pago, así que "
            "siempre sabés cuánto vas a pagar antes de continuar.",
            1,
        ),
        (
            "¿Qué pasa si el profesional no acepta la consulta a tiempo?",
            "Si el profesional no confirma la consulta dentro del tiempo esperado, se cancela "
            "automáticamente y no se te realiza ningún cobro (o se te reembolsa si ya habías pagado).",
            2,
        ),
        (
            "¿Cómo recibo mi receta médica?",
            "Si el profesional determina que necesitás medicación, te emite una receta digital "
            "firmada, disponible al instante en tu panel de paciente (sección Recetas / Historia "
            "clínica). Cada receta incluye un código QR único que cualquier farmacia puede escanear "
            "para confirmar que es auténtica.",
            3,
        ),
        (
            "¿Puedo pedir órdenes de laboratorio?",
            "Sí. Si el profesional determina que necesitás estudios de laboratorio, te emite una "
            "orden digital firmada que aparece junto a tus recetas en \"Mis recetas\", con su propio "
            "código QR de verificación — cualquier laboratorio puede escanearla para confirmar que "
            "es auténtica.",
            4,
        ),
        (
            "¿Puedo pedir un reembolso?",
            "Sí, en los casos que correspondan (por ejemplo, si el profesional no se conecta o la "
            "consulta no puede realizarse por un problema de la plataforma). Podés iniciar una "
            "disputa desde el detalle de la consulta y un administrador la revisa.",
            5,
        ),
        (
            "¿Cómo recibo mi reembolso si me corresponde uno?",
            "Registrando una cuenta bancaria propia desde tu perfil. Cuando un reembolso se aprueba, "
            "se transfiere automáticamente a esa cuenta — por eso conviene tenerla cargada de "
            "antemano, así el reembolso no queda pendiente esperando ese dato.",
            6,
        ),
        (
            "¿Necesito una cámara y buena conexión a internet?",
            "Sí, la videoconsulta requiere cámara, micrófono y una conexión estable a internet. "
            "Recomendamos usar wifi en lugar de datos móviles cuando sea posible, para evitar cortes "
            "durante la consulta.",
            7,
        ),
        (
            "¿Puedo reprogramar una cita ya agendada?",
            "Sí. Tanto vos como el profesional pueden proponer un nuevo horario para una cita "
            "agendada. Hay un máximo de 3 propuestas por cita entre ambas partes, y una vez que una "
            "propuesta se acepta, esa cita ya no admite más cambios de horario.",
            8,
        ),
        (
            "¿Puedo calificar al profesional después de la consulta?",
            "Sí, al finalizar la consulta podés dejar una calificación y un comentario. Esto ayuda a "
            "otros pacientes a elegir con más información.",
            9,
        ),
        (
            "¿Puedo bloquear a un profesional en el chat?",
            "Sí. Desde la conversación podés bloquear a un profesional puntual para dejar de recibir "
            "sus mensajes, o activar un bloqueo global si preferís no recibir mensajes de nadie por "
            "ahora.",
            10,
        ),
        (
            "¿Dónde veo mi historial de consultas y recetas?",
            "En tu panel de paciente, en la sección de Historia clínica, tenés acceso a todas tus "
            "consultas pasadas, notas clínicas, recetas y órdenes de laboratorio emitidas.",
            11,
        ),
    ],

    # ── PROFESSIONAL ──
    FAQAudience.PROFESSIONAL: [
        (
            "¿Cómo me registro como profesional de salud?",
            "Desde la página principal, elegís \"Soy profesional de salud\" y completás el registro "
            "con tus datos, especialidad y documentación. Tu cuenta queda pendiente de verificación "
            "antes de poder recibir consultas.",
            0,
        ),
        (
            "¿Qué documentos necesito para verificarme?",
            build_docs_public_text() + "\n\nSi te formaste o ejercés fuera de Bolivia, presentás los "
            "mismos documentos, emitidos por las autoridades competentes de tu país.",
            1,
        ),
        (
            "¿Cuánto demora la verificación de mi perfil?",
            f"La revisión toma {VERIFICATION_SLA_TEXT} desde que subís el último documento, y te "
            "avisamos por SMS cuando tu perfil queda aprobado. Si ya pasó ese plazo y no tuviste "
            "novedades, escribinos y un administrador revisa tu caso.",
            2,
        ),
        (
            "¿Necesito estar colegiado en el Colegio Médico para registrarme?",
            "Hoy la plataforma NO pide la matrícula del Colegio Médico para verificarte. Lo que sí "
            "pide es la Matrícula Profesional emitida por el Ministerio de Salud, además de tu "
            "Título en Provisión Nacional y el resto de los documentos de la lista de verificación. "
            "Si querés saber qué exige la normativa boliviana para ejercer o recetar en tu caso "
            "particular, eso lo tenés que confirmar con el Ministerio de Salud o el Colegio Médico.",
            3,
        ),
        (
            "¿Puedo registrarme como profesional si me formé o ejerzo fuera de Bolivia?",
            "Sí. Los profesionales del exterior pueden registrarse presentando los mismos documentos "
            "que se piden en Bolivia (título profesional, registro o matrícula profesional y el resto "
            "de la lista de verificación), pero emitidos por las autoridades competentes de su país. "
            "El registro profesional tiene que ser el que otorga la autoridad competente de tu país "
            "de origen o de ejercicio, junto con el título profesional respectivo.",
            4,
        ),
        (
            "¿Cómo y cuándo recibo mis pagos?",
            "El pago de cada consulta se retiene de forma segura y se libera a tu cuenta una vez que "
            "la consulta se completa correctamente. Para poder cobrar, primero tenés que registrar "
            "tu cuenta bancaria en tu perfil; un administrador la revisa y la verifica. Una vez "
            "verificada, tus pagos liberados se agrupan en lotes que se procesan cada cierto tiempo, "
            "y un administrador confirma cada lote — ahí recién se transfiere y te llega el aviso. "
            "Podés ver el estado de tus pagos desde tu panel de profesional.",
            5,
        ),
        (  # ◀ DEPENDE DE UNA FECHA: editar cuando se publiquen los paquetes y precios
            "¿Qué es la membresía de profesional y qué beneficios tiene?",
            "La membresía es un beneficio para profesionales que se va a ofrecer por paquetes; muy "
            "pronto vamos a publicar los paquetes con sus precios. Mientras está activa, pagás 0% de "
            "comisión y además podés agendar citas directo para tus pacientes vinculados, sin que "
            "ellos tengan que iniciar la reserva. Un administrador la activa en tu cuenta; si te "
            "interesa, comunicate con el equipo para coordinarla.",
            6,
        ),
        (
            "¿Puedo emitir recetas digitales?",
            "Sí. Al finalizar una consulta podés emitir una receta digital firmada, que el paciente "
            "recibe al instante con un código QR de verificación único. Una receta firmada no se "
            "puede editar — si es necesario corregirla, se anula y se emite una nueva. Lo mismo "
            "aplica para órdenes de laboratorio.",
            7,
        ),
        (
            "¿Por qué no puedo emitir una receta o una orden de laboratorio?",
            "Para emitir recetas u órdenes de laboratorio se necesitan dos cosas: que tu perfil esté "
            "verificado (aprobado por administración) y que hayas cargado tu firma en el perfil "
            "(dibujada o una foto de tu firma) y un administrador la haya aprobado. Si te aparece un "
            "error al intentar emitir, revisá primero esos dos puntos.",
            8,
        ),
        (
            "¿La plataforma me emite un sello o una firma digital para mis recetas?",
            "No. MedicBolivia no emite sellos digitales ni firmas digitales certificadas. Cada receta "
            "digital lleva un código QR de verificación único (es lo que garantiza su autenticidad), "
            "tu matrícula y tu firma. Para poder emitir recetas tenés que cargar tu firma en el "
            "perfil (dibujada o una foto de tu firma) y que un administrador la apruebe. No hace "
            "falta imprimir ni digitalizar nada.",
            9,
        ),
        (
            "¿Puedo recetar medicamentos controlados (psicotrópicos, receta amarilla)?",
            "No. Los medicamentos controlados (psicotrópicos o estupefacientes) requieren una receta "
            "oficial valorada y archivada, según la normativa de AGEMED, y no se emiten por "
            "MedicBolivia. Si tenés dudas sobre si un medicamento puntual es controlado, consultalo "
            "con AGEMED.",
            10,
        ),
        (
            "¿Hay un modo de prueba para practicar con recetas antes de atender?",
            "No hay un modo de prueba: para emitir una receta se necesita un paciente real. La receta "
            "se puede generar durante la consulta o después de ella, desde tu panel de profesional. "
            "El sistema de recetas ya está configurado y listo para usarse, así que no hace falta "
            "practicar antes.",
            11,
        ),
        (
            "¿Qué pasa si no puedo atender una consulta a tiempo?",
            "Tenés un tiempo definido para aceptar cada solicitud de consulta según qué tan próxima "
            "sea la cita. Si no la aceptás a tiempo, se libera automáticamente para no hacer esperar "
            "al paciente, y eso puede afectar tus métricas de respuesta si se repite seguido.",
            12,
        ),
        (
            "¿Qué es el puntaje de penalización?",
            "Es un puntaje que sube cuando pasan cosas como no presentarte a una consulta, rechazar "
            "consultas inmediatas seguido, cancelar tarde, no dejar la nota clínica de una consulta, "
            "o recibir calificaciones bajas. Puede afectar tu visibilidad o tus métricas dentro de la "
            "plataforma. Un administrador es quien verifica y revisa el detalle de las penalizaciones "
            "— si tenés dudas sobre tu puntaje, querés más información, o sentís que no refleja tu "
            "situación real, comunicate con el equipo administrativo para que lo revisen.",
            13,
        ),
        (
            "¿Puedo reprogramar una cita ya agendada?",
            "Sí. Tanto vos como el paciente pueden proponer un nuevo horario para una cita agendada. "
            "Hay un máximo de 3 propuestas por cita entre ambas partes, y una vez que una propuesta "
            "se acepta, esa cita ya no admite más cambios de horario.",
            14,
        ),
        (
            "¿Cómo se ven mis calificaciones?",
            "Los pacientes pueden calificar y comentar cada consulta finalizada. Tu calificación "
            "promedio es visible en tu perfil público, así que mantener una buena atención ayuda a "
            "que más pacientes te elijan.",
            15,
        ),
        (
            "¿Puedo definir mis propios horarios y tarifas?",
            "Sí. El precio lo configurás vos, y para la disponibilidad tenés 3 modos: \"Disponible "
            "ahora\" (te marcás en línea manualmente, fuera de tu horario configurado), \"Modo "
            "automático\" (el sistema te marca en línea solo según el horario que configuraste), y "
            "\"No disponible\" (pausás manualmente la recepción de pacientes nuevos). Si no te está "
            "llegando ningún paciente, revisá en cuál de los 3 modos estás.",
            16,
        ),
        (
            "¿Qué pasa si un paciente disputa un pago?",
            "Si un paciente reporta un problema con una consulta, el pago queda en estado de disputa "
            "hasta que el equipo de administración la revisa y resuelve — liberando el pago, "
            "reembolsándolo total o parcialmente, según corresponda.",
            17,
        ),
        (
            "¿Puedo escribirle a un paciente después de la consulta?",
            "Sí. Podés usar la mensajería de la plataforma para hacer seguimiento con tus pacientes "
            "después de una consulta, responder dudas o coordinar lo que necesites, de la misma "
            "forma en que ellos pueden escribirte a vos.",
            18,
        ),
        (  # ◀ DEPENDE DEL ESTADO
            "¿Cuándo van a llegar pacientes?",
            "Estamos en periodo de registro de profesionales de la salud. Estamos planificando "
            "habilitar el registro de pacientes para diciembre de 2026; apenas se habilite, tu perfil "
            "verificado ya va a estar visible para ellos. Mientras tanto, te conviene completar tu "
            "perfil, tu firma (que un administrador debe aprobar) y tu disponibilidad para estar "
            "listo desde el primer día.",
            19,
        ),
    ],
}

# Preguntas que ya existen en producción y SÍ se actualizan al correr el seed sin flags (su texto
# viejo era incorrecto o dependía del estado del registro). Para además REORDENAR todas y dejar
# el conjunto idéntico a este archivo, usar --update-all (conviene --dry-run antes).
# OJO: tras reorganizar, si editás una FAQ desde /admin/faq, NO vuelvas a correr --update-all sin
# --dry-run: pisaría tu edición con el texto de este archivo.
UPDATE_EXISTING: set[tuple[FAQAudience, str]] = {
    (FAQAudience.GENERAL, "¿Ya puedo registrarme como paciente?"),
    (FAQAudience.GENERAL, "¿Qué puedo hacer en MedicBolivia y qué tiene de gratis?"),
    (FAQAudience.GENERAL, "¿Cómo funciona una consulta en la plataforma?"),
    (FAQAudience.GENERAL, "¿Los profesionales de la plataforma están verificados?"),
    (FAQAudience.GENERAL, "¿Qué hago si tengo una emergencia médica?"),
    (FAQAudience.GENERAL, "¿Qué tan confiable es MedicBolivia?"),
    (FAQAudience.PROFESSIONAL, "¿Qué documentos necesito para verificarme?"),
    (FAQAudience.PROFESSIONAL, "¿Cómo y cuándo recibo mis pagos?"),
    (FAQAudience.PROFESSIONAL, "¿Por qué no puedo emitir una receta o una orden de laboratorio?"),
    (FAQAudience.PROFESSIONAL, "¿Cuándo van a llegar pacientes?"),
}

def _decide(existing, audience, question, answer, order, update_all: bool) -> str:
    """'create' | 'update' | 'unchanged' | 'preserved' (existe y no se toca)."""
    if existing is None:
        return "create"
    if not update_all and (audience, question) not in UPDATE_EXISTING:
        return "preserved"
    if existing.answer != answer or existing.display_order != order:
        return "update"
    return "unchanged"


async def seed_faqs(dry_run: bool = False, update_all: bool = False) -> None:
    async with AsyncSessionLocal() as db:
        counts = {"create": 0, "update": 0, "unchanged": 0, "preserved": 0}

        for audience, items in FAQS_SEED.items():
            for question, answer, order in items:
                result = await db.execute(
                    select(FAQ).where(FAQ.question == question, FAQ.audience == audience.value)
                )
                existing = result.scalar_one_or_none()
                action = _decide(existing, audience, question, answer, order, update_all)
                counts[action] += 1

                if action in ("create", "update"):
                    label = "NUEVA     " if action == "create" else "ACTUALIZA "
                    print(f"  {label}[{audience.value}] {question}")
                if dry_run:
                    continue
                if action == "create":
                    db.add(FAQ(
                        question=question, answer=answer, audience=audience.value,
                        display_order=order, is_active=True,
                    ))
                elif action == "update":
                    existing.answer = answer
                    existing.display_order = order

        if dry_run:
            await db.rollback()
        else:
            await db.commit()

        total = sum(len(v) for v in FAQS_SEED.values())
        prefix = "🔍 SIMULACIÓN (no se escribió nada)" if dry_run else "✅ Seed de FAQ completo"
        print(f"{prefix}: {counts['create']} nuevas, {counts['update']} actualizadas, "
              f"{counts['unchanged']} sin cambios, {counts['preserved']} existentes preservadas.")
        print(f"   (Total en FAQS_SEED: {total} preguntas)")
        if not dry_run and counts["create"]:
            print("   Las nuevas quedaron VISIBLES en la landing pública (is_active=True).")


if __name__ == "__main__":
    asyncio.run(seed_faqs(dry_run="--dry-run" in sys.argv, update_all="--update-all" in sys.argv))
