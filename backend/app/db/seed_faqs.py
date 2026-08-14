"""
app/db/seed_faqs.py
Seed inicial de preguntas frecuentes para la landing pública (/).

Ejecutar una sola vez (o cada vez que se agregue algo a FAQS_SEED):
    python -m app.db.seed_faqs

Es idempotente: si una pregunta con el mismo texto ya existe, no la duplica
— así que es seguro correrlo varias veces.

IMPORTANTE: estas preguntas se crean con is_active=True — visibles de una en
la landing pública apenas corrés el script. El contenido (montos, tiempos,
políticas de reembolso, etc.) es un borrador razonable basado en cómo está
armada la plataforma, pero si algún dato no coincide con la realidad del
negocio (comisión exacta, plazo exacto, etc.), lo corregís después desde
/admin/faq sin tener que volver a correr este script.
"""
import asyncio
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import FAQ, FAQAudience
from app.core.professional_requirements import build_docs_public_text


# Cada tupla: (pregunta, respuesta, orden)
FAQS_SEED: dict[FAQAudience, list[tuple[str, str, int]]] = {

    # ── GENERAL: quiénes somos, cómo funciona, seguridad ──
    FAQAudience.GENERAL: [
        (
            "¿Qué es MedicBolivia?",
            "MedicBolivia es una plataforma de telemedicina que conecta a personas en Bolivia "
            "con profesionales de la salud verificados, a través de videoconsulta en línea. "
            "Antes de la consulta, un asistente de orientación con inteligencia artificial (Medi) "
            "te ayuda a describir tus síntomas y te deriva a la especialidad adecuada.",
            0,
        ),
        (
            "¿Qué puedo hacer en MedicBolivia y qué tiene de gratis?",
            "Registrarte es 100% gratis — solo pagás cuando efectivamente hacés una consulta. "
            "Una vez adentro tenés: orientación por síntomas con Medi (nuestro agente de IA), "
            "videoconsulta con profesionales verificados, pago seguro por QR, recetas digitales y "
            "órdenes de laboratorio verificables por QR, tu historia clínica y panel personal con "
            "notificaciones, chat directo con tu profesional dentro de la plataforma, recordatorios "
            "automáticos por WhatsApp (citas, pagos, recetas), y un agente de ayuda dentro de la "
            "app para cualquier duda de uso.",
            1,
        ),
        (
            "¿Cómo funciona una consulta en la plataforma?",
            "Te registrás como paciente, contás tus síntomas a Medi, y el sistema te sugiere la "
            "especialidad y te muestra profesionales disponibles. Elegís uno, pagás con QR, y en "
            "el horario acordado se conectan por videollamada dentro de la plataforma — no hace "
            "falta instalar nada.",
            2,
        ),
        (
            "¿Qué es Medi, el asistente de orientación con IA?",
            "Medi es un agente conversacional que te hace preguntas sobre tus síntomas para "
            "orientarte hacia la especialidad médica más adecuada. No reemplaza a un profesional "
            "de salud ni da diagnósticos: es un primer paso para ayudarte a elegir con quién "
            "consultar. El diagnóstico y tratamiento siempre lo define el profesional humano.",
            3,
        ),
        (
            "¿Los profesionales de la plataforma están verificados?",
            "Sí. Cada profesional pasa por un proceso de verificación de identidad y matrícula "
            "profesional emitida por el Ministerio de Salud de Bolivia antes de poder atender en "
            "la plataforma.",
            4,
        ),
        (
            "¿Cómo se paga la consulta?",
            "El pago se hace con código QR, un método ampliamente usado en Bolivia. El pago se "
            "retiene de forma segura hasta que la consulta se realiza correctamente, y luego se "
            "libera al profesional.",
            5,
        ),
        (
            "¿Mis datos médicos están seguros?",
            "Sí. Las contraseñas se guardan encriptadas, las conexiones son cifradas, y solo el "
            "paciente y el profesional que lo atiende pueden ver su historia clínica y sus "
            "recetas. Las recetas digitales además llevan una firma con hash único para evitar "
            "falsificaciones, verificable en la sección \"Verificar receta\".",
            6,
        ),
        (
            "¿Puedo usar MedicBolivia desde cualquier parte de Bolivia?",
            "Sí, la plataforma funciona en todo el país siempre que tengas conexión a internet. "
            "Es especialmente útil para quienes viven lejos de un centro médico o de la "
            "especialidad que necesitan.",
            7,
        ),
        (
            "¿Qué hago si tengo una emergencia médica?",
            "MedicBolivia no está pensada para emergencias. Si estás ante una urgencia médica "
            "(dolor de pecho intenso, dificultad para respirar, sangrado grave, pérdida de "
            "conciencia, etc.), acudí de inmediato a una sala de emergencias o llamá a los "
            "servicios de emergencia de tu ciudad.",
            8,
        ),
        (
            "¿Qué tan confiable es MedicBolivia?",
            "Somos una plataforma nueva, así que todavía no tenemos un historial largo de "
            "calificaciones para mostrar — pero cada profesional pasa por un proceso real de "
            "verificación de identidad y matrícula antes de poder atender, y tus datos médicos y "
            "pagos están protegidos con cifrado.",
            9,
        ),
    ],

    # ── PATIENT: cómo usar la plataforma siendo paciente ──
    FAQAudience.PATIENT: [
        (
            "¿Cómo agendo o inicio una consulta?",
            "Desde tu panel de paciente, iniciás una conversación con Medi contando tus síntomas. "
            "Con esa información, el sistema te muestra profesionales disponibles de la "
            "especialidad recomendada. Elegís uno, pagás con QR, y quedás en sala de espera "
            "hasta que el profesional se conecta.",
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
            "automáticamente y no se te realiza ningún cobro (o se te reembolsa si ya habías "
            "pagado).",
            2,
        ),
        (
            "¿Cómo recibo mi receta médica?",
            "Si el profesional determina que necesitás medicación, te emite una receta digital "
            "firmada, disponible al instante en tu panel de paciente (sección Recetas / Historia "
            "clínica). Cada receta incluye un código QR único que cualquier farmacia puede "
            "escanear para confirmar que es auténtica.",
            3,
        ),
        (
            "¿Puedo pedir órdenes de laboratorio?",
            "Sí. Si el profesional determina que necesitás estudios de laboratorio, te emite una "
            "orden digital firmada que aparece junto a tus recetas en \"Mis recetas\", con su "
            "propio código QR de verificación — cualquier laboratorio puede escanearla para "
            "confirmar que es auténtica.",
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
            "Registrando una cuenta bancaria propia desde tu perfil; un administrador la revisa y "
            "la verifica. Una vez verificada, cuando un reembolso se aprueba, un administrador lo "
            "confirma y recién ahí se transfiere a esa cuenta — por eso conviene tenerla cargada "
            "y verificada de antemano, así el reembolso no queda pendiente esperando ese dato.",
            6,
        ),
        (
            "¿Puedo reprogramar una cita ya agendada?",
            "Sí. Tanto vos como el profesional pueden proponer un nuevo horario para una cita "
            "agendada. Hay un máximo de 3 propuestas por cita entre ambas partes, y una vez que "
            "una propuesta se acepta, esa cita ya no admite más cambios de horario.",
            7,
        ),
        (
            "¿Puedo bloquear a un profesional en el chat?",
            "Sí. Desde la conversación podés bloquear a un profesional puntual para dejar de "
            "recibir sus mensajes, o activar un bloqueo global si preferís no recibir mensajes de "
            "nadie por ahora.",
            8,
        ),
        (
            "¿Necesito una cámara y buena conexión a internet?",
            "Sí, la videoconsulta requiere cámara, micrófono y una conexión estable a internet. "
            "Recomendamos usar wifi en lugar de datos móviles cuando sea posible, para evitar "
            "cortes durante la consulta.",
            9,
        ),
        (
            "¿Puedo calificar al profesional después de la consulta?",
            "Sí, al finalizar la consulta podés dejar una calificación y un comentario. Esto ayuda "
            "a otros pacientes a elegir con más información.",
            10,
        ),
        (
            "¿Dónde veo mi historial de consultas y recetas?",
            "En tu panel de paciente, en la sección de Historia clínica, tenés acceso a todas tus "
            "consultas pasadas, notas clínicas, recetas y órdenes de laboratorio emitidas.",
            11,
        ),
    ],

    # ── PROFESSIONAL: cómo unirse y trabajar en la plataforma ──
    FAQAudience.PROFESSIONAL: [
        (
            "¿Cómo me registro como profesional de salud?",
            "Desde la página principal, elegís \"Soy profesional de salud\" y completás el "
            "registro con tus datos, especialidad y documentación. Tu cuenta queda pendiente de "
            "verificación antes de poder recibir consultas.",
            0,
        ),
        (
            "¿Qué documentos necesito para verificarme?",
            build_docs_public_text(),
            1,
        ),
        (
            "¿Cómo y cuándo recibo mis pagos?",
            "El pago de cada consulta se retiene de forma segura y se libera una vez que la "
            "consulta se completa correctamente. Para poder cobrar, primero tenés que registrar "
            "tu cuenta bancaria en tu perfil; un administrador la revisa y la verifica. Una vez "
            "verificada, tus pagos liberados se agrupan en lotes que se procesan cada cierto "
            "tiempo, y un administrador confirma cada lote — ahí recién se transfiere y te llega "
            "el aviso. Podés ver el estado de tus pagos desde tu panel de profesional. La "
            "comisión de MedicBolivia es baja comparada con otras plataformas del rubro, y "
            "además hay promociones y beneficios para profesionales — para el detalle exacto y "
            "vigente, comunicate directo con el equipo administrativo.",
            2,
        ),
        (
            "¿Qué es la membresía de profesional y qué beneficios tiene?",
            "Es un beneficio que un administrador activa mes a mes para el profesional. Mientras "
            "está activa, pagás 0% de comisión y además podés agendar citas directo para tus "
            "pacientes vinculados, sin que ellos tengan que iniciar la reserva. Si te interesa, "
            "comunicate con el equipo administrativo para coordinarla.",
            3,
        ),
        (
            "¿Qué es el puntaje de penalización?",
            "Es un puntaje que sube cuando pasan cosas como no presentarte a una consulta, "
            "rechazar consultas inmediatas seguido, cancelar tarde, no dejar la nota clínica de "
            "una consulta, o recibir calificaciones bajas. Puede afectar tu visibilidad o tus "
            "métricas dentro de la plataforma. Un administrador es quien verifica y revisa el "
            "detalle de las penalizaciones — si tenés dudas sobre tu puntaje, querés más "
            "información, o sentís que no refleja tu situación real, comunicate con el equipo "
            "administrativo para que lo revisen.",
            4,
        ),
        (
            "¿Puedo reprogramar una cita ya agendada?",
            "Sí. Tanto vos como el paciente pueden proponer un nuevo horario para una cita "
            "agendada. Hay un máximo de 3 propuestas por cita entre ambas partes, y una vez que "
            "una propuesta se acepta, esa cita ya no admite más cambios de horario.",
            5,
        ),
        (
            "¿Qué pasa si no puedo atender una consulta a tiempo?",
            "Tenés un tiempo definido para aceptar cada solicitud de consulta según qué tan "
            "próxima sea la cita. Si no la aceptás a tiempo, se libera automáticamente para no "
            "hacer esperar al paciente, y eso puede afectar tus métricas de respuesta si se repite "
            "seguido.",
            6,
        ),
        (
            "¿Puedo emitir recetas digitales?",
            "Sí. Al finalizar una consulta podés emitir una receta digital firmada, que el "
            "paciente recibe al instante con un código QR de verificación único. Una receta "
            "firmada no se puede editar — si es necesario corregirla, se anula y se emite una "
            "nueva. Lo mismo aplica para órdenes de laboratorio.",
            7,
        ),
        (
            "¿Por qué no puedo emitir una receta o una orden de laboratorio?",
            "El motivo más común es que todavía no configuraste tu firma en el perfil (dibujada o "
            "una foto de tu firma). Es un requisito obligatorio antes de poder emitir cualquier "
            "documento firmado, así que si te aparece un error al intentar emitir, revisá primero "
            "eso.",
            8,
        ),
        (
            "¿Cómo se ven mis calificaciones?",
            "Los pacientes pueden calificar y comentar cada consulta finalizada. Tu calificación "
            "promedio es visible en tu perfil público, así que mantener una buena atención ayuda "
            "a que más pacientes te elijan.",
            9,
        ),
        (
            "¿Puedo definir mis propios horarios y tarifas?",
            "Sí. El precio lo configurás vos, y para la disponibilidad tenés 3 modos: \"Disponible "
            "ahora\" (te marcás en línea manualmente, fuera de tu horario configurado), \"Modo "
            "automático\" (el sistema te marca en línea solo según el horario que configuraste), "
            "y \"No disponible\" (pausás manualmente la recepción de pacientes nuevos). Si no te "
            "está llegando ningún paciente, revisá en cuál de los 3 modos estás.",
            10,
        ),
        (
            "¿Qué pasa si un paciente disputa un pago?",
            "Si un paciente reporta un problema con una consulta, el pago queda en estado de "
            "disputa hasta que el equipo de administración la revisa y resuelve — liberando el "
            "pago, reembolsándolo total o parcialmente, según corresponda.",
            11,
        ),
        (
            "¿Puedo escribirle a un paciente después de la consulta?",
            "Sí. Podés usar la mensajería de la plataforma para hacer seguimiento con tus "
            "pacientes después de una consulta, responder dudas o coordinar lo que necesites, de "
            "la misma forma en que ellos pueden escribirte a vos.",
            12,
        ),
    ],
}


