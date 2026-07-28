// src/components/layout/PublicHeader.tsx
// Header compartido por las páginas públicas indexables por Google
// (Especialidades, Telemedicina, detalle de especialidad — no la landing,
// que tiene su propio header con más links y menú hamburguesa, ver
// LandingHeader en app/page.tsx). Antes cada una de estas páginas tenía su
// propio <header> copiado a mano: usaban "MedicBolivia" en texto plano en
// vez del logo real, y ninguna tenía el botón "Iniciar sesión" — solo
// "Registrarme". Ese tipo de duplicación es justo lo que hace que un fix
// (como agregar el logo real, o mostrar siempre los dos botones) haya que
// aplicarlo a mano en 3-4 lugares y se termine olvidando alguno.
//
// Son Server Components (para que Google reciba el HTML ya renderizado con
// su <title>/<meta description> propios), así que este header tampoco usa
// estado de cliente — solo Link/Image, que funcionan igual en server y
// cliente.
import Link from 'next/link'
import Image from 'next/image'

const NAV_LINKS = [
  { href: '/especialidades', label: 'Especialidades' },
  { href: '/telemedicina', label: 'Telemedicina' },
]

export function PublicHeader() {
  return (
    <header className="border-b border-[#DDE1EE] bg-white">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 h-16 sm:h-20 flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center shrink-0">
          <Image src="/logo.png" alt="MedicBolivia" width={1779} height={339} className="h-7 sm:h-11 w-auto" priority />
        </Link>

        <nav className="hidden sm:flex items-center gap-6 text-sm text-[#475569]">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-[#141820] transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Iniciar sesión + Registrarme: SIEMPRE visibles, en cualquier
            ancho de pantalla — antes "Iniciar sesión" directamente no
            existía en este header, y era fácil de asumir que "ya se veía
            en la landing" sin notar que estas páginas tienen su propio
            header aparte. shrink-0 para que nunca se compriman aunque el
            nav de arriba no entre y quede oculto. */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Link
            href="/auth/login"
            className="text-xs sm:text-sm font-medium text-[#0F6E56] px-2 sm:px-3 py-2 border border-[#11A15A]/40 rounded-lg hover:bg-[#E7F8EF] transition-colors whitespace-nowrap"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/auth/register/patient"
            className="bg-[#11A15A] text-white text-xs sm:text-sm font-medium px-2.5 sm:px-4 py-2 rounded-lg hover:bg-[#0F6E56] transition-colors whitespace-nowrap"
          >
            Registrarme
          </Link>
        </div>
      </div>
    </header>
  )
}
