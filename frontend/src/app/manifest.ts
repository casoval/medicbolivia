// src/app/manifest.ts
// Next.js genera automáticamente /manifest.webmanifest a partir de este
// archivo. Ayuda al "instalar app" en celulares y suma señales para Google.
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MedicBolivia — Telemedicina con IA',
    short_name: 'MedicBolivia',
    description:
      'Consultas médicas online en Bolivia coordinadas por un agente de inteligencia artificial. Médicos y especialistas verificados, videoconsulta, receta digital y pago con QR.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F6FA',
    theme_color: '#11A15A',
    lang: 'es-BO',
    icons: [
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  }
}
