// src/lib/seo/specialties.ts
//
// Catálogo de especialidades médicas usado SOLO para generar contenido
// indexable por Google (páginas /especialidades y /especialidades/[slug]).
// Los nombres coinciden con el seed real del backend
// (backend/app/db/seed_specialties.py) para que lo que promete Google
// coincida con lo que el usuario encuentra dentro de la plataforma.
//
// Si agregás una especialidad nueva en el backend, agregala también acá
// para que tenga su propia página SEO.

export type SeoSpecialty = {
  slug: string
  name: string
  // Descripción corta usada en <meta description> y en la tarjeta del hub.
  description: string
  // Frase natural para el <h1> / intro de la página de detalle.
  intro: string
  // Subespecialidades típicas (mostradas como chips en la página de detalle).
  subspecialties: string[]
  // Ícono lucide-react (nombre) usado en la tarjeta.
  icon: string
}

export const SEO_SPECIALTIES: SeoSpecialty[] = [
  {
    slug: 'medicina-general',
    name: 'Medicina General',
    description: 'Consulta con un médico general online en Bolivia, las 24 horas, coordinada por un agente de IA.',
    intro: 'Médico general online en Bolivia',
    subspecialties: [],
    icon: 'Stethoscope',
  },
  {
    slug: 'medicina-familiar',
    name: 'Medicina Familiar',
    description: 'Atención médica familiar y comunitaria por videoconsulta, para toda la familia.',
    intro: 'Medicina familiar por telemedicina',
    subspecialties: ['Medicina familiar comunitaria', 'Atención primaria'],
    icon: 'Users',
  },
  {
    slug: 'pediatria',
    name: 'Pediatría',
    description: 'Pediatras online verificados para la consulta de tus hijos, con receta digital al instante.',
    intro: 'Pediatra online en Bolivia',
    subspecialties: ['Neonatología', 'Cardiología pediátrica', 'Neurología pediátrica', 'Gastroenterología pediátrica'],
    icon: 'Baby',
  },
  {
    slug: 'ginecologia-y-obstetricia',
    name: 'Ginecología y Obstetricia',
    description: 'Consulta ginecológica y de obstetricia online con especialistas verificados en Bolivia.',
    intro: 'Ginecólogo online en Bolivia',
    subspecialties: ['Obstetricia', 'Ginecología oncológica', 'Medicina materno-fetal', 'Uroginecología'],
    icon: 'HeartPulse',
  },
  {
    slug: 'cardiologia',
    name: 'Cardiología',
    description: 'Cardiólogos online para el control de presión, arritmias y salud cardiovascular.',
    intro: 'Cardiólogo online en Bolivia',
    subspecialties: ['Electrofisiología cardíaca', 'Cardiología pediátrica', 'Cardiología preventiva'],
    icon: 'Heart',
  },
  {
    slug: 'medicina-interna',
    name: 'Medicina Interna',
    description: 'Especialistas en medicina interna para el diagnóstico y seguimiento de enfermedades del adulto.',
    intro: 'Internista online en Bolivia',
    subspecialties: ['Cardiología clínica', 'Endocrinología', 'Gastroenterología', 'Neumología', 'Nefrología'],
    icon: 'Activity',
  },
  {
    slug: 'dermatologia',
    name: 'Dermatología',
    description: 'Dermatólogos online para consultas de piel, acné, manchas y alergias cutáneas, con foto incluida.',
    intro: 'Dermatólogo online en Bolivia',
    subspecialties: ['Dermatología pediátrica', 'Dermatología estética', 'Cirugía dermatológica'],
    icon: 'Sparkles',
  },
  {
    slug: 'psiquiatria',
    name: 'Psiquiatría',
    description: 'Consulta psiquiátrica online, confidencial y con profesionales verificados.',
    intro: 'Psiquiatra online en Bolivia',
    subspecialties: ['Psiquiatría infantil y adolescente', 'Psiquiatría geriátrica', 'Adicciones'],
    icon: 'Brain',
  },
  {
    slug: 'psicologia',
    name: 'Psicología',
    description: 'Terapia psicológica online con psicólogos clínicos verificados en Bolivia.',
    intro: 'Psicólogo online en Bolivia',
    subspecialties: ['Psicología clínica', 'Psicología infantil', 'Psicología de pareja y familia'],
    icon: 'MessageCircleHeart',
  },
  {
    slug: 'neurologia',
    name: 'Neurología',
    description: 'Neurólogos online para migrañas, epilepsia y trastornos neurológicos.',
    intro: 'Neurólogo online en Bolivia',
    subspecialties: ['Neurología pediátrica', 'Epileptología', 'Trastornos del movimiento'],
    icon: 'Brain',
  },
  {
    slug: 'traumatologia-y-ortopedia',
    name: 'Traumatología y Ortopedia',
    description: 'Traumatólogos online para lesiones, dolor articular y consultas post fractura.',
    intro: 'Traumatólogo online en Bolivia',
    subspecialties: ['Cirugía de columna', 'Medicina deportiva', 'Ortopedia pediátrica'],
    icon: 'Bone',
  },
  {
    slug: 'oftalmologia',
    name: 'Oftalmología',
    description: 'Consulta oftalmológica online para dudas de visión, ojo rojo y seguimiento de tratamientos.',
    intro: 'Oftalmólogo online en Bolivia',
    subspecialties: ['Retina y vítreo', 'Glaucoma', 'Oftalmología pediátrica'],
    icon: 'Eye',
  },
  {
    slug: 'otorrinolaringologia',
    name: 'Otorrinolaringología',
    description: 'Especialistas en oído, nariz y garganta disponibles por videoconsulta.',
    intro: 'Otorrinolaringólogo online en Bolivia',
    subspecialties: ['Otología', 'Audiología', 'Cirugía de cabeza y cuello'],
    icon: 'Ear',
  },
  {
    slug: 'urologia',
    name: 'Urología',
    description: 'Consulta urológica online, confidencial, para el hombre y la mujer.',
    intro: 'Urólogo online en Bolivia',
    subspecialties: ['Urología oncológica', 'Andrología', 'Urología pediátrica'],
    icon: 'Stethoscope',
  },
  {
    slug: 'endocrinologia',
    name: 'Endocrinología',
    description: 'Endocrinólogos online para diabetes, tiroides y control hormonal.',
    intro: 'Endocrinólogo online en Bolivia',
    subspecialties: ['Diabetología', 'Tiroides y metabolismo', 'Endocrinología reproductiva'],
    icon: 'Activity',
  },
  {
    slug: 'gastroenterologia',
    name: 'Gastroenterología',
    description: 'Gastroenterólogos online para consultas digestivas y de hígado.',
    intro: 'Gastroenterólogo online en Bolivia',
    subspecialties: ['Hepatología', 'Endoscopía digestiva', 'Enfermedad inflamatoria intestinal'],
    icon: 'Activity',
  },
  {
    slug: 'nutricion-y-dietetica',
    name: 'Nutrición y Dietética',
    description: 'Nutricionistas online para bajar de peso, deporte o alimentación clínica.',
    intro: 'Nutricionista online en Bolivia',
    subspecialties: ['Nutrición clínica', 'Nutrición deportiva', 'Nutrición pediátrica'],
    icon: 'Apple',
  },
  {
    slug: 'medicina-estetica',
    name: 'Medicina Estética',
    description: 'Consulta online de medicina estética facial y corporal con profesionales verificados.',
    intro: 'Medicina estética online en Bolivia',
    subspecialties: ['Medicina estética facial', 'Medicina estética corporal'],
    icon: 'Sparkles',
  },
  {
    slug: 'geriatria',
    name: 'Geriatría',
    description: 'Atención geriátrica online para el cuidado de adultos mayores.',
    intro: 'Geriatra online en Bolivia',
    subspecialties: ['Demencias y deterioro cognitivo', 'Cuidados paliativos geriátricos'],
    icon: 'HeartPulse',
  },
  {
    slug: 'medicina-del-deporte',
    name: 'Medicina del Deporte',
    description: 'Consulta con medicina del deporte online para deportistas y rehabilitación.',
    intro: 'Medicina del deporte online en Bolivia',
    subspecialties: ['Rehabilitación deportiva', 'Medicina del ejercicio'],
    icon: 'Activity',
  },
  {
    slug: 'odontologia',
    name: 'Odontología',
    description: 'Orientación odontológica online: primera opinión antes de ir al consultorio.',
    intro: 'Odontología online en Bolivia',
    subspecialties: ['Ortodoncia', 'Endodoncia', 'Odontopediatría'],
    icon: 'Smile',
  },
]

export function getSpecialtyBySlug(slug: string): SeoSpecialty | undefined {
  return SEO_SPECIALTIES.find((s) => s.slug === slug)
}
