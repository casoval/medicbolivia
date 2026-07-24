// src/app/especialidades/[slug]/page.tsx
// Una página estática (generateStaticParams) por especialidad, cada una
// con su propio <title>/<meta description> orientada a búsquedas del tipo
// "cardiólogo online Bolivia", "pediatra online La Paz", etc.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import * as Icons from 'lucide-react'
import { SEO_SPECIALTIES, getSpecialtyBySlug } from '@/lib/seo/specialties'

const SITE_URL = 'https://medicbolivia.com'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return SEO_SPECIALTIES.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const specialty = getSpecialtyBySlug(params.slug)
  if (!specialty) return {}

  const title = `${specialty.name} online en Bolivia`
  return {
    title,
    description: specialty.description,
    alternates: { canonical: `${SITE_URL}/especialidades/${specialty.slug}` },
    openGraph: {
      title: `${title} | MedicBolivia`,
      description: specialty.description,
      url: `${SITE_URL}/especialidades/${specialty.slug}`,
      type: 'website',
    },
  }
}

export default async function SpecialtyPage(props: Props) {
  const params = await props.params;
  const specialty = getSpecialtyBySlug(params.slug)
  if (!specialty) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Icon = (Icons as any)[specialty.icon] ?? Icons.Stethoscope

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: `${specialty.name} online en Bolivia`,
    description: specialty.description,
    url: `${SITE_URL}/especialidades/${specialty.slug}`,
    about: {
      '@type': 'MedicalSpecialty',
      name: specialty.name,
    },
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Especialidades', item: `${SITE_URL}/especialidades` },
        { '@type': 'ListItem', position: 3, name: specialty.name, item: `${SITE_URL}/especialidades/${specialty.slug}` },
      ],
    },
  }

  const others = SEO_SPECIALTIES.filter((s) => s.slug !== specialty.slug).slice(0, 6)

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

      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav className="text-xs text-[#6B738A] mb-6" aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">Inicio</Link>
          {' / '}
          <Link href="/especialidades" className="hover:underline">Especialidades</Link>
          {' / '}
          <span className="text-[#141820]">{specialty.name}</span>
        </nav>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-[#E7F8EF] flex items-center justify-center flex-shrink-0">
            <Icon className="w-7 h-7 text-[#11A15A]" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#141820]">{specialty.intro}</h1>
        </div>

        <p className="text-[#6B738A] mb-6">{specialty.description}</p>

        <div className="bg-white border border-[#DDE1EE] rounded-2xl p-6 mb-8">
          <h2 className="font-semibold text-[#141820] mb-2">
            ¿Cómo consultar con un profesional de {specialty.name.toLowerCase()} en MedicBolivia?
          </h2>
          <ol className="space-y-1.5 text-sm text-[#6B738A] list-decimal list-inside">
            <li>Registrate gratis como paciente en MedicBolivia.</li>
            <li>Contale a Medi, nuestro agente de orientación con IA, qué te está pasando.</li>
            <li>Medi te deriva con un profesional de {specialty.name.toLowerCase()} verificado.</li>
            <li>Hacé tu videoconsulta y recibí tu receta digital al instante.</li>
          </ol>
          <Link
            href="/auth/register/patient"
            className="inline-block mt-5 bg-[#11A15A] text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-[#0F6E56] transition-colors"
          >
            Consultar ahora
          </Link>
        </div>

        {specialty.subspecialties.length > 0 && (
          <div className="mb-8">
            <h2 className="font-semibold text-[#141820] mb-3">Subespecialidades relacionadas</h2>
            <div className="flex flex-wrap gap-2">
              {specialty.subspecialties.map((sub) => (
                <span key={sub} className="text-xs bg-white border border-[#DDE1EE] text-[#6B738A] px-3 py-1.5 rounded-full">
                  {sub}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="font-semibold text-[#141820] mb-3">Otras especialidades disponibles</h2>
          <div className="flex flex-wrap gap-2">
            {others.map((s) => (
              <Link
                key={s.slug}
                href={`/especialidades/${s.slug}`}
                className="text-xs bg-white border border-[#DDE1EE] text-[#0F6E56] px-3 py-1.5 rounded-full hover:border-[#11A15A]"
              >
                {s.name}
              </Link>
            ))}
            <Link
              href="/especialidades"
              className="text-xs bg-[#E7F8EF] text-[#0F6E56] px-3 py-1.5 rounded-full font-medium"
            >
              Ver todas →
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
