'use client'
// src/components/layout/DashboardLayout.tsx
// Layout principal con navegación lateral para todos los dashboards

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/lib/store'
import type { UserRole } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
}

interface DashboardLayoutProps {
  children: React.ReactNode
  navItems: NavItem[]
  activeHref: string
  role: UserRole
}

function IconGrid() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
}

export function DashboardLayout({ children, navItems, activeHref, role }: DashboardLayoutProps) {
  const router = useRouter()
  const { user, isAuthenticated, logout } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, router])

  if (!user) return null

  const roleColors: Record<UserRole, string> = {
    PATIENT: 'bg-[#E6F1FB] text-[#185FA5]',
    PROFESSIONAL: 'bg-[#E1F5EE] text-[#0F6E56]',
    ADMIN: 'bg-[#042C53] text-white',
  }

  const roleLabels: Record<UserRole, string> = {
    PATIENT: 'Paciente',
    PROFESSIONAL: 'Profesional',
    ADMIN: 'Administrador',
  }

  const initials = user.role === 'PATIENT' ? 'P' : user.role === 'PROFESSIONAL' ? 'M' : 'A'

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex flex-col">

      {/* Topbar */}
      <header className="bg-[#042C53] h-[52px] flex items-center justify-between px-5 sticky top-0 z-50">
        <div className="text-white font-bold text-base tracking-tight">
          Medic<span className="opacity-50 font-normal">Bolivia</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-white/10 text-white px-2.5 py-1 rounded-full">
            {roleLabels[role]}
          </span>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${roleColors[role]}`}>
            {initials}
          </div>
        </div>
      </header>

      {/* Contenido */}
      <div className="flex flex-1">

        {/* Sidebar */}
        <aside className="w-[210px] bg-white border-r border-[#DDE1EE] flex-shrink-0">
          <nav className="py-3">
            {navItems.map((item) => {
              const isActive = activeHref === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg text-sm
                    transition-colors duration-100
                    ${isActive
                      ? role === 'PATIENT'
                        ? 'bg-[#E6F1FB] text-[#185FA5] font-medium'
                        : role === 'PROFESSIONAL'
                        ? 'bg-[#E1F5EE] text-[#0F6E56] font-medium'
                        : 'bg-[#E6F1FB] text-[#185FA5] font-medium'
                      : 'text-[#6B738A] hover:bg-[#F5F6FA] hover:text-[#141820]'
                    }
                  `}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="w-5 h-5 bg-[#E24B4A] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Cerrar sesión */}
          <div className="absolute bottom-4 left-0 w-[210px] px-2">
            <button
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#6B738A] hover:bg-[#FCEBEB] hover:text-[#A32D2D] rounded-lg transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Contenido principal */}
        <main className="flex-1 p-5 overflow-y-auto animate-fade-up">
          {children}
        </main>
      </div>
    </div>
  )
}
