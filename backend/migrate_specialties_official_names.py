"""
migrate_specialties_official_names.py

Corrige el catálogo de especialidades para usar los nombres oficiales
que se usan en Bolivia (ej. "Ginecología y Obstetricia" en vez de
"Ginecología" a secas).

Qué hace, en orden:
1. Renombra in-place las 5 especialidades que ya se sembraron con el
   nombre corto, para que pasen a tener el nombre oficial completo.
   (Si ya no existen con el nombre corto, no hace nada — es seguro
   correr este script aunque el paso 1 ya se haya aplicado antes.)
2. Siembra el catálogo completo de 76 especialidades oficiales
   (el mismo que está en seed_specialties.py, en la raíz del backend),
   agregando las que falten y sus subespecialidades. Es idempotente:
   si una especialidad o subespecialidad ya existe (por nombre exacto),
   no la duplica.

Uso:
    (venv) $ python migrate_specialties_official_names.py
"""
import asyncio
import uuid

from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.models.models import Specialty, SubSpecialty

# Paso 1: nombre corto ya sembrado -> nombre oficial correcto
RENAMES = {
    "Ginecología": "Ginecología y Obstetricia",
    "Traumatología": "Traumatología y Ortopedia",
    "Alergología": "Alergología e Inmunología",
    "Nutrición": "Nutrición y Dietética",
    "Cirugía Plástica": "Cirugía Plástica y Reconstructiva",
}

