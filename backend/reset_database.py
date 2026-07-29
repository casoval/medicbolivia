"""
reset_database.py
Reset TOTAL de datos operativos en producción: borra usuarios (admins,
pacientes, profesionales) y TODO lo que depende de ellos (consultas, pagos,
recetas, notas clínicas, ratings, chats, notificaciones, etc.).

NO borra tablas de catálogo/configuración de la plataforma:
  specialties, sub_specialties, platform_settings, faqs, agent_config,
  reminder_rules, db_backup_config, db_backup_logs, contact_inquiries
(esas no son "pacientes ni profesionales" — son config del sistema o leads
públicos del formulario de contacto, sin cuenta asociada).

Usa TRUNCATE ... CASCADE en vez de DELETE porque varias tablas
(consultations, payments, prescriptions, clinical_notes, ratings, earnings,
derivations) NO tienen ON DELETE CASCADE definido a nivel de base de datos:
un DELETE normal fallaría por violación de foreign key. TRUNCATE CASCADE
ignora esa restricción y arrastra las tablas dependientes automáticamente,
en una sola transacción atómica.

Uso:
    cd backend
    python3 reset_database.py            # pide confirmación escrita
    python3 reset_database.py --yes      # sin prompt (para CI/CD, usar con cuidado)
"""
import asyncio
import sys

from sqlalchemy import text
from app.db.database import AsyncSessionLocal

# Tablas que se vacían. El orden no importa porque CASCADE resuelve las
# dependencias, pero se listan explícitamente (en vez de confiar 100% en
# el cascade automático) para que quede claro y auditable qué se borra.
TABLES_TO_TRUNCATE = [
    "users",
    "patients",
    "professionals",
    "professional_docs",
    "specialty_proposals",
    "schedules",
    "consultations",
    "derivations",
    "payments",
    "earnings",
    "prescriptions",
    "clinical_notes",
    "clinical_note_addenda",
    "ratings",
    "professional_penalty_resets",
    "agent_logs",
    "audit_logs",
    "admins",
    "notifications",
    "commission_periods",
    "professional_memberships",
    "patient_professional_links",
    "whatsapp_conversations",
    "whatsapp_messages",
    "reminder_logs",
    "chat_conversations",
    "chat_messages",
    "chat_blocks",
    "professional_patient_visibility",
    "admin_access_logs",
    "broadcast_messages",
    "doctor_leads",
]

# Tablas de catálogo/config que se preservan explícitamente (solo informativo)
TABLES_PRESERVED = [
    "specialties", "sub_specialties", "platform_settings", "faqs",
    "agent_config", "reminder_rules", "db_backup_config", "db_backup_logs",
    "contact_inquiries",
]


async def get_counts(db):
    counts = {}
    for table in TABLES_TO_TRUNCATE:
        result = await db.execute(text(f"SELECT COUNT(*) FROM {table}"))
        counts[table] = result.scalar()
    return counts


async def reset():
    async with AsyncSessionLocal() as db:
        print("📊 Filas actuales:")
        before = await get_counts(db)
        total_before = sum(before.values())
        for table, count in before.items():
            if count:
                print(f"   {table}: {count}")
        print(f"   TOTAL: {total_before}\n")

        if total_before == 0:
            print("✅ La base ya está vacía, nada que hacer.")
            return

        table_list = ", ".join(TABLES_TO_TRUNCATE)
        print("🗑️  Ejecutando TRUNCATE CASCADE sobre:")
        print(f"   {table_list}\n")
        print("💾 Se preservan (no se tocan):")
        print(f"   {', '.join(TABLES_PRESERVED)}\n")

        await db.execute(text(f"TRUNCATE TABLE {table_list} RESTART IDENTITY CASCADE"))
        await db.commit()

        after = await get_counts(db)
        total_after = sum(after.values())
        print(f"✅ Listo. Filas restantes en esas tablas: {total_after}")
        print("\nSiguiente paso: crear el nuevo admin con `python3 create_admin.py`")


def confirm() -> bool:
    if "--yes" in sys.argv:
        return True
    print("⚠️  Esto borra TODOS los usuarios, pacientes, profesionales,")
    print("   consultas, pagos, recetas, notas clínicas, chats, etc. de")
    print("   PRODUCCIÓN. Es irreversible y no se está tomando backup.\n")
    answer = input("Escribí RESET (en mayúsculas) para confirmar: ").strip()
    return answer == "RESET"


if __name__ == "__main__":
    if not confirm():
        print("❌ Cancelado, no se modificó nada.")
        sys.exit(1)
    asyncio.run(reset())
