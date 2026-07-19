// src/app/telemedicina/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck, Video, Bot, FileCheck2, Clock, MapPin } from 'lucide-react'

const SITE_URL = 'https://medicbolivia.com'

export const metadata: Metadata = {
  title: 'Telemedicina en Bolivia con inteligencia artificial',
  description:
    'MedicBolivia es la plataforma de telemedicina en Bolivia que usa inteligencia artificial para orientarte y conectarte al instante con médicos y especialistas verificados, por videoconsulta, desde cualquier parte del país.',
  alternates: { canonical: `${SITE_URL}/telemedicina` },
  openGraph: {
    title: 'Telemedicina en Bolivia con inteligencia artificial | MedicBolivia',
    description:
      'Consultas médicas online coordinadas por un agente de IA. Videoconsulta, receta digital y pago con QR, desde cualquier ciudad de Bolivia.',
    url: `${SITE_URL}/telemedicina`,
    type: 'website',
  },
}

const FEATURES = [
  {
    icon: Bot,
    title: 'Orientación con inteligencia artificial',
    text: 'Nuestro agente de IA, Medi, te escucha por texto o por voz y te deriva al profesional de salud indicado según tus síntomas.',
  },
  {
    icon: Video,
    title: 'Videoconsulta en tiempo real',
    text: 'Videollamada médica de baja latencia y cifrado de extremo a extremo, pensada para funcionar bien incluso con datos móviles.',
  },
  {
    icon: FileCheck2,
    title: 'Receta digital verificable',
    text: 'Recibí tu receta al instante, con código QR verificable, sin necesidad de imprimir nada.',
  },
  {
    icon: ShieldCheck,
    title: 'Profesionales verificados',
    text: 'Todos los médicos y especialistas de la plataforma pasan por un proceso de verificación de credenciales.',
  },
  {
    icon: Clock,
    title: 'Disponible las 24 horas',
    text: 'Consultá cuando lo necesites, incluidos fines de semana y feriados.',
  },
  {
    icon: MapPin,
    title: 'Desde cualquier ciudad de Bolivia',
    text: 'La Paz, Santa Cruz, Cochabamba, Sucre, Tarija, Oruro, Potosí y Beni — solo necesitás conexión a internet.',
  },
]

export default function TelemedicinaPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: 'Telemedicina en Bolivia con inteligencia artificial',
    description: metadata.description,
    url: `${SITE_URL}/telemedicina`,
    about: { '@type': 'MedicalProcedure', name: 'Telemedicina' },
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="border-b border-[#DDE1EE] bg-white">
        <div className="max-w-5xl mx-auto px-4 h-16 sm:h-20 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-[#141820]">MedicBolivia</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/especialidades" className="text-[#6B738A] hover:text-[#141820]">Especialidades</Link>
            <Link href="/auth/register/patient" className="bg-[#11A15A] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#0F6E56] transition-colors">
              Registrarme
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-[#141820] text-center mb-4">
          Telemedicina en Bolivia, coordinada por inteligencia artificial
        </h1>
        <p className="text-[#6B738A] text-center max-w-2xl mx-auto mb-12">
          MedicBolivia conecta pacientes con médicos y especialistas
          verificados a través de videoconsulta. Un agente de IA te escucha
          primero, entiende tu caso y te deriva al profesional correcto —
          sin filas, sin trámites, desde cualquier lugar de Bolivia.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-14">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white border border-[#DDE1EE] rounded-xl p-5 flex gap-4">
              <div className="w-11 h-11 rounded-lg bg-[#E7F8EF] flex items-center justify-center flex-shrink-0">
                <f.icon className="w-5 h-5 text-[#11A15A]" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#141820] mb-1">{f.title}</p>
                <p className="text-sm text-[#6B738A]">{f.text}</p>
              </div>
            </div>
          ))}
        </div>

        <section className="bg-white border border-[#DDE1EE] rounded-2xl p-6 sm:p-8 text-center">
          <h2 className="text-xl font-bold text-[#141820] mb-2">
            ¿Qué especialidad necesitás?
          </h2>
          <p className="text-sm text-[#6B738A] mb-5">
            Medicina general, pediatría, ginecología, cardiología, dermatología,
            psicología y muchas más especialidades disponibles online.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/especialidades"
              className="border border-[#11A15A] text-[#0F6E56] text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-[#E7F8EF] transition-colors"
            >
              Ver especialidades
            </Link>
            <Link
              href="/auth/register/patient"
              className="bg-[#11A15A] text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-[#0F6E56] transition-colors"
            >
              Empezar mi consulta
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
