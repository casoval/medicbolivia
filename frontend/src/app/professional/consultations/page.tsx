'use client'
// src/app/professional/consultations/page.tsx
// Lista de consultas del profesional

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { StatusBadge, LoadingScreen, EmptyState, SectionTitle } from '@/components/ui'
import { consultationsAPI, getErrorMessage } from '@/lib/api'
import { useState } from 'react'

const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
const IconCal   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
const IconFile  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconStar  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
const IconUser  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>

const NAV = [
  { label: 'Resumen',        href: '/professional/dashboard',     icon: <IconGrid /> },
  { label: 'Consultas',      href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Horarios',       href: '/professional/schedule',      icon: <IconCal /> },
  { label: 'Recetario',      href: '/professional/prescriptions', icon: <IconFile /> },
  { label: 'Calificaciones', href: '/professional/ratings',       icon: <IconStar /> },
  { label: 'Mi perfil',      href: '/professional/profile',       icon: <IconUser /> },
]

export default function ConsultationsPage() {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending')

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    refetchInterval: 10000,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      consultationsAPI.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  const pending = consultations.filter((c) =>
    ['PAYMENT_CONFIRMED', 'WAITING_PROFESSIONAL'].includes(c.status)
  )
  const active = consultations.filter((c) => c.status === 'IN_PROGRESS')
  const history = consultations.filter((c) =>
    ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(c.status)
  )

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/consultations" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Consultas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Gestiona tus consultas activas e historial</p>
        </div>

        {error && (
          <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2.5 rounded-lg mb-4 border border-[#F09595]">
            {error}
          </div>
        )}

        {/* Stats rápidas */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#E24B4A]">{pending.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">En espera</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{active.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">En curso</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">{history.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Completadas</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'pending'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            Pendientes {pending.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#E24B4A] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            Historial
          </button>
        </div>

        {isLoading ? (
          <LoadingScreen text="Cargando consultas..." />
        ) : activeTab === 'pending' ? (
          <div className="card">
            {/* Activas */}
            {active.length > 0 && (
              <>
                <SectionTitle>En curso ahora</SectionTitle>
                <div className="divide-y divide-[#DDE1EE] mb-4">
                  {active.map((c) => (
                    <div key={c.id} className="py-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
                        P
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{c.specialty || 'Consulta general'}</p>
                        <p className="text-xs text-[#6B738A]">
                          Iniciada {new Date(c.started_at || c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                          {' · '}Bs. {parseFloat(c.professional_earning).toFixed(2)}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                      <button
                        onClick={() => updateMutation.mutate({ id: c.id, status: 'COMPLETED' })}
                        className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] text-xs px-3 py-1.5 rounded-lg"
                      >
                        Finalizar
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Pendientes de atender */}
            <SectionTitle>Esperando atención</SectionTitle>
            {pending.length === 0 ? (
              <EmptyState
                title="No hay pacientes en espera"
                description="Cuando un paciente confirme su pago aparecerá aquí"
              />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {pending.map((c) => (
                  <div key={c.id} className="py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      P
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{c.specialty || 'Consulta general'}</p>
                      <p className="text-xs text-[#6B738A]">
                        {new Date(c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                      </p>
                      <div className="flex gap-2 mt-1">
                        <span className="badge-green text-[10px]">Pago confirmado</span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => updateMutation.mutate({ id: c.id, status: 'IN_PROGRESS' })}
                        disabled={updateMutation.isPending}
                        className="bg-[#185FA5] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#0C447C] transition-colors"
                      >
                        Atender
                      </button>
                      <button className="btn-secondary text-xs py-1.5 px-3">
                        Derivar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Historial */
          <div className="card">
            <SectionTitle>Historial de consultas</SectionTitle>
            {history.length === 0 ? (
              <EmptyState
                title="No hay consultas completadas aún"
                description="Aparecerán aquí una vez que finalices tus primeras consultas"
              />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {history.map((c) => (
                  <div key={c.id} className="py-3 flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{c.specialty || 'Consulta'}</p>
                      <p className="text-xs text-[#6B738A]">
                        {new Date(c.created_at).toLocaleDateString('es-BO', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                        {c.duration_minutes && ` · ${c.duration_minutes} min`}
                        {' · '}Bs. {parseFloat(c.professional_earning).toFixed(2)}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
