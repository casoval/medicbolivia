'use client'
// src/components/layout/DashboardLayout.tsx

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore, useSupportChatUIStore } from '@/lib/store'
import { NotificationToast } from './NotificationToast'
import { FloatingNotificationBell } from './FloatingNotificationBell'
import { ChatWithAdminWidget } from '@/components/shared/ChatWithAdminWidget'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { supportChatAPI, adminSupportChatAPI } from '@/lib/api'
import type { UserRole } from '@/types'

const IconSupportChat = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>

// Botón del encabezado para acceso rápido al chat directo con soporte
// (paciente/profesional ↔ admin). Para PATIENT/PROFESSIONAL abre el
// mismo panel que la burbuja flotante (ChatWithAdminWidget) — funciona
// aunque la burbuja esté oculta. Para ADMIN lleva a la bandeja completa
// (/admin/support-chat), ya que ahí puede haber varias conversaciones
// a la vez, no tiene sentido un popup único.
function SupportChatHeaderButton({ role }: { role: UserRole }) {
  const { t } = useLanguage()
  const router = useRouter()
  const { toggle: toggleWidget, unreadCount: widgetUnread } = useSupportChatUIStore()

  const { data: config } = useQuery({
    queryKey: ['support-chat-config'],
    queryFn: supportChatAPI.getConfig,
    staleTime: 5 * 60 * 1000,
  })

  const { data: adminUnread } = useQuery({
    queryKey: ['admin-support-chat-unread'],
    queryFn: adminSupportChatAPI.getUnreadCount,
    enabled: role === 'ADMIN' && config?.enabled !== false,
    refetchInterval: 20000,
  })

  if (config?.enabled === false) return null

  const badge = role === 'ADMIN' ? (adminUnread?.unread ?? 0) : widgetUnread

  return (
    <button
      onClick={() => (role === 'ADMIN' ? router.push('/admin/support-chat') : toggleWidget())}
      className="relative shrink-0 w-8 h-8 flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 rounded-full transition-colors"
      title={t('Chat con soporte')}
      aria-label={t('Chat con soporte')}
    >
      <IconSupportChat />
      {badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-[#E24B4A] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-[#0F6E56] pointer-events-none">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
  description?: string
  group?: string
  secondary?: boolean
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  // Grupos expandidos del sidebar (modo acordeón). Arranca vacío; el efecto
  // de abajo expande automáticamente el grupo que contiene la página activa.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
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

  // Auto-expande el grupo de la página activa (no cierra los que el usuario
  // ya haya abierto manualmente, para no sorprenderlo al navegar).
  useEffect(() => {
    const activeItem = navItems.find((item) => item.href === activeHref)
    if (activeItem?.group) {
      setOpenGroups((prev) => {
        if (prev.has(activeItem.group as string)) return prev
        const next = new Set(prev)
        next.add(activeItem.group as string)
        return next
      })
    }
  }, [activeHref, navItems])

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

  const navLinkClass = (isActive: boolean, topLevel: boolean) => `
    flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg text-sm
    transition-colors duration-100
    ${topLevel && !isActive ? 'font-medium' : ''}
    ${isActive
      ? role === 'PATIENT'
        ? 'bg-[#E6F1FB] text-[#185FA5] font-medium'
        : role === 'PROFESSIONAL'
        ? 'bg-[#E7F8EF] text-[#0F6E56] font-medium'
        : 'bg-[#E7F8EF] text-[#0F6E56] font-medium'
      : 'text-[#475569] hover:bg-[#F5F6FA] hover:text-[#141820]'
    }
  `

  // Ítems secundarios (Perfil, Ayuda) no van en el sidebar: viven en el
  // menú desplegable del avatar en el topbar, para no competir visualmente
  // con las tareas de uso diario.
  const sidebarItems = navItems.filter((item) => !item.secondary)
  const accountItems = navItems.filter((item) => item.secondary)

  // Ítems sin "group" (Inicio/Resumen) van sueltos arriba; el resto se
  // agrupa bajo el encabezado compartido de su "group", en el orden en
  // que aparece cada grupo por primera vez.
  const ungroupedItems = sidebarItems.filter((item) => !item.group)
  const groupNames: string[] = []
  sidebarItems.forEach((item) => {
    if (item.group && !groupNames.includes(item.group)) groupNames.push(item.group)
  })

  const renderLink = (item: NavItem, topLevel = false) => {
    const isActive = activeHref === item.href
    return (
      <Link key={item.href} href={item.href} className={navLinkClass(isActive, topLevel)} title={item.description}>
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="flex-1">{t(item.label)}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span className="w-5 h-5 bg-[#E24B4A] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {item.badge}
          </span>
        )}
      </Link>
    )
  }

  const toggleGroup = (groupName: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const NavLinks = () => (
    <nav className="py-3">
      {ungroupedItems.map((item) => renderLink(item, true))}
      {groupNames.map((groupName) => {
        const isOpen = openGroups.has(groupName)
        return (
          <div key={groupName} className="mt-2">
            <button
              onClick={() => toggleGroup(groupName)}
              className="w-full flex items-center justify-between gap-2 px-5 py-1.5 text-xs font-bold uppercase tracking-wide text-[#475569] hover:text-[#1E293B] transition-opacity"
              aria-expanded={isOpen}
            >
              <span>{t(groupName)}</span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={`transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`}
              >
                <polyline points="6,9 12,15 18,9" />
              </svg>
            </button>
            {/* Guía vertical + indentación: deja claro que estos ítems son
                hijos del encabezado de arriba, no otro nivel de menú principal. */}
            {isOpen && (
              <div className="ml-5 pl-2 border-l-2 border-[#64748B] space-y-0.5 py-0.5">
                {sidebarItems.filter((item) => item.group === groupName).map((item) => renderLink(item, false))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
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
          <Link href="/?home=1" className="flex items-center shrink-0">
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
          {/* Chat directo con soporte — acceso rápido, siempre visible en
              el encabezado independientemente de si la burbuja flotante
              está oculta (ver ChatWithAdminWidget). */}
          <SupportChatHeaderButton role={role} />
          <div className="relative shrink-0">
            <button
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-white text-[#0F6E56]"
              aria-label={t('Cuenta')}
              aria-expanded={accountMenuOpen}
            >
              {initials}
            </button>
            {accountMenuOpen && (
              <>
                {/* Overlay para cerrar el dropdown al hacer clic afuera */}
                <div className="fixed inset-0 z-40" onClick={() => setAccountMenuOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-9 w-56 bg-white rounded-lg border border-[#DDE1EE] shadow-lg z-50 py-1">
                  {accountItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setAccountMenuOpen(false)}
                      className={`flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg text-sm ${
                        activeHref === item.href ? 'text-[#141820] font-medium bg-[#F5F6FA]' : 'text-[#475569] hover:bg-[#F5F6FA] hover:text-[#141820]'
                      }`}
                      title={item.description}
                    >
                      <span className="flex-shrink-0">{item.icon}</span>
                      <span>{t(item.label)}</span>
                    </Link>
                  ))}
                  <div className="my-1 border-t border-[#DDE1EE]" />
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 mx-1 text-sm text-[#475569] hover:bg-[#FCEBEB] hover:text-[#A32D2D] rounded-lg transition-colors"
                    style={{ width: 'calc(100% - 0.5rem)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                    </svg>
                    {t('Cerrar sesión')}
                  </button>
                </div>
              </>
            )}
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
              className="w-8 h-8 flex items-center justify-center text-[#475569] hover:text-[#141820]"
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

          {/* Cuenta: Perfil/Ayuda + Cerrar sesión, separados del resto para no competir con las tareas diarias */}
          <div className="px-2 py-2 border-t border-[#DDE1EE] flex-shrink-0">
            {accountItems.map((item) => renderLink(item))}
            <button
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 mx-2 text-sm text-[#475569] hover:bg-[#FCEBEB] hover:text-[#A32D2D] rounded-lg transition-colors"
              style={{ width: 'calc(100% - 1rem)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
              {t('Cerrar sesión')}
            </button>
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

      {/* Chat directo con soporte — burbuja flotante + panel (solo para
          paciente/profesional; el admin usa la bandeja de /admin/support-chat) */}
      <ChatWithAdminWidget />
    </div>
  )
}