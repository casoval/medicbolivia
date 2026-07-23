/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Evita doble-mount en desarrollo (necesario para LiveKit)
  // No bloquear el build de producción por errores/warnings de ESLint
  // (hay deuda técnica de lint en varios archivos que no afecta el funcionamiento).
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Permite imágenes desde S3 y servicios externos
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'medicbolivia-docs.s3.amazonaws.com' },
      { protocol: 'https', hostname: 'api.qrserver.com' },
    ],
  },
  // Variables de entorno disponibles en el cliente
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
  // SOLO EN DESARROLLO: el JWT ahora viaja en una cookie httpOnly con
  // SameSite=Strict (ver AUTH_COOKIE_NAME en el backend). Eso requiere
  // que el navegador vea al frontend y al backend como el MISMO origen.
  // En producción ya lo son (nginx sirve todo bajo medicbolivia.com), pero
  // en local el frontend corre en :3000 y el backend en :4000 — origins
  // distintos para el navegador, así que la cookie no viajaría.
  // Este rewrite hace que el navegador solo le hable a localhost:3000, y
  // es Next quien reenvía /api/v1/* a localhost:4000 por atrás (esto
  // incluye el handshake del WebSocket de chat, que cuelga de la misma
  // ruta /api/v1/chat/ws/...).
  // Para que esto funcione, NEXT_PUBLIC_API_URL en .env.local debe ser
  // la ruta relativa "/api/v1" (ver .env.example) en vez de una URL
  // absoluta a localhost:4000.
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return []
    const backendUrl = process.env.BACKEND_URL_FOR_DEV_PROXY || 'http://localhost:4000'
    return [
      { source: '/api/v1/:path*', destination: `${backendUrl}/api/v1/:path*` },
    ]
  },
}
module.exports = nextConfig