# Paso 2: catálogo oficial completo (idéntico al de seed_specialties.py en la raíz)
CATALOG = {
    "Medicina General": [],
    "Medicina Familiar": ["Medicina familiar comunitaria", "Atención primaria"],
    "Medicina Interna": ["Cardiología clínica", "Endocrinología", "Gastroenterología", "Neumología", "Nefrología", "Hematología", "Infectología", "Reumatología", "Geriatría", "Medicina del dolor"],
    "Pediatría": ["Neonatología", "Pediatría del adolescente", "Cardiología pediátrica", "Neurología pediátrica", "Neumología pediátrica", "Gastroenterología pediátrica", "Endocrinología pediátrica", "Infectología pediátrica", "Pediatría social"],
    "Ginecología y Obstetricia": ["Obstetricia", "Ginecología oncológica", "Medicina materno-fetal", "Endocrinología ginecológica y reproductiva", "Uroginecología", "Ginecología infanto-juvenil"],
    "Cardiología": ["Electrofisiología cardíaca", "Hemodinamia e intervencionismo", "Cardiología pediátrica", "Cardiología preventiva"],
    "Neumología": ["Medicina del sueño", "Neumología pediátrica", "Neumología intervencionista"],
    "Gastroenterología": ["Hepatología", "Endoscopía digestiva", "Enfermedad inflamatoria intestinal"],
    "Endocrinología": ["Diabetología", "Tiroides y metabolismo", "Endocrinología reproductiva"],
    "Nefrología": ["Diálisis y trasplante renal", "Hipertensión arterial"],
    "Hematología": ["Hematología oncológica", "Banco de sangre y medicina transfusional", "Trastornos de la coagulación"],
    "Infectología": ["VIH/ITS", "Infectología pediátrica", "Infecciones nosocomiales"],
    "Reumatología": ["Enfermedades autoinmunes sistémicas", "Osteoporosis y metabolismo óseo"],
    "Oncología": ["Oncología clínica", "Oncología quirúrgica", "Radioterapia oncológica", "Oncología pediátrica", "Oncología de mama"],
    "Geriatría": ["Demencias y deterioro cognitivo", "Cuidados paliativos geriátricos"],
    "Dermatología": ["Dermatología pediátrica", "Dermatología estética", "Cirugía dermatológica", "Dermatopatología"],
    "Psiquiatría": ["Psiquiatría infantil y adolescente", "Psiquiatría geriátrica", "Adicciones", "Psiquiatría forense"],
    "Psicología": ["Psicología clínica", "Psicología infantil", "Psicología de pareja y familia", "Neuropsicología", "Psicología deportiva"],
    "Neurología": ["Neurología pediátrica", "Epileptología", "Neurofisiología clínica", "Trastornos del movimiento", "Enfermedad cerebrovascular (ACV)"],
    "Neurocirugía": ["Neurocirugía pediátrica", "Neurocirugía espinal"],
    "Traumatología y Ortopedia": ["Cirugía de columna", "Cirugía de mano", "Cirugía de cadera y rodilla", "Medicina deportiva", "Ortopedia pediátrica", "Artroscopía"],
    "Oftalmología": ["Retina y vítreo", "Cirugía de catarata", "Glaucoma", "Oftalmología pediátrica", "Córnea"],
    "Otorrinolaringología": ["Otología", "Cirugía de cabeza y cuello", "Audiología", "Otoneurología"],
    "Urología": ["Urología oncológica", "Andrología", "Urología pediátrica", "Litiasis renal", "Urología funcional y neurourología"],
    "Cirugía General": ["Cirugía laparoscópica", "Cirugía bariátrica", "Cirugía de trauma"],
    "Cirugía Plástica y Reconstructiva": ["Cirugía estética", "Cirugía de la mano", "Quemados"],
    "Cirugía Cardiovascular": ["Cirugía vascular periférica", "Cirugía cardíaca"],
    "Cirugía Pediátrica": ["Cirugía neonatal", "Cirugía laparoscópica pediátrica"],
    "Cirugía Oncológica": ["Cirugía oncológica digestiva", "Cirugía oncológica de mama"],
    "Anestesiología": ["Anestesia pediátrica", "Manejo del dolor crónico", "Anestesia regional"],
    "Medicina Crítica y Terapia Intensiva": ["Cuidados intensivos pediátricos", "Cuidados intensivos neonatales"],
    "Medicina de Emergencias": ["Toxicología de urgencias", "Trauma y politraumatismo"],
    "Medicina del Deporte": ["Rehabilitación deportiva", "Medicina del ejercicio"],
    "Medicina Estética": ["Medicina estética facial", "Medicina estética corporal"],
    "Medicina Ocupacional y del Trabajo": ["Salud y seguridad laboral", "Ergonomía"],
    "Medicina Legal y Forense": ["Patología forense"],
    "Alergología e Inmunología": ["Alergología pediátrica", "Asma y enfermedades respiratorias alérgicas"],
    "Radiología e Imagenología": ["Radiología intervencionista", "Ecografía", "Resonancia y tomografía"],
    "Patología": ["Anatomía patológica", "Patología clínica"],
    "Nutrición y Dietética": ["Nutrición clínica", "Nutrición deportiva", "Nutrición pediátrica"],
    "Fisioterapia y Rehabilitación": ["Rehabilitación neurológica", "Rehabilitación deportiva", "Terapia ocupacional"],
    "Odontología": ["Ortodoncia", "Endodoncia", "Odontopediatría", "Periodoncia", "Cirugía maxilofacial", "Prostodoncia", "Estética dental"],
    "Genética Médica": ["Genética clínica", "Consejería genética"],
    "Medicina Paliativa": ["Manejo del dolor oncológico"],
    "Salud Mental Comunitaria": ["Prevención de adicciones"],
    "Andrología": ["Infertilidad masculina", "Disfunción eréctil"],
    "Toxicología Clínica": ["Intoxicaciones agudas"],
    "Medicina Tropical e Infecciosa": ["Enfermedades transmitidas por vectores"],
    "Medicina Hiperbárica": [],
    "Medicina Aeroespacial": [],
    "Foniatría y Logopedia": ["Terapia del lenguaje", "Terapia de la voz", "Disfagia"],
    "Terapia Ocupacional": ["Terapia ocupacional pediátrica", "Terapia ocupacional geriátrica"],
    "Podología": ["Pie diabético", "Cirugía podológica"],
    "Audiología y Terapia Auditiva": ["Implantes cocleares"],
    "Medicina del Sueño": ["Apnea del sueño", "Insomnio crónico"],
    "Medicina del Dolor Crónico": ["Bloqueos nerviosos", "Manejo multidisciplinario del dolor"],
    "Cuidado de Heridas y Estomaterapia": ["Heridas crónicas", "Ostomías"],
    "Sexología Clínica": ["Terapia de pareja sexual"],
    "Medicina Reproductiva y Fertilidad": ["Reproducción asistida"],
    "Coloproctología": ["Cirugía colorrectal", "Patología anorrectal"],
    "Cirugía de Tórax": ["Cirugía pulmonar", "Cirugía de mediastino"],
    "Cirugía Maxilofacial": ["Traumatología facial", "Cirugía ortognática"],
    "Cirugía Bariátrica y Metabólica": ["Bypass gástrico", "Manga gástrica"],
    "Medicina Bariátrica No Quirúrgica": ["Manejo integral de la obesidad"],
    "Endocrinología Pediátrica": ["Diabetes infantil", "Trastornos del crecimiento"],
    "Inmunología Clínica": ["Inmunodeficiencias primarias"],
    "Vacunología y Medicina Preventiva": ["Inmunización del adulto", "Inmunización infantil"],
    "Salud Pública y Epidemiología": ["Epidemiología aplicada"],
    "Medicina del Viajero": ["Vacunación internacional"],
    "Climaterio y Menopausia": ["Terapia hormonal"],
    "Sexología y Salud Sexual": ["Educación sexual"],
    "Acupuntura y Medicina Integrativa": [],
    "Homeopatía": [],
    "Naturopatía": [],
    "Quiropraxia": [],
    "Osteopatía": [],
    "Angiología y Cirugía Vascular": ["Flebología", "Linfología clínica", "Cirugía endovascular"],
    "Medicina Nuclear": ["Diagnóstico por imágenes moleculares"],
    "Cirugía de Trasplantes": ["Trasplante renal", "Trasplante hepático"],
}


