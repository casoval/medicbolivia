'use client'
// src/app/professional/dashboard/page.tsx
// Dashboard del profesional de salud

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/lib/store'
import { professionalsAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import type { Consultation, AvailabilityMode } from '@/types'

const IconGrid = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
const IconCal = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconStar = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
const IconUser = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>

const NAV = [
  { label: 'Resumen', href: '/professional/dashboard', icon: <IconGrid /> },
  { label: 'Consultas', href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Horarios', href: '/professional/schedule', icon: <IconCal /> },
  { label: 'Recetario', href: '/professional/prescriptions', icon: <IconFile /> },
  { label: 'Calificaciones', href: '/professional/ratings', icon: <IconStar /> },
  { label: 'Mi perfil', href: '/professional/profile', icon: <IconUser /> },
]

export default function ProfessionalDashboard() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [availError, setAvailError] = useState('')

  const { data: consultations = [] } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    enabled: !!user,
    refetchInterval: 10000, // Refrescar cada 10 seg para ver nuevos pacientes
  })

  const availMutation = useMutation({
    mutationFn: (mode: AvailabilityMode) => professionalsAPI.updateAvailability(mode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const pending = consultations.filter((c) =>
    ['PAYMENT_CONFIRMED', 'WAITING_PROFESSIONAL'].includes(c.status)
  )
  const active = consultations.filter((c) => c.status === 'IN_PROGRESS')
  const completed = consultations.filter((c) => c.status === 'COMPLETED')

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/dashboard" role="PROFESSIONAL">
      <div className="max-w-3xl">

        {/* Disponibilidad */}
        <div className="card mb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Tu disponibilidad ahora</p>
              <p className="text-xs text-[#6B738A] mt-0.5">El agente IA te asignará pacientes cuando estés disponible</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => availMutation.mutate('ONLINE_NOW')}
                disabled={availMutation.isPending}
                className="btn-primary text-xs py-1.5 px-3"
              >
                Disponible ahora
              </button>
              <button
                onClick={() => availMutation.mutate('OFFLINE')}
                disabled={availMutation.isPending}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                No disponible
              </button>
            </div>
          </div>
          {availError && <p className="text-xs text-[#A32D2D] mt-2">{availError}</p>}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#E24B4A]">{pending.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">En espera</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{active.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">En curso</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">{completed.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Completadas</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">
              Bs. {completed.reduce((sum, c) => sum + parseFloat(c.professional_earning), 0).toFixed(0)}
            </p>
            <p className="text-xs text-[#6B738A] mt-0.5">Ganado</p>
          </div>
        </div>

        {/* Pacientes en espera */}
        {pending.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#185FA5', borderWidth: 1.5 }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#E24B4A] animate-pulse-dot" />
              <h2 className="text-sm font-semibold text-[#185FA5]">
                {pending.length} paciente{pending.length > 1 ? 's' : ''} esperando atención
              </h2>
            </div>
            {pending.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5 border-b border-[#DDE1EE] last:border-0">
                <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold">
                  P
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.specialty || 'Consulta general'}</p>
                  <p className="text-xs text-[#6B738A]">
                    Bs. {parseFloat(c.amount).toFixed(2)} · {new Date(c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await consultationsAPI.updateStatus(c.id, 'IN_PROGRESS')
                      qc.invalidateQueries({ queryKey: ['consultations'] })
                    }}
                    className="btn-primary text-xs py-1.5 px-3"
                  >
                    Atender
                  </button>
                  <button className="btn-secondary text-xs py-1.5 px-3">Derivar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Historial reciente */}
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">Consultas recientes</h2>
          {consultations.length === 0 ? (
            <p className="text-sm text-[#6B738A] text-center py-4">Aún no tienes consultas</p>
          ) : (
            <div className="divide-y divide-[#DDE1EE]">
              {consultations.slice(0, 5).map((c) => (
                <div key={c.id} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm">{c.specialty || 'Consulta'}</p>
                    <p className="text-xs text-[#6B738A]">
                      {new Date(c.created_at).toLocaleDateString('es-BO')} · Bs. {parseFloat(c.professional_earning).toFixed(2)}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    c.status === 'COMPLETED' ? 'badge-green' :
                    c.status === 'IN_PROGRESS' ? 'badge-blue' : 'badge-amber'
                  }`}>
                    {c.status === 'COMPLETED' ? 'Completada' :
                     c.status === 'IN_PROGRESS' ? 'En curso' : 'Pendiente'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
