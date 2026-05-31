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

export const metadata: Metadata = {
  title: {
    default: 'MedicBolivia — Telemedicina con IA',
    template: '%s | MedicBolivia',
  },
  description: 'Consultas médicas en línea coordinadas por inteligencia artificial. Conectamos pacientes con profesionales de salud en Bolivia.',
  keywords: ['telemedicina', 'Bolivia', 'médico online', 'consulta médica', 'agente IA'],
  authors: [{ name: 'MedicBolivia' }],
  openGraph: {
    title: 'MedicBolivia — Telemedicina con IA',
    description: 'Consultas médicas en línea para Bolivia',
    locale: 'es_BO',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={outfit.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
