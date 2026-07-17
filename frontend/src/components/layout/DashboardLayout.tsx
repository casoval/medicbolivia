'use client'
// src/components/layout/DashboardLayout.tsx

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/lib/store'
import { NotificationToast } from './NotificationToast'
import { FloatingNotificationBell } from './FloatingNotificationBell'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import type { UserRole } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
  description?: string
}

interface DashboardLayoutProps {
  children: React.ReactNode
  navItems: NavItem[]
  activeHref: string
  role: UserRole
}

export function DashboardLayout({ children, navItems, activeHref, role }: DashboardLayoutProps) {
  const router = useRouter()
  const { user, isAuthenticated, logout } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useLanguage()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, router])

  // Cierra el drawer automáticamente al cambiar de página
  useEffect(() => {
    setMenuOpen(false)
  }, [activeHref])

  // Evita el scroll del body cuando el drawer está abierto en mobile
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  if (!user) return null

  const roleLabels: Record<UserRole, string> = {
    PATIENT: 'Paciente',
    PROFESSIONAL: 'Profesional',
    ADMIN: 'Administrador',
  }

  const fullName = user.first_name
    ? `${user.first_name} ${user.last_name ?? ''}`.trim()
    : null

  const firstName = user.first_name ?? null

  const initials = user.first_name
    ? `${user.first_name[0]}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : user.role === 'PATIENT' ? 'P' : user.role === 'PROFESSIONAL' ? 'M' : 'A'

  const navLinkClass = (isActive: boolean) => `
    flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg text-sm
    transition-colors duration-100
    ${isActive
      ? role === 'PATIENT'
        ? 'bg-[#E6F1FB] text-[#185FA5] font-medium'
        : role === 'PROFESSIONAL'
        ? 'bg-[#E7F8EF] text-[#0F6E56] font-medium'
        : 'bg-[#E7F8EF] text-[#0F6E56] font-medium'
      : 'text-[#6B738A] hover:bg-[#F5F6FA] hover:text-[#141820]'
    }
  `

  const NavLinks = () => (
    <nav className="py-3">
      {navItems.map((item) => {
        const isActive = activeHref === item.href
        return (
          <Link key={item.href} href={item.href} className={navLinkClass(isActive)} title={item.description}>
            <span className="flex-shrink-0">{item.icon}</span>
            <span className="flex-1">{t(item.label)}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="w-5 h-5 bg-[#E24B4A] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )

  const LogoutButton = () => (
    <button
      onClick={logout}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#6B738A] hover:bg-[#FCEBEB] hover:text-[#A32D2D] rounded-lg transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
      </svg>
      {t('Cerrar sesión')}
    </button>
  )

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex flex-col">

      {/* Topbar — degradado azul marino → verde oscuro, con el logo en una placa blanca compacta */}
      <header className="bg-gradient-to-r from-[#042C53] to-[#0F6E56] h-[52px] flex items-center justify-between px-4 sm:px-5 sticky top-0 z-50">
        <div className="flex items-center gap-2 shrink-0">
          {/* Botón hamburguesa — solo visible en mobile/tablet */}
          <button
            onClick={() => setMenuOpen(true)}
            className="md:hidden -ml-1 mr-1 w-8 h-8 flex items-center justify-center text-white/90 hover:text-white shrink-0"
            aria-label="Abrir menú"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <Link href="/" className="flex items-center shrink-0">
            <span className="text-base sm:text-lg font-semibold text-white tracking-tight">
              medic<span className="text-white/70 font-normal">bolivia</span><span className="text-white/60 text-xs font-normal">.com</span>
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Selector de idioma — solo visual, ahora disponible en toda la app */}
          <LanguageSwitcher variant="dark" />
          {firstName && (
            <span className="sm:hidden text-sm text-white font-medium max-w-[80px] truncate">
              {firstName}
            </span>
          )}
          {fullName && (
            <span className="hidden sm:inline text-sm text-white font-medium whitespace-nowrap">
              {fullName}
            </span>
          )}
          <span className={`${firstName ? 'hidden' : 'inline'} sm:inline shrink-0 text-xs bg-white/15 text-white px-2.5 py-1 rounded-full font-medium whitespace-nowrap`}>
            {t(roleLabels[role])}
          </span>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-white text-[#0F6E56] shrink-0">
            {initials}
          </div>
        </div>
      </header>

      {/* Contenido */}
      <div className="flex flex-1 relative">

        {/* Overlay oscuro — solo visible en mobile cuando el drawer está abierto */}
        {menuOpen && (
          <div
            onClick={() => setMenuOpen(false)}
            className="md:hidden fixed inset-0 bg-black/40 z-40"
            aria-hidden="true"
          />
        )}

        {/* Sidebar — fijo en desktop, drawer deslizante en mobile */}
        <aside
          className={`
            fixed md:sticky top-0 md:top-[52px] left-0 z-50
            h-full md:h-[calc(100vh-52px)]
            w-[230px] md:w-[210px] bg-white border-r border-[#DDE1EE]
            flex-shrink-0 flex flex-col
            transform transition-transform duration-200 ease-out
            ${menuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
          `}
        >
          {/* Header del drawer — solo en mobile, para poder cerrar */}
          <div className="md:hidden h-[52px] flex items-center justify-between px-4 border-b border-[#DDE1EE] flex-shrink-0">
            <span className="text-sm font-semibold text-[#141820]">Menú</span>
            <button
              onClick={() => setMenuOpen(false)}
              className="w-8 h-8 flex items-center justify-center text-[#6B738A] hover:text-[#141820]"
              aria-label="Cerrar menú"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <NavLinks />
          </div>

          {/* Cerrar sesión */}
          <div className="px-2 py-3 border-t border-[#DDE1EE] md:border-t-0 flex-shrink-0">
            <LogoutButton />
          </div>
        </aside>

        {/* Contenido principal */}
        <main className="flex-1 w-full min-w-0 p-4 sm:p-5 overflow-y-auto overflow-x-hidden animate-fade-up">
          {children}
        </main>
      </div>

      {/* Notificaciones flotantes — visibles en cualquier pestaña */}
      <NotificationToast />

      {/* Ícono redondo flotante — avisa de notificaciones nuevas estés donde estés */}
      <FloatingNotificationBell />
    </div>
  )
}