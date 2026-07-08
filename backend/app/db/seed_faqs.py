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
            "¿Cómo funciona una consulta en la plataforma?",
            "Te registrás como paciente, contás tus síntomas a Medi (nuestro asistente de "
            "orientación), y el sistema te sugiere la especialidad y te muestra profesionales "
            "disponibles. Elegís uno, pagás la consulta con QR, y en el horario acordado se "
            "conectan por videollamada dentro de la plataforma — no hace falta instalar nada.",
            1,
        ),
        (
            "¿Qué es Medi, el asistente de orientación con IA?",
            "Medi es un agente conversacional que te hace preguntas sobre tus síntomas para "
            "orientarte hacia la especialidad médica más adecuada. No reemplaza a un profesional "
            "de salud ni da diagnósticos: es un primer paso para ayudarte a elegir con quién "
            "consultar. El diagnóstico y tratamiento siempre lo define el profesional humano.",
            2,
        ),
        (
            "¿Los profesionales de la plataforma están verificados?",
            "Sí. Cada profesional pasa por un proceso de verificación de identidad y matrícula "
            "profesional (Colegio Médico de Bolivia u organismo equivalente según su profesión) "
            "antes de poder atender en la plataforma.",
            3,
        ),
        (
            "¿Cómo se paga la consulta?",
            "El pago se hace con código QR, un método ampliamente usado en Bolivia. El pago se "
            "retiene de forma segura hasta que la consulta se realiza correctamente, y luego se "
            "libera al profesional.",
            4,
        ),
        (
            "¿Mis datos médicos están seguros?",
            "Sí. Las contraseñas se guardan encriptadas, las conexiones son cifradas, y solo el "
            "paciente y el profesional que lo atiende pueden ver su historia clínica y sus "
            "recetas. Las recetas digitales además llevan una firma con hash único para evitar "
            "falsificaciones, verificable en la sección \"Verificar receta\".",
            5,
        ),
        (
            "¿Puedo usar MedicBolivia desde cualquier parte de Bolivia?",
            "Sí, la plataforma funciona en todo el país siempre que tengas conexión a internet. "
            "Es especialmente útil para quienes viven lejos de un centro médico o de la "
            "especialidad que necesitan.",
            6,
        ),
        (
            "¿Qué hago si tengo una emergencia médica?",
            "MedicBolivia no está pensada para emergencias. Si estás ante una urgencia médica "
            "(dolor de pecho intenso, dificultad para respirar, sangrado grave, pérdida de "
            "conciencia, etc.), acudí de inmediato a una sala de emergencias o llamá a los "
            "servicios de emergencia de tu ciudad.",
            7,
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
            "¿Puedo pedir un reembolso?",
            "Sí, en los casos que correspondan (por ejemplo, si el profesional no se conecta o la "
            "consulta no puede realizarse por un problema de la plataforma). Podés iniciar una "
            "disputa desde el detalle de la consulta y un administrador la revisa.",
            4,
        ),
        (
            "¿Necesito una cámara y buena conexión a internet?",
            "Sí, la videoconsulta requiere cámara, micrófono y una conexión estable a internet. "
            "Recomendamos usar wifi en lugar de datos móviles cuando sea posible, para evitar "
            "cortes durante la consulta.",
            5,
        ),
        (
            "¿Puedo calificar al profesional después de la consulta?",
            "Sí, al finalizar la consulta podés dejar una calificación y un comentario. Esto ayuda "
            "a otros pacientes a elegir con más información.",
            6,
        ),
        (
            "¿Dónde veo mi historial de consultas y recetas?",
            "En tu panel de paciente, en la sección de Historia clínica, tenés acceso a todas tus "
            "consultas pasadas, notas clínicas y recetas emitidas.",
            7,
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
            "Necesitás tu matrícula profesional vigente (Colegio Médico de Bolivia u organismo "
            "equivalente según tu profesión) y un documento de identidad. El equipo de "
            "administración revisa y aprueba cada perfil antes de habilitarlo.",
            1,
        ),
        (
            "¿Cómo y cuándo recibo mis pagos?",
            "El pago de cada consulta se retiene de forma segura y se libera a tu cuenta una vez "
            "que la consulta se completa correctamente. Podés ver el estado de tus pagos desde tu "
            "panel de profesional.",
            2,
        ),
        (
            "¿Qué pasa si no puedo atender una consulta a tiempo?",
            "Tenés un tiempo definido para aceptar cada solicitud de consulta según qué tan "
            "próxima sea la cita. Si no la aceptás a tiempo, se libera automáticamente para no "
            "hacer esperar al paciente, y eso puede afectar tus métricas de respuesta si se repite "
            "seguido.",
            3,
        ),
        (
            "¿Puedo emitir recetas digitales?",
            "Sí. Al finalizar una consulta podés emitir una receta digital firmada, que el "
            "paciente recibe al instante con un código QR de verificación único. Una receta "
            "firmada no se puede editar — si es necesario corregirla, se anula y se emite una "
            "nueva.",
            4,
        ),
        (
            "¿Cómo se ven mis calificaciones?",
            "Los pacientes pueden calificar y comentar cada consulta finalizada. Tu calificación "
            "promedio es visible en tu perfil público, así que mantener una buena atención ayuda "
            "a que más pacientes te elijan.",
            5,
        ),
        (
            "¿Puedo definir mis propios horarios y tarifas?",
            "Sí, cada profesional configura su propia disponibilidad y el precio de su consulta "
            "desde su panel.",
            6,
        ),
        (
            "¿Qué pasa si un paciente disputa un pago?",
            "Si un paciente reporta un problema con una consulta, el pago queda en estado de "
            "disputa hasta que el equipo de administración la revisa y resuelve — liberando el "
            "pago, reembolsándolo total o parcialmente, según corresponda.",
            7,
        ),
    ],
}


async def seed_faqs() -> None:
    async with AsyncSessionLocal() as db:
        created = 0
        skipped = 0

        for audience, items in FAQS_SEED.items():
            for question, answer, order in items:
                result = await db.execute(
                    select(FAQ).where(FAQ.question == question, FAQ.audience == audience.value)
                )
                existing = result.scalar_one_or_none()
                if existing:
                    skipped += 1
                    continue

                db.add(FAQ(
                    question=question,
                    answer=answer,
                    audience=audience.value,
                    display_order=order,
                    is_active=True,
                ))
                created += 1

        await db.commit()
        total = sum(len(v) for v in FAQS_SEED.values())
        print(f"✅ Seed de FAQ completo: {created} preguntas nuevas, {skipped} ya existían.")
        print(f"   (Total en FAQS_SEED: {total} preguntas)")
        print("   Quedaron creadas como VISIBLES en la landing pública (is_active=True).")
        print("   Si algún dato no coincide con la realidad del negocio, editalo desde /admin/faq.")


if __name__ == "__main__":
    asyncio.run(seed_faqs())
