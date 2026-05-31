/** @type {import('next').NextConfig} */
const nextConfig = {
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
}

module.exports = nextConfig
