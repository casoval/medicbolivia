'use client'
// src/app/admin/dashboard/page.tsx
// Panel de administración — estadísticas, profesionales pendientes, pagos y logs

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Alert, StatusBadge, LoadingScreen, SectionTitle } from '@/components/ui'
import { api, getErrorMessage } from '@/lib/api'

// Nav icons
const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
const IconCard  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
const IconBot   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconLog   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
const IconCog   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>

const NAV = [
  { label: 'Resumen',        href: '/admin/dashboard',      icon: <IconGrid /> },
  { label: 'Profesionales',  href: '/admin/professionals',  icon: <IconUsers /> },
  { label: 'Pacientes',     href: '/admin/patients',       icon: <IconUsers /> },
  { label: 'Pagos',          href: '/admin/payments',       icon: <IconCard /> },
  { label: 'Agente IA',      href: '/admin/agent',          icon: <IconBot /> },
  { label: 'Auditoría',      href: '/admin/logs',           icon: <IconLog /> },
  { label: 'Configuración',  href: '/admin/settings',       icon: <IconCog /> },
]

// ── API helpers ───────────────────────────────────────
const adminAPI = {
  stats:         () => api.get('/admin/stats'),
  professionals: (status?: string) => api.get('/admin/professionals', { params: { status } }),
  payments:      () => api.get('/admin/payments', { params: { limit: 20 } }),
  logs:          () => api.get('/admin/logs',     { params: { limit: 50 } }),
  agentStats:    () => api.get('/admin/agent-stats'),
  verifyPro:     (id: string, status: string, note?: string) =>
    api.patch(`/professionals/${id}/verify`, null, { params: { new_status: status, review_note: note } }),
  refund:        (id: string, type: string, reason: string) =>
    api.post(`/admin/payments/${id}/refund`, { refund_type: type, reason }),
}

