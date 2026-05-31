'use client'
// src/app/patient/dashboard/page.tsx
// Dashboard principal del paciente — conectado a la API

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/lib/store'
import { consultationsAPI } from '@/lib/api'
import type { Consultation } from '@/types'

// ── Iconos ────────────────────────────────────────────
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconBot = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconClock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconHome = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>

const NAV = [
  { label: 'Inicio', href: '/patient/dashboard', icon: <IconHome /> },
  { label: 'Buscar médico', href: '/patient/search', icon: <IconSearch /> },
  { label: 'Agente IA', href: '/patient/agent', icon: <IconBot /> },
  { label: 'Sala de espera', href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas', href: '/patient/history', icon: <IconFile /> },
]

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMPLETED: 'badge-green',
    IN_PROGRESS: 'badge-blue',
    WAITING_PAYMENT: 'badge-amber',
    PAYMENT_CONFIRMED: 'badge-blue',
    WAITING_PROFESSIONAL: 'badge-blue',
    CANCELLED: 'badge-gray',
    REFUNDED: 'badge-gray',
    AGENT_TRIAGING: 'badge-blue',
  }
  const labels: Record<string, string> = {
    COMPLETED: 'Completada',
    IN_PROGRESS: 'En curso',
    WAITING_PAYMENT: 'Esperando pago',
    PAYMENT_CONFIRMED: 'Pago confirmado',
    WAITING_PROFESSIONAL: 'Buscando profesional',
    CANCELLED: 'Cancelada',
    REFUNDED: 'Reembolsada',
    AGENT_TRIAGING: 'Con agente IA',
  }
  return <span className={map[status] || 'badge-gray'}>{labels[status] || status}</span>
}

export default function PatientDashboard() {
  const { user } = useAuthStore()
  const router = useRouter()

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'patient'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    enabled: !!user,
  })

  const recent = consultations.slice(0, 3)
  const activeConsultation = consultations.find(
    (c) => ['WAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'WAITING_PROFESSIONAL', 'IN_PROGRESS'].includes(c.status)
  )

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/dashboard" role="PATIENT">
      <div className="max-w-3xl">

        {/* Saludo */}
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-[#141820]">
            Buenos días 👋
          </h1>
          <p className="text-sm text-[#6B738A] mt-0.5">¿Cómo te sientes hoy?</p>
        </div>

        {/* Alerta si hay consulta activa */}
        {activeConsultation && (
          <div className="bg-[#E6F1FB] border border-[#85B7EB] rounded-xl p-4 mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#0C447C]">Tienes una consulta en curso</p>
              <p className="text-xs text-[#185FA5] mt-0.5">
                {activeConsultation.status === 'WAITING_PAYMENT' && 'Pendiente de pago QR'}
                {activeConsultation.status === 'WAITING_PROFESSIONAL' && 'Buscando profesional disponible...'}
                {activeConsultation.status === 'IN_PROGRESS' && 'Tu consulta está en progreso'}
              </p>
            </div>
            <Link href="/patient/waiting-room" className="btn-primary text-xs py-1.5 px-3">
              Continuar →
            </Link>
          </div>
        )}

        {/* Acciones rápidas */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <Link href="/patient/agent" className="block">
            <div className="bg-[#185FA5] rounded-xl p-4 cursor-pointer hover:bg-[#0C447C] transition-colors">
              <p className="text-white/70 text-xs mb-1">No sé qué especialista necesito</p>
              <p className="text-white font-semibold text-sm mb-3">Consultar con el Agente IA</p>
              <div className="bg-white/15 rounded-full px-3 py-1.5 w-fit">
                <p className="text-white text-xs">Hablar con Medi →</p>
              </div>
            </div>
          </Link>

          <Link href="/patient/search" className="block">
            <div className="bg-[#0F6E56] rounded-xl p-4 cursor-pointer hover:bg-[#085041] transition-colors">
              <p className="text-white/70 text-xs mb-1">Ya sé qué necesito</p>
              <p className="text-white font-semibold text-sm mb-3">Buscar profesional directo</p>
              <div className="bg-white/15 rounded-full px-3 py-1.5 w-fit">
                <p className="text-white text-xs">Ver disponibles →</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{consultations.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Consultas totales</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#1D9E75]">
              {consultations.filter((c) => c.status === 'COMPLETED').length}
            </p>
            <p className="text-xs text-[#6B738A] mt-0.5">Completadas</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">
              {consultations.filter((c) => c.status === 'WAITING_PAYMENT').length}
            </p>
            <p className="text-xs text-[#6B738A] mt-0.5">Pendientes</p>
          </div>
        </div>

        {/* Consultas recientes */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Consultas recientes</h2>
            <Link href="/patient/history" className="text-xs text-[#185FA5] hover:underline">
              Ver todas →
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 bg-[#F5F6FA] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-[#6B738A]">Aún no tienes consultas</p>
              <Link href="/patient/agent" className="btn-primary inline-block mt-3 text-xs">
                Hacer mi primera consulta
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[#DDE1EE]">
              {recent.map((c) => (
                <div key={c.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {c.specialty || 'Consulta médica'}
                    </p>
                    <p className="text-xs text-[#6B738A] mt-0.5">
                      {new Date(c.created_at).toLocaleDateString('es-BO', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                      {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
