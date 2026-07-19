// src/app/robots.ts
// Next.js genera automáticamente /robots.txt a partir de este archivo.
import type { MetadataRoute } from 'next'

const BASE_URL = 'https://medicbolivia.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Áreas privadas / autenticadas: no tiene sentido ni conviene que
        // Google las rastree o las muestre en resultados de búsqueda.
        disallow: [
          '/patient/',
          '/professional/',
          '/admin/',
          '/auth/login',
          '/mantenimiento',
          '/api/',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