async def migrate():
    async with AsyncSessionLocal() as db:
        # ── Paso 1: renombrar las 5 que ya existen con nombre corto ──
        renamed = 0
        for old_name, new_name in RENAMES.items():
            result = await db.execute(select(Specialty).where(Specialty.name == old_name))
            specialty = result.scalar_one_or_none()
            if specialty:
                # si por algún motivo el nombre largo también existiera ya, no pisar
                result_new = await db.execute(select(Specialty).where(Specialty.name == new_name))
                if result_new.scalar_one_or_none():
                    print(f"  ⚠️  Ya existían ambos ('{old_name}' y '{new_name}'), dejo el largo y no toco el corto")
                    continue
                specialty.name = new_name
                renamed += 1
                print(f"  ✏️  Renombrada: '{old_name}' → '{new_name}'")
        await db.flush()

        # ── Paso 2: sembrar el catálogo oficial completo (idempotente) ──
        created_specialties = 0
        created_subs = 0

        for specialty_name, sub_names in CATALOG.items():
            result = await db.execute(select(Specialty).where(Specialty.name == specialty_name))
            specialty = result.scalar_one_or_none()

            if not specialty:
                specialty = Specialty(id=str(uuid.uuid4()), name=specialty_name, is_active=True)
                db.add(specialty)
                await db.flush()
                created_specialties += 1
                print(f"  + Especialidad nueva: {specialty_name}")

            for sub_name in sub_names:
                result_sub = await db.execute(
                    select(SubSpecialty).where(
                        SubSpecialty.specialty_id == specialty.id,
                        SubSpecialty.name == sub_name,
                    )
                )
                sub = result_sub.scalar_one_or_none()
                if not sub:
                    db.add(SubSpecialty(
                        id=str(uuid.uuid4()),
                        specialty_id=specialty.id,
                        name=sub_name,
                        is_active=True,
                    ))
                    created_subs += 1

        await db.commit()
        print(f"\n✅ Listo. {renamed} renombradas, {created_specialties} especialidades nuevas, "
              f"{created_subs} subespecialidades nuevas.")
        print(f"   (Catálogo oficial: {len(CATALOG)} especialidades)")


if __name__ == "__main__":
    asyncio.run(migrate())
