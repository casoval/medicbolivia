'use client'
// src/app/patient/dashboard/page.tsx

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/lib/store'
import { consultationsAPI, getErrorMessage } from '@/lib/api'

const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconBot    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconClock  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconHome   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>

const NAV = [
  { label: 'Inicio',        href: '/patient/dashboard',    icon: <IconHome /> },
  { label: 'Buscar médico', href: '/patient/search',       icon: <IconSearch /> },
  { label: 'Agente IA',     href: '/patient/agent',        icon: <IconBot /> },
  { label: 'Sala de espera',href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas', href: '/patient/history',      icon: <IconFile /> },
]

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    COMPLETED:            { cls: 'badge-green', label: 'Completada' },
    IN_PROGRESS:          { cls: 'badge-blue',  label: 'En curso' },
    WAITING_PAYMENT:      { cls: 'badge-amber', label: 'Esperando pago' },
    PAYMENT_CONFIRMED:    { cls: 'badge-blue',  label: 'Pago confirmado' },
    WAITING_PROFESSIONAL: { cls: 'badge-blue',  label: 'Buscando profesional' },
    CANCELLED:            { cls: 'badge-gray',  label: 'Cancelada' },
    REFUNDED:             { cls: 'badge-gray',  label: 'Reembolsada' },
    AGENT_TRIAGING:       { cls: 'badge-blue',  label: 'Con agente IA' },
  }
  const { cls, label } = map[status] || { cls: 'badge-gray', label: status }
  return <span className={cls}>{label}</span>
}

export default function PatientDashboard() {
  const { user } = useAuthStore()
  const router = useRouter()
  const qc = useQueryClient()
  const [cancelError, setCancelError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'patient'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    enabled: !!user,
    refetchInterval: 10000,
    staleTime: 0,
    refetchOnMount: true,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations', 'patient'] })
      setConfirmCancel(false)
      setCancelError('')
    },
    onError: (err) => setCancelError(getErrorMessage(err)),
  })

  const recent = consultations.slice(0, 3)
  const activeConsultation = consultations.find((c) =>
    ['WAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'WAITING_PROFESSIONAL', 'IN_PROGRESS'].includes(c.status)
  )

  const activeLabel: Record<string, string> = {
    WAITING_PAYMENT:      'Pendiente de pago QR',
    PAYMENT_CONFIRMED:    'Pago confirmado, buscando profesional...',
    WAITING_PROFESSIONAL: 'Buscando profesional disponible...',
    IN_PROGRESS:          'Tu consulta está en progreso',
  }

  // Solo se puede cancelar antes del pago confirmado
  const canCancel = activeConsultation &&
    ['WAITING_PAYMENT', 'WAITING_PROFESSIONAL'].includes(activeConsultation.status)

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/dashboard" role="PATIENT">
      <div className="max-w-3xl">

        <div className="mb-5">
          <h1 className="text-lg font-semibold text-[#141820]">Buenos días 👋</h1>
          <p className="text-sm text-[#6B738A] mt-0.5">¿Cómo te sientes hoy?</p>
        </div>

        {/* Banner consulta activa */}
        {activeConsultation && (
          <div className="bg-[#E6F1FB] border border-[#85B7EB] rounded-xl p-4 mb-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#0C447C]">Tienes una consulta en curso</p>
                <p className="text-xs text-[#185FA5] mt-0.5">
                  {activeLabel[activeConsultation.status] || ''}
                  {activeConsultation.specialty ? ` · ${activeConsultation.specialty}` : ''}
                </p>
              </div>
              <Link
                href={`/patient/waiting-room?consultationId=${activeConsultation.id}`}
                className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap flex-shrink-0"
              >
                Continuar →
              </Link>
            </div>

            {/* Cancelar */}
            {canCancel && (
              <div className="mt-3 pt-3 border-t border-[#85B7EB]">
                {cancelError && (
                  <p className="text-xs text-[#A32D2D] mb-2">{cancelError}</p>
                )}
                {!confirmCancel ? (
                  <button
                    onClick={() => setConfirmCancel(true)}
                    className="text-xs text-[#A32D2D] hover:underline"
                  >
                    Cancelar esta consulta
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-[#A32D2D] font-medium">¿Seguro que quieres cancelar?</p>
                    <button
                      onClick={() => cancelMutation.mutate(activeConsultation.id)}
                      disabled={cancelMutation.isPending}
                      className="text-xs bg-[#A32D2D] text-white px-3 py-1 rounded-lg hover:bg-[#7a1f1f] disabled:opacity-60"
                    >
                      {cancelMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
                    </button>
                    <button
                      onClick={() => { setConfirmCancel(false); setCancelError('') }}
                      className="text-xs text-[#6B738A] hover:underline"
                    >
                      No, volver
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Acciones rápidas — solo si no hay consulta activa */}
        {!activeConsultation && (
          <div className="grid grid-cols-2 gap-4 mb-5">
            <Link href="/patient/agent" className="block">
              <div className="bg-[#185FA5] rounded-xl p-4 hover:bg-[#0C447C] transition-colors">
                <p className="text-white/70 text-xs mb-1">No sé qué especialista necesito</p>
                <p className="text-white font-semibold text-sm mb-3">Consultar con el Agente IA</p>
                <div className="bg-white/15 rounded-full px-3 py-1.5 w-fit">
                  <p className="text-white text-xs">Hablar con Medi →</p>
                </div>
              </div>
            </Link>
            <Link href="/patient/search" className="block">
              <div className="bg-[#0F6E56] rounded-xl p-4 hover:bg-[#085041] transition-colors">
                <p className="text-white/70 text-xs mb-1">Ya sé qué necesito</p>
                <p className="text-white font-semibold text-sm mb-3">Buscar profesional directo</p>
                <div className="bg-white/15 rounded-full px-3 py-1.5 w-fit">
                  <p className="text-white text-xs">Ver disponibles →</p>
                </div>
              </div>
            </Link>
          </div>
        )}

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