async def seed_faqs() -> None:
    """
    Upsert por (question, audience): si la pregunta no existe, la crea. Si
    ya existe pero el texto de la respuesta o el orden cambiaron acá en
    FAQS_SEED, actualiza esa fila en vez de dejarla como estaba (antes era
    insert-only y un cambio de texto en este archivo nunca se reflejaba en
    producción sin editarlo a mano desde /admin/faq). Si alguien ya editó
    manualmente una FAQ desde el admin y no querés que este script la
    pise, sacá esa entrada de FAQS_SEED.
    """
    async with AsyncSessionLocal() as db:
        created = 0
        updated = 0
        unchanged = 0

        for audience, items in FAQS_SEED.items():
            for question, answer, order in items:
                result = await db.execute(
                    select(FAQ).where(FAQ.question == question, FAQ.audience == audience.value)
                )
                existing = result.scalar_one_or_none()

                if not existing:
                    db.add(FAQ(
                        question=question,
                        answer=answer,
                        audience=audience.value,
                        display_order=order,
                        is_active=True,
                    ))
                    created += 1
                    continue

                if existing.answer != answer or existing.display_order != order:
                    existing.answer = answer
                    existing.display_order = order
                    updated += 1
                else:
                    unchanged += 1

        await db.commit()
        total = sum(len(v) for v in FAQS_SEED.values())
        print(f"✅ Seed de FAQ completo: {created} nuevas, {updated} actualizadas, {unchanged} sin cambios.")
        print(f"   (Total en FAQS_SEED: {total} preguntas)")
        print("   Quedaron creadas/actualizadas como VISIBLES en la landing pública (is_active=True).")
        print("   Si algún dato no coincide con la realidad del negocio, editalo desde /admin/faq.")


if __name__ == "__main__":
    asyncio.run(seed_faqs())
