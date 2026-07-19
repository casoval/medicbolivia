// src/app/especialidades/page.tsx
// Página pública, indexable por Google. A diferencia de la landing (que es
// un client component), esta es un Server Component: puede exportar su
// propio <title>/<meta description> y Google la recibe ya renderizada.
import type { Metadata } from 'next'
import Link from 'next/link'
import * as Icons from 'lucide-react'
import { SEO_SPECIALTIES } from '@/lib/seo/specialties'

const SITE_URL = 'https://medicbolivia.com'

export const metadata: Metadata = {
  title: 'Especialidades médicas online en Bolivia',
  description:
    'Elegí tu especialidad y consultá online con médicos y especialistas verificados en Bolivia: medicina general, pediatría, ginecología, cardiología, dermatología, psicología y más.',
  alternates: { canonical: `${SITE_URL}/especialidades` },
  openGraph: {
    title: 'Especialidades médicas online en Bolivia | MedicBolivia',
    description:
      'Elegí tu especialidad y consultá online con médicos y especialistas verificados en Bolivia.',
    url: `${SITE_URL}/especialidades`,
    type: 'website',
  },
}

function SpecialtyIcon({ name }: { name: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[name] ?? Icons.Stethoscope
  return <Icon className="w-6 h-6 text-[#11A15A]" aria-hidden="true" />
}

export default function EspecialidadesPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Especialidades médicas disponibles en MedicBolivia',
    itemListElement: SEO_SPECIALTIES.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/especialidades/${s.slug}`,
      name: s.name,
    })),
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
          <Link href="/" className="text-lg font-bold text-[#141820]">
            MedicBolivia
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/telemedicina" className="text-[#6B738A] hover:text-[#141820]">Telemedicina</Link>
            <Link href="/auth/register/patient" className="bg-[#11A15A] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#0F6E56] transition-colors">
              Registrarme
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-[#141820] text-center mb-4">
          Especialidades médicas online en Bolivia
        </h1>
        <p className="text-[#6B738A] text-center max-w-2xl mx-auto mb-10">
          En MedicBolivia contás tus síntomas a nuestro agente de orientación
          con inteligencia artificial y te conecta, en minutos, con el médico
          o especialista verificado que corresponde — por videoconsulta,
          desde cualquier ciudad de Bolivia.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {SEO_SPECIALTIES.map((s) => (
            <Link
              key={s.slug}
              href={`/especialidades/${s.slug}`}
              className="flex items-start gap-3 bg-white border border-[#DDE1EE] rounded-xl p-4 hover:border-[#11A15A] hover:shadow-sm transition-all"
            >
              <div className="w-11 h-11 rounded-lg bg-[#E7F8EF] flex items-center justify-center flex-shrink-0">
                <SpecialtyIcon name={s.icon} />
              </div>
              <div>
                <p className="font-semibold text-[#141820]">{s.name}</p>
                <p className="text-xs text-[#6B738A] mt-0.5 line-clamp-2">{s.description}</p>
              </div>
            </Link>
          ))}
        </div>

        <section className="mt-16 bg-white border border-[#DDE1EE] rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-[#141820] mb-3">
            ¿Cómo funciona la consulta con especialistas en MedicBolivia?
          </h2>
          <ol className="space-y-2 text-sm text-[#6B738A] list-decimal list-inside">
            <li>Contale tus síntomas a Medi, nuestro agente de orientación con IA, por texto o por voz.</li>
            <li>Medi te deriva al médico general o al especialista verificado que corresponde a tu caso.</li>
            <li>Tenés tu videoconsulta médica desde el celular o la computadora, sin salir de tu casa.</li>
            <li>Recibís tu receta digital, verificable con código QR, y podés pagar la consulta en línea.</li>
          </ol>
          <div className="mt-6">
            <Link
              href="/auth/register/patient"
              className="inline-block bg-[#11A15A] text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-[#0F6E56] transition-colors"
            >
              Empezar mi consulta
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
