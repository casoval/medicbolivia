"""
update_reminder_cta.py
Actualiza las 12 ReminderRule de sistema YA SEMBRADAS en la base de datos
para que coincidan con dos cambios hechos en el código fuente
(seed_system_reminders.py), sin pisar ediciones manuales del admin:

  1. CTA: reemplaza el cierre con link ("Revisa medicbolivia.com...") por
     texto plano sin dominio.
  2. Título variable: reemplaza el título fijo en negrita (ej. "💰 *Pago
     confirmado*") por el placeholder {intro}, que a partir de ahora se
     rellena con una variante al azar en cada envío (ver INTRO_VARIANTS
     en seed_system_reminders.py y fire_system_reminder en
     system_reminders.py) — para que el mismo evento no genere siempre el
     mensaje idéntico carácter por carácter a lo largo del tiempo.

Por qué hace falta un script para esto: ensure_system_reminder_rules()
(seed_system_reminders.py) solo CREA filas que no existen — "no pisa
ediciones existentes" — así que cambiar las constantes en el código no
actualiza las 12 filas que ya están en la tabla reminder_rules de
producción. Sin este script, ambos fixes quedan solo en el código fuente
y nunca llegan a los mensajes reales que se mandan.

Cada reemplazo se hace por coincidencia EXACTA (sufijo para el CTA,
prefijo para el título) — si el admin ya editó una plantilla a mano desde
el panel y por lo tanto ya no coincide con el texto viejo esperado, esa
fila se salta sin tocarla.

Uso:
    (venv) /var/www/medicbolivia/backend> python update_reminder_cta.py --dry-run
    (venv) /var/www/medicbolivia/backend> python update_reminder_cta.py
"""
import argparse
import asyncio

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import ReminderRule
from app.db.seed_system_reminders import SystemReminderID

OLD_CTA = "\n\nRevisa medicbolivia.com para más detalles."
NEW_CTA = "\n\nRevisa la app de MedicBolivia para más detalles."

# Título literal viejo (antes de este cambio) por rule_id → se reemplaza
# por "{intro}". Solo cubre las 10 reglas que pasaron a tener variantes
# (las 2 de "mensajes sin leer" ya usaban {variante} desde antes, no
# necesitan esta migración).
OLD_INTROS = {
    SystemReminderID.PROF_IMMEDIATE_WAITING: "🩺 *Tienes un paciente esperando*",
    SystemReminderID.PROF_IMMEDIATE_PAID: "💰 *Pago confirmado*",
    SystemReminderID.PROF_IMMEDIATE_CANCELLED: "❌ *Consulta cancelada*",
    SystemReminderID.PROF_APPOINTMENT_1H: "🗓️ *Recordatorio de cita*",
    SystemReminderID.PROF_APPOINTMENT_PAID: "💰 *Pago confirmado*",
    SystemReminderID.PROF_RESCHEDULE_PROPOSED: "🔄 *Propuesta de reprogramación*",
    SystemReminderID.PROF_APPOINTMENT_CANCELLED: "❌ *Cita cancelada*",
    SystemReminderID.PATIENT_APPOINTMENT_1H: "🗓️ *Recordatorio de cita*",
    SystemReminderID.PATIENT_RESCHEDULE_PROPOSED: "🔄 *Propuesta de reprogramación*",
    SystemReminderID.PATIENT_APPOINTMENT_CANCELLED: "❌ *Cita cancelada*",
}


# Reemplazos de texto libre puntuales (no son solo el título) — hoy solo
# uno: se encontró que PATIENT_APPOINTMENT_CANCELLED tenía un "El " fijo
# antes de {profesional}, que ya trae el tratamiento correcto incluido
# ("El Dra. Ana Gómez canceló..." queda mal para una profesional mujer).
EXTRA_REPLACEMENTS = {
    SystemReminderID.PATIENT_APPOINTMENT_CANCELLED: [("\n\nEl {profesional}", "\n\n{profesional}")],
}


async def main(dry_run: bool):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ReminderRule).where(ReminderRule.is_system.is_(True)))
        rules = result.scalars().all()

        updated, skipped = 0, 0
        for rule in rules:
            template = rule.message_template
            changed = False

            if template.endswith(OLD_CTA):
                template = template[: -len(OLD_CTA)] + NEW_CTA
                changed = True

            old_intro = OLD_INTROS.get(rule.id)
            if old_intro and template.startswith(old_intro):
                template = "{intro}" + template[len(old_intro):]
                changed = True

            for old_text, new_text in EXTRA_REPLACEMENTS.get(rule.id, []):
                if old_text in template:
                    template = template.replace(old_text, new_text)
                    changed = True

            if not changed:
                print(f"  · {rule.id} ({rule.name}): no coincide con el texto viejo esperado, se salta (¿editado a mano?)")
                skipped += 1
                continue

            if dry_run:
                print(f"  · {rule.id} ({rule.name}): se actualizaría")
            else:
                rule.message_template = template
                print(f"  ✓ {rule.id} ({rule.name}): actualizado")
            updated += 1

        if not dry_run and updated:
            await db.commit()

    action = "se actualizarían" if dry_run else "actualizados"
    print(f"\n✅ {updated} {action}, {skipped} salteados (ya editados a mano).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra qué cambiaría, no toca nada")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run))
