// src/app/layout.tsx
import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import { Providers } from '@/components/layout/Providers'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  weight: ['300', '400', '500', '600', '700'],
})

const SITE_URL = 'https://medicbolivia.com'
const SITE_NAME = 'MedicBolivia'
const SITE_TITLE = 'MedicBolivia — Médicos online y telemedicina con IA en Bolivia'
const SITE_DESCRIPTION =
  'Consultá médicos y especialistas online en Bolivia las 24 horas. Un agente de inteligencia artificial te escucha, te deriva al profesional verificado indicado y coordina tu videoconsulta, receta digital y pago con QR.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s | MedicBolivia',
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'telemedicina Bolivia',
    'médico online Bolivia',
    'consulta médica online',
    'especialistas online',
    'médicos con inteligencia artificial',
    'IA médica',
    'agente IA salud',
    'videoconsulta médica',
    'receta digital Bolivia',
    'doctor online La Paz',
    'doctor online Santa Cruz',
    'doctor online Cochabamba',
  ],
  authors: [{ name: 'MedicBolivia', url: SITE_URL }],
  creator: 'MedicBolivia',
  publisher: 'MedicBolivia',
  category: 'health',
  applicationName: SITE_NAME,
  // Reemplazar por el código real que entrega Google Search Console al
  // verificar la propiedad del dominio (Configuración > Verificación >
  // etiqueta HTML). Sin esto Search Console pedirá verificar por otra vía.
  verification: {
    google: 'PENDIENTE_CODIGO_GOOGLE_SEARCH_CONSOLE',
  },
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'es_BO',
    type: 'website',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'MedicBolivia — Telemedicina con IA',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og-image.jpg'],
  },
}

// Datos estructurados (schema.org) en JSON-LD: le explican a Google, en un
// formato que entiende directamente, qué es MedicBolivia (una organización
// de salud), qué sitio es y cómo funciona su buscador interno. Esto es lo
// que habilita resultados enriquecidos (sitelinks, buscador, etc.) y ayuda
// a que Google entienda de qué trata el sitio incluso antes de rastrear
// todo el contenido.
function StructuredData() {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'MedicalBusiness',
      '@id': `${SITE_URL}/#organization`,
      name: 'MedicBolivia',
      alternateName: 'Medic Bolivia',
      url: SITE_URL,
      logo: `${SITE_URL}/icon.png`,
      image: `${SITE_URL}/og-image.jpg`,
      description: SITE_DESCRIPTION,
      email: 'info@medicbolivia.com',
      areaServed: {
        '@type': 'Country',
        name: 'Bolivia',
      },
      medicalSpecialty: [
        'Medicina General',
        'Pediatría',
        'Ginecología y Obstetricia',
        'Cardiología',
        'Dermatología',
        'Psiquiatría',
        'Psicología',
        'Neurología',
        'Traumatología y Ortopedia',
      ],
      availableService: {
        '@type': 'MedicalTherapy',
        name: 'Telemedicina / consulta médica online',
      },
      sameAs: [],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'MedicBolivia',
      description: SITE_DESCRIPTION,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'es-BO',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/especialidades?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ]

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={outfit.variable}>
      <head>
        <StructuredData />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
