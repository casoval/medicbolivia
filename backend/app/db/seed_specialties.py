"""
app/db/seed_specialties.py
Seed del catálogo de especialidades y subespecialidades médicas.

Usa los nombres oficiales tal como se registran en Bolivia (ej. "Ginecología
y Obstetricia", "Traumatología y Ortopedia"), no abreviaturas coloquiales.

Ejecutar una sola vez (o cada vez que se agregue algo a SPECIALTIES_SEED):
    python -m app.db.seed_specialties

Es idempotente: si una especialidad o subespecialidad ya existe (por nombre),
no la duplica, así que es seguro correrlo varias veces.

Nota: si tu base de datos ya tiene especialidades sembradas con los nombres
cortos antiguos (Ginecología, Traumatología, Alergología, Nutrición, Cirugía
Plástica), corré primero migrate_specialties_official_names.py — ese script
las renombra a su forma oficial antes de aplicar este catálogo, para evitar
duplicados.
"""
import asyncio
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.models import Specialty, SubSpecialty


# Especialidad → lista de subespecialidades típicas.
# Nombres oficiales usados en Bolivia. Si falta alguna específica de tu
# mercado, se agrega aquí y se corre el seed de nuevo — es idempotente.
SPECIALTIES_SEED: dict[str, list[str]] = {
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


async def seed_specialties() -> None:
    async with AsyncSessionLocal() as db:
        created_specialties = 0
        created_sub = 0

        for specialty_name, sub_names in SPECIALTIES_SEED.items():
            result = await db.execute(
                select(Specialty).where(Specialty.name == specialty_name)
            )
            specialty = result.scalar_one_or_none()

            if not specialty:
                specialty = Specialty(name=specialty_name, is_active=True)
                db.add(specialty)
                await db.flush()  # para tener specialty.id disponible
                created_specialties += 1

            for sub_name in sub_names:
                result = await db.execute(
                    select(SubSpecialty).where(
                        SubSpecialty.specialty_id == specialty.id,
                        SubSpecialty.name == sub_name,
                    )
                )
                existing_sub = result.scalar_one_or_none()
                if not existing_sub:
                    db.add(SubSpecialty(
                        specialty_id=specialty.id,
                        name=sub_name,
                        is_active=True,
                    ))
                    created_sub += 1

        await db.commit()
        print(f"✅ Seed completo: {created_specialties} especialidades nuevas, {created_sub} subespecialidades nuevas.")
        print(f"   (Total en SPECIALTIES_SEED: {len(SPECIALTIES_SEED)} especialidades, "
              f"{sum(len(v) for v in SPECIALTIES_SEED.values())} subespecialidades)")


if __name__ == "__main__":
    asyncio.run(seed_specialties())