// ── Subcomponente: tab button ─────────────────────────
function Tab({ label, active, onClick, badge }: { label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
        active ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A] hover:text-[#141820]'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="w-4 h-4 bg-[#E24B4A] text-white text-[10px] rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  )
}

export default function AdminDashboard() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'professionals' | 'patients' | 'payments' | 'agent' | 'logs'>('overview')
  const [profTab, setProfTab]     = useState<'APPROVED' | 'PENDING_DOCS' | 'SUSPENDED'>('APPROVED')
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminAPI.stats().then((r) => r.data),
    refetchInterval: 30_000,
  })

  const { data: patients = [], isLoading: loadingPatients } = useQuery({
    queryKey: ['admin', 'patients'],
    queryFn: () => api.get('/admin/patients').then((r) => r.data),
    enabled: activeTab === 'patients',
  })

  const { data: professionals = [], isLoading: loadingPros } = useQuery({
    queryKey: ['admin', 'professionals', profTab],
    queryFn: () => adminAPI.professionals(profTab).then((r) => r.data),
    enabled: activeTab === 'professionals',
  })

  const { data: payments = [], isLoading: loadingPayments } = useQuery({
    queryKey: ['admin', 'payments'],
    queryFn: () => adminAPI.payments().then((r) => r.data),
    enabled: activeTab === 'payments',
  })

  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['admin', 'logs'],
    queryFn: () => adminAPI.logs().then((r) => r.data),
    enabled: activeTab === 'logs',
  })

  const { data: agentStats } = useQuery({
    queryKey: ['admin', 'agent-stats'],
    queryFn: () => adminAPI.agentStats().then((r) => r.data),
    enabled: activeTab === 'agent',
  })

  const verifyMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      adminAPI.verifyPro(id, status),
    onSuccess: (_, { status }) => {
      setSuccess(`Profesional ${status === 'APPROVED' ? 'aprobado' : 'rechazado'} correctamente`)
      qc.invalidateQueries({ queryKey: ['admin', 'professionals'] })
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  // Log dot color
  const logDotColor: Record<string, string> = {
    PAYMENT:     '#1D9E75',
    REFUND:      '#E24B4A',
    DOC:         '#185FA5',
    AGENT:       '#7F77DD',
    APPROVED:    '#1D9E75',
    REJECTED:    '#E24B4A',
  }
  function getDotColor(action: string) {
    for (const [key, color] of Object.entries(logDotColor)) {
      if (action.includes(key)) return color
    }
    return '#A0A8BF'
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/dashboard" role="ADMIN">
      <div className="max-w-4xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold">Panel de administración</h1>
            <p className="text-xs text-[#6B738A] mt-0.5">Gestión completa de MedicBolivia</p>
          </div>
          <div className="flex items-center gap-1.5 bg-[#E1F5EE] border border-[#9FE1CB] rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] animate-pulse-dot" />
            <span className="text-xs text-[#0F6E56] font-medium">Sistema operativo</span>
          </div>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 flex-wrap">
          <Tab label="Resumen"        active={activeTab === 'overview'}       onClick={() => setActiveTab('overview')} />
          <Tab label="Profesionales"  active={activeTab === 'professionals'}  onClick={() => setActiveTab('professionals')}
            badge={stats?.professionals_pending} />
          <Tab label="Pacientes"   active={activeTab === 'patients'}       onClick={() => setActiveTab('patients')} />
          <Tab label="Pagos"          active={activeTab === 'payments'}       onClick={() => setActiveTab('payments')} />
          <Tab label="Agente IA"      active={activeTab === 'agent'}          onClick={() => setActiveTab('agent')} />
          <Tab label="Auditoría"      active={activeTab === 'logs'}           onClick={() => setActiveTab('logs')} />
        </div>

        {/* ── OVERVIEW ─────────────────────────────────── */}
        {activeTab === 'overview' && (
          <>
            {loadingStats ? (
              <LoadingScreen text="Cargando estadísticas..." />
            ) : stats ? (
              <>
                {/* Stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                  {[
                    { label: 'Profesionales activos',value: stats.professionals_active, color: '#185FA5' },
                    { label: 'Consultas este mes',   value: stats.monthly_consultations, color: '#0F6E56' },
                    { label: 'Ingresos plataforma',  value: `Bs. ${Math.round(stats.platform_fee_month).toLocaleString()}`, color: '#854F0B' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="card py-3 text-center">
                      <p className="text-xl font-bold" style={{ color }}>{value}</p>
                      <p className="text-xs text-[#6B738A] mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* En tiempo real */}
                <div className="card mb-4">
                  <SectionTitle>En este momento</SectionTitle>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#E1F5EE] rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-[#0F6E56]">{stats.active_now}</p>
                      <p className="text-xs text-[#0F6E56] mt-0.5">En videollamada</p>
                    </div>
                    <div className="bg-[#FAEEDA] rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-[#854F0B]">{stats.waiting_professional}</p>
                      <p className="text-xs text-[#854F0B] mt-0.5">Buscando profesional</p>
                    </div>
                    <div className="bg-[#E6F1FB] rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-[#185FA5]">{stats.waiting_payment}</p>
                      <p className="text-xs text-[#185FA5] mt-0.5">Esperando pago QR</p>
                    </div>
                  </div>
                </div>

                {/* Alertas */}
                {stats.professionals_pending > 0 && (
                  <div className="card bg-[#FAEEDA] border-[#FAC775]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#EF9F27]" />
                        <p className="text-sm font-medium text-[#854F0B]">
                          {stats.professionals_pending} profesional{stats.professionals_pending > 1 ? 'es' : ''} pendiente{stats.professionals_pending > 1 ? 's' : ''} de verificación
                        </p>
                      </div>
                      <button
                        onClick={() => { setActiveTab('professionals'); setProfTab('PENDING_DOCS') }}
                        className="text-xs text-[#854F0B] font-medium hover:underline"
                      >
                        Revisar →
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}

        {/* ── PROFESSIONALS ────────────────────────────── */}
        {activeTab === 'professionals' && (
          <>
            <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-lg mb-3 w-fit">
              {(['APPROVED', 'PENDING_DOCS', 'SUSPENDED'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setProfTab(s)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    profTab === s ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
                  }`}
                >
                  {s === 'APPROVED' ? 'Activos' : s === 'PENDING_DOCS' ? 'Pendientes' : 'Suspendidos'}
                </button>
              ))}
            </div>

            {/* Stats profesionales */}
          {!loadingPros && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#0F6E56]">{professionals.length}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">
                  {profTab === 'APPROVED' ? 'Activos' : profTab === 'PENDING_DOCS' ? 'Pendientes' : 'Suspendidos'}
                </p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#185FA5]">{stats?.professionals_active || 0}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">Aprobados total</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#854F0B]">{stats?.professionals_pending || 0}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">Pendientes verificación</p>
              </div>
            </div>
          )}

          {loadingPros ? <LoadingScreen /> : (
              <div className="card">
                {professionals.length === 0 ? (
                  <p className="text-sm text-[#6B738A] text-center py-6">No hay profesionales en este estado</p>
                ) : (
                  <div className="divide-y divide-[#DDE1EE]">
                    {professionals.map((pro: any) => (
                      <div key={pro.id} className="py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {pro.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{pro.name}</p>
                          <p className="text-xs text-[#6B738A]">
                            {pro.specialty}
                            {pro.total_consultations > 0 && ` · ${pro.total_consultations} consultas`}
                            {pro.rating > 0 && ` · ★ ${Number(pro.rating).toFixed(1)}`}
                          </p>
                        </div>
                        <StatusBadge status={pro.status} />
                        <div className="flex gap-1.5 flex-shrink-0">
                          {profTab === 'PENDING_DOCS' && (
                            <>
                              <button
                                onClick={() => verifyMutation.mutate({ id: pro.id, status: 'APPROVED' })}
                                disabled={verifyMutation.isPending}
                                className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] text-xs px-2.5 py-1 rounded-lg hover:bg-[#9FE1CB] transition-colors"
                              >
                                Aprobar
                              </button>
                              <button
                                onClick={() => verifyMutation.mutate({ id: pro.id, status: 'REJECTED' })}
                                disabled={verifyMutation.isPending}
                                className="bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] text-xs px-2.5 py-1 rounded-lg hover:bg-[#F7C1C1] transition-colors"
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                          {profTab === 'APPROVED' && (
                            <button
                              onClick={() => verifyMutation.mutate({ id: pro.id, status: 'SUSPENDED' })}
                              disabled={verifyMutation.isPending}
                              className="text-xs text-[#A32D2D] hover:underline"
                            >
                              Suspender
                            </button>
                          )}
                          {profTab === 'SUSPENDED' && (
                            <button
                              onClick={() => verifyMutation.mutate({ id: pro.id, status: 'APPROVED' })}
                              disabled={verifyMutation.isPending}
                              className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] text-xs px-2.5 py-1 rounded-lg"
                            >
                              Reactivar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── PATIENTS ─────────────────────────────────── */}
        {activeTab === 'patients' && (
          <>
            {/* Stats pacientes */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#141820]">{patients.length}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">Total registrados</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#0F6E56]">
                  {patients.filter((p:any) => p.status !== 'SUSPENDED').length}
                </p>
                <p className="text-xs text-[#6B738A] mt-0.5">Activos</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#A32D2D]">
                  {patients.filter((p:any) => p.status === 'SUSPENDED').length}
                </p>
                <p className="text-xs text-[#6B738A] mt-0.5">Suspendidos</p>
              </div>
            </div>

            {loadingPatients ? <LoadingScreen /> : (
              <div className="card">
                <SectionTitle>Pacientes recientes</SectionTitle>
                {patients.length === 0 ? (
                  <p className="text-sm text-[#6B738A] text-center py-6">No hay pacientes registrados</p>
                ) : (
                  <div className="divide-y divide-[#DDE1EE]">
                    {patients.slice(0, 10).map((p: any) => {
                      const age = p.birth_date
                        ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (365.25*24*60*60*1000))
                        : null
                      return (
                        <div key={p.id} className="py-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {p.first_name[0]}{p.last_name[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{p.first_name} {p.last_name}</p>
                            <p className="text-xs text-[#6B738A]">
                              CI: {p.ci}{age ? ` · ${age} años` : ''} · {p.department}
                            </p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            {p.allergies?.length > 0 && <span className="badge-red text-[10px]">Alergia</span>}
                            {p.chronic_conditions?.length > 0 && <span className="badge-amber text-[10px]">Crónico</span>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-medium text-[#185FA5]">{p.total_consultations} consultas</p>
                            <span className={p.status === 'SUSPENDED' ? 'badge-red text-[10px]' : 'badge-green text-[10px]'}>
                              {p.status === 'SUSPENDED' ? 'Suspendido' : 'Activo'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {patients.length > 10 && (
                  <div className="mt-3 pt-3 border-t border-[#DDE1EE] text-center">
                    <a href="/admin/patients" className="text-xs text-[#185FA5] hover:underline">
                      Ver todos los pacientes →
                    </a>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── PAYMENTS ──────────────────────────────────── */}
        {activeTab === 'payments' && (
          <>
            {loadingPayments ? <LoadingScreen /> : (
              <div className="card">
                <SectionTitle>Últimas transacciones QR</SectionTitle>
                <div className="divide-y divide-[#DDE1EE]">
                  {payments.map((p: any) => (
                    <div key={p.id} className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">
                          {p.bank_name || 'Banco'} · {p.bank_tx_id || 'Sin confirmar'}
                        </p>
                        <p className="text-xs text-[#6B738A] mt-0.5">
                          {new Date(p.created_at).toLocaleString('es-BO')}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold">Bs. {Number(p.amount).toFixed(2)}</p>
                        <p className="text-xs text-[#0F6E56]">→ {Number(p.professional_net).toFixed(2)}</p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                  ))}
                  {payments.length === 0 && (
                    <p className="text-sm text-[#6B738A] text-center py-6">No hay transacciones</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── AGENT ─────────────────────────────────────── */}
        {activeTab === 'agent' && (
          <div className="grid grid-cols-2 gap-4">
            {agentStats ? (
              <>
                {[
                  { label: 'Sesiones este mes',   value: agentStats.total_sessions,    color: '#185FA5' },
                  { label: 'Latencia promedio',    value: `${agentStats.avg_latency_ms}ms`, color: '#0F6E56' },
                  { label: 'Tokens usados',        value: agentStats.total_tokens_month.toLocaleString(), color: '#854F0B' },
                  { label: 'Guardrails activados', value: agentStats.guardrail_triggers, color: '#A32D2D' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="card text-center py-4">
                    <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                    <p className="text-xs text-[#6B738A] mt-1">{label}</p>
                  </div>
                ))}
              </>
            ) : <LoadingScreen />}

            <div className="card col-span-2">
              <SectionTitle>Configuración del agente</SectionTitle>
              <div className="space-y-3">
                {[
                  { label: 'Guardrail anti-diagnóstico', desc: 'Bloquea respuestas con diagnósticos médicos', locked: true, on: true },
                  { label: 'Agente activo 24/7',         desc: 'El agente atiende pacientes todo el tiempo', locked: false, on: true },
                  { label: 'Derivación automática',      desc: 'Deriva si el profesional no responde en 60s', locked: false, on: true },
                ].map(({ label, desc, locked, on }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-[#DDE1EE] last:border-0">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-[#6B738A]">{desc}</p>
                    </div>
                    {locked ? (
                      <div className="flex items-center gap-1.5">
                        <span className="badge-red text-[10px]">No deshabilitar</span>
                        <div className="w-9 h-5 bg-[#185FA5] rounded-full opacity-50 cursor-not-allowed" />
                      </div>
                    ) : (
                      <div className={`w-9 h-5 rounded-full cursor-pointer ${on ? 'bg-[#185FA5]' : 'bg-[#DDE1EE]'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── LOGS ──────────────────────────────────────── */}
        {activeTab === 'logs' && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Registro de auditoría</SectionTitle>
              <button className="btn-secondary text-xs py-1.5 px-3">Exportar CSV</button>
            </div>
            {loadingLogs ? <LoadingScreen /> : (
              <div className="divide-y divide-[#DDE1EE]">
                {logs.map((l: any) => (
                  <div key={l.id} className="py-2.5 flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ background: getDotColor(l.action) }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{l.action}</p>
                      <p className="text-xs text-[#6B738A] mt-0.5">
                        {l.entity_type && `${l.entity_type} · `}
                        {new Date(l.created_at).toLocaleString('es-BO')}
                        {l.ip_address && ` · ${l.ip_address}`}
                      </p>
                    </div>
                  </div>
                ))}
                {logs.length === 0 && (
                  <p className="text-sm text-[#6B738A] text-center py-6">No hay registros</p>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
