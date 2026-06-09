'use client'
// src/app/professional/dashboard/page.tsx

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/lib/store'
import { professionalsAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import type { AvailabilityMode } from '@/types'

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

// Timer cuenta regresiva para solicitudes entrantes
function RequestTimer({ createdAt }: { createdAt: string }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(createdAt + 'Z').getTime()) / 1000)
      const left = Math.max(0, 120 - elapsed)
      setSecs(left)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [createdAt])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  const isUrgent = secs <= 30
  return (
    <span className={`text-xs font-mono font-bold ${isUrgent ? 'text-[#E24B4A]' : 'text-[#854F0B]'}`}>
      {m}:{s.toString().padStart(2, '0')}
    </span>
  )
}

export default function ProfessionalDashboard() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [availError, setAvailError] = useState('')

  const { data: myProfile } = useQuery({
    queryKey: ['professional-me'],
    queryFn: () => professionalsAPI.getMyProfile(),
    enabled: !!user,
  })

  const { data: consultations = [] } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    enabled: !!user,
    refetchInterval: 5000, // cada 5s para ver solicitudes entrantes rápido
  })

  const availMutation = useMutation({
    mutationFn: (mode: AvailabilityMode) => professionalsAPI.updateAvailability(mode),
    onSuccess: (_, mode) => {
      qc.setQueryData(['professional-me'], (old: any) => ({ ...old, availability: mode }))
    },
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.acceptConsultation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.rejectConsultation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      consultationsAPI.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
  })

  const currentAvailability = myProfile?.availability ?? null

  // Solicitudes nuevas esperando aceptación (2 min)
  const incoming = consultations.filter((c: any) => c.status === 'WAITING_PROFESSIONAL')
  // Consultas con pago confirmado listas para atender
  const readyToAttend = consultations.filter((c: any) => c.status === 'PAYMENT_CONFIRMED')
  const active = consultations.filter((c: any) => c.status === 'IN_PROGRESS')
  const completed = consultations.filter((c: any) => c.status === 'COMPLETED')

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
                className={`text-xs py-1.5 px-3 btn-primary ${currentAvailability === 'ONLINE_NOW' ? 'ring-2 ring-offset-1 ring-[#185FA5]' : 'opacity-60'}`}
              >
                {currentAvailability === 'ONLINE_NOW' ? '✓ Disponible ahora' : 'Disponible ahora'}
              </button>
              <button
                onClick={() => availMutation.mutate('OFFLINE')}
                disabled={availMutation.isPending}
                className={`text-xs py-1.5 px-3 btn-secondary ${currentAvailability === 'OFFLINE' ? 'ring-2 ring-offset-1 ring-[#A0A8BF]' : 'opacity-60'}`}
              >
                {currentAvailability === 'OFFLINE' ? '✓ No disponible' : 'No disponible'}
              </button>
            </div>
          </div>
          {availError && <p className="text-xs text-[#A32D2D] mt-2">{availError}</p>}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#E24B4A]">{incoming.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Solicitudes</p>
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
              Bs. {completed.reduce((sum: number, c: any) => sum + parseFloat(c.professional_earning), 0).toFixed(0)}
            </p>
            <p className="text-xs text-[#6B738A] mt-0.5">Ganado</p>
          </div>
        </div>

        {/* ── Solicitudes entrantes — requieren aceptar/rechazar ── */}
        {incoming.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#E24B4A', borderWidth: 2 }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#E24B4A] animate-ping" />
              <h2 className="text-sm font-semibold text-[#E24B4A]">
                {incoming.length} solicitud{incoming.length > 1 ? 'es' : ''} nueva{incoming.length > 1 ? 's' : ''}
              </h2>
            </div>
            {incoming.map((c: any) => (
              <div key={c.id} className="py-3 border-b border-[#DDE1EE] last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#FCEBEB] text-[#E24B4A] flex items-center justify-center text-xs font-bold flex-shrink-0">
                    P
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{c.specialty || 'Consulta general'}</p>
                    <p className="text-xs text-[#6B738A]">
                      Bs. {parseFloat(c.amount).toFixed(2)} · {new Date(c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-[#FAEEDA] px-2 py-1 rounded-lg">
                    <span className="text-xs text-[#854F0B]">⏱</span>
                    <RequestTimer createdAt={c.created_at} />
                  </div>
                </div>
                <div className="flex gap-2 mt-2 ml-12">
                  <button
                    onClick={() => acceptMutation.mutate(c.id)}
                    disabled={acceptMutation.isPending}
                    className="flex-1 py-2 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    ✓ Aceptar consulta
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(c.id)}
                    disabled={rejectMutation.isPending}
                    className="py-2 px-4 bg-[#F5F6FA] hover:bg-[#DDE1EE] text-[#6B738A] text-xs font-medium rounded-lg transition-colors"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Pagos confirmados — listas para atender ── */}
        {readyToAttend.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#185FA5', borderWidth: 1.5 }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#185FA5] animate-pulse" />
              <h2 className="text-sm font-semibold text-[#185FA5]">
                {readyToAttend.length} paciente{readyToAttend.length > 1 ? 's' : ''} listo{readyToAttend.length > 1 ? 's' : ''} — pago confirmado
              </h2>
            </div>
            {readyToAttend.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5 border-b border-[#DDE1EE] last:border-0">
                <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold">
                  P
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.specialty || 'Consulta general'}</p>
                  <p className="text-xs text-[#6B738A]">Bs. {parseFloat(c.amount).toFixed(2)}</p>
                </div>
                <button
                  onClick={() => updateMutation.mutate({ id: c.id, status: 'IN_PROGRESS' })}
                  disabled={updateMutation.isPending}
                  className="btn-primary text-xs py-1.5 px-3"
                >
                  Iniciar consulta
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── En curso ── */}
        {active.length > 0 && (
          <div className="card mb-4">
            <h2 className="text-sm font-semibold mb-3">En curso ahora</h2>
            {active.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5 border-b border-[#DDE1EE] last:border-0">
                <div className="w-9 h-9 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-xs font-bold">
                  P
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.specialty || 'Consulta general'}</p>
                  <p className="text-xs text-[#6B738A]">
                    Iniciada {new Date(c.started_at || c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  onClick={() => updateMutation.mutate({ id: c.id, status: 'COMPLETED' })}
                  className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] text-xs px-3 py-1.5 rounded-lg"
                >
                  Finalizar
                </button>
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
              {consultations.slice(0, 5).map((c: any) => (
                <div key={c.id} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-sm">{c.specialty || 'Consulta'}</p>
                    <p className="text-xs text-[#6B738A]">
                      {new Date(c.created_at).toLocaleDateString('es-BO')} · Bs. {parseFloat(c.professional_earning).toFixed(2)}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    c.status === 'COMPLETED'           ? 'badge-green' :
                    c.status === 'IN_PROGRESS'         ? 'badge-blue'  :
                    c.status === 'WAITING_PROFESSIONAL'? 'badge-amber' :
                    c.status === 'PAYMENT_CONFIRMED'   ? 'badge-blue'  : 'badge-gray'
                  }`}>
                    {c.status === 'COMPLETED'            ? 'Completada' :
                     c.status === 'IN_PROGRESS'          ? 'En curso' :
                     c.status === 'WAITING_PROFESSIONAL' ? 'Solicitud' :
                     c.status === 'PAYMENT_CONFIRMED'    ? 'Pago confirmado' :
                     c.status === 'CANCELLED'            ? 'Cancelada' : 'Pendiente'}
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