'use client'
// src/app/admin/payments/page.tsx - FIXED
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, Alert, SectionTitle } from '@/components/ui'
import { api, adminAPI, getErrorMessage } from '@/lib/api'
import type { DisputedPayment, DisputeResolution } from '@/lib/api'

const DISPUTE_CATEGORY_LABELS: Record<string, string> = {
  NO_SHOW: 'El profesional no llegó',
  MALA_CALIDAD: 'Mala calidad de atención',
  TECNICO: 'Problema técnico',
  OTRO: 'Otro motivo',
}

// Traduce el registro informativo outcome_note (guardado por el backend en
// cada punto donde una consulta termina sin completarse normalmente) a un
// texto legible que indica quién actuó y en qué fase estaba la consulta.
// No afecta ninguna lógica — es solo para que el admin entienda el caso
// sin tener que leer el código.
const OUTCOME_NOTE_LABELS: Record<string, string> = {
  CANCELLED_BY_PATIENT_BEFORE_PAYMENT: 'El paciente canceló antes de pagar',
  CANCELLED_BY_PATIENT: 'El paciente canceló',
  CANCELLED_24H_NOTICE: 'El paciente canceló con aviso de 24h o más',
  AUTO_TIMEOUT_PAYMENT: 'Cancelada automáticamente: el paciente no pagó a tiempo',
  AUTO_TIMEOUT_PROFESSIONAL: 'Cancelada automáticamente: el profesional no respondió a tiempo',
  AUTO_TIMEOUT_PROFESSIONAL_PAID: 'Cancelada automáticamente: el profesional no respondió a tiempo (ya pagada)',
  AUTO_CANCELLED_IMMEDIATE_CONFLICT: 'Cancelada automáticamente: conflicto con otra cita inmediata',
  REJECTED_BY_PROFESSIONAL: 'El profesional rechazó la consulta',
  PATIENT_NO_SHOW: 'El paciente no se presentó',
  PROFESSIONAL_NO_SHOW: 'El profesional no se presentó',
  PROFESSIONAL_CANCELLED_WITH_REFUND: 'El profesional canceló por un percance',
  PATIENT_CANCELLED_NO_VIDEO_IMMEDIATE: 'El paciente canceló por falla de video (consulta inmediata)',
  PATIENT_CANCELLED_NO_VIDEO_SCHEDULED: 'El paciente canceló por falla de video (consulta agendada)',
}
function formatOutcomeNote(note?: string | null): string {
  if (!note) return '—'
  return OUTCOME_NOTE_LABELS[note] || note
}

// Indicador del plazo de 48h (DISPUTE_RESOLUTION_SLA_HOURS) que tiene el admin
// para resolver una disputa. No hay ninguna acción automática ligada a este
// plazo (el dinero no se libera ni se devuelve solo) — es puramente un
// indicador de gestión para que el admin priorice:
//   - Antes del deadline: cuenta regresiva ("Vence en 12h 30min").
//   - Después del deadline: en vez de solo marcar "vencido", muestra el
//     tiempo transcurrido SIN resolver, y escala visualmente cuanto más
//     vieja es la disputa (0-24h pasado el plazo = 'warning', 24h+ = 'critical').
function formatSlaStatus(
  deadlineIso: string,
  now: Date
): { text: string; tier: 'ok' | 'warning' | 'critical' } {
  const deadline = new Date(deadlineIso)
  const diffMs = now.getTime() - deadline.getTime() // > 0 significa que ya pasó el plazo
  const totalMinutes = Math.round(Math.abs(diffMs) / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const span = hours > 0 ? `${hours}h${mins ? ` ${mins}min` : ''}` : `${mins}min`

  if (diffMs <= 0) {
    return { text: `Vence en ${span}`, tier: 'ok' }
  }
  const overdueHours = diffMs / 3_600_000
  return {
    text: `Sin resolver hace ${span}`,
    tier: overdueHours >= 24 ? 'critical' : 'warning',
  }
}

const SLA_TIER_STYLES: Record<string, string> = {
  ok: 'bg-[#F5F6FA] text-[#6B738A]',
  warning: 'bg-[#FFF4E5] text-[#B25E09]',
  critical: 'bg-[#FCEBEB] text-[#A32D2D] font-semibold',
}
const SLA_TIER_ICON: Record<string, string> = { ok: '⏱', warning: '⚠', critical: '🔴' }

export default function AdminPaymentsPage() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  // Reloj que se actualiza cada minuto para refrescar el conteo del SLA de disputas.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const [refundModal, setRefundModal] = useState<{ id: string; amount: string } | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [activeTab, setActiveTab] = useState<'transactions' | 'disputes'>('transactions')
  const [resolveModal, setResolveModal] = useState<DisputedPayment | null>(null)
  const [resolution, setResolution] = useState<DisputeResolution>('RELEASE')
  const [resolveAmount, setResolveAmount] = useState('')
  const [resolveNote, setResolveNote] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filtros de transacciones
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterPatient, setFilterPatient] = useState('')
  const [filterProfessional, setFilterProfessional] = useState('')
  const hasActiveFilters = !!(filterDateFrom || filterDateTo || filterPatient || filterProfessional)

  function clearFilters() {
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterPatient('')
    setFilterProfessional('')
  }

  const { data: payments = [], isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'payments', filterDateFrom, filterDateTo, filterPatient, filterProfessional],
    queryFn: () => api.get('/admin/payments', {
      params: {
        limit: 100,
        ...(filterDateFrom ? { date_from: filterDateFrom } : {}),
        ...(filterDateTo ? { date_to: filterDateTo } : {}),
        ...(filterPatient.trim() ? { patient: filterPatient.trim() } : {}),
        ...(filterProfessional.trim() ? { professional: filterProfessional.trim() } : {}),
      },
    }).then(r => r.data),
    refetchInterval: 15000,
    placeholderData: keepPreviousData,
  })

  const { data: disputedPayments = [], isLoading: isLoadingDisputes, error: disputedError } = useQuery({
    queryKey: ['admin', 'payments', 'disputed'],
    queryFn: () => adminAPI.getDisputedPayments(),
    refetchInterval: 15000,
  })

  const totalConfirmed = payments
    .filter((p: any) => ['CONFIRMED', 'RELEASED_TO_PROFESSIONAL'].includes(p.status))
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0)

  const totalPlatform = payments
    .filter((p: any) => ['CONFIRMED', 'RELEASED_TO_PROFESSIONAL'].includes(p.status))
    .reduce((sum: number, p: any) => sum + Number(p.platform_fee), 0)

  const pendingCount = payments.filter((p: any) => p.status === 'PENDING').length

  const refundMutation = useMutation({
    mutationFn: ({ id, type, reason }: { id: string; type: string; reason: string }) =>
      api.post(`/admin/payments/${id}/refund`, { refund_type: type, reason }),
    onSuccess: () => {
      setSuccess('Reembolso procesado correctamente')
      setRefundModal(null)
      setRefundReason('')
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const resolveMutation = useMutation({
    mutationFn: ({ paymentId, resolution, note, amount }: {
      paymentId: string; resolution: DisputeResolution; note: string; amount?: number
    }) => adminAPI.resolveDispute(paymentId, resolution, note, amount),
    onSuccess: () => {
      setSuccess('Disputa resuelta correctamente')
      setResolveModal(null)
      setResolveNote('')
      setResolveAmount('')
      setResolution('RELEASE')
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
      qc.invalidateQueries({ queryKey: ['admin', 'payments', 'disputed'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/payments" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Pagos y finanzas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Transacciones QR y gestion de reembolsos</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">Bs. {totalConfirmed.toFixed(2)}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Total recaudado</p>
          </div>
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">Bs. {totalPlatform.toFixed(2)}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Comision plataforma</p>
          </div>
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">{pendingCount}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Pendientes</p>
          </div>
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#A32D2D]">{disputedPayments.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">En disputa</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          <button
            onClick={() => setActiveTab('transactions')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'transactions' ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
            }`}
          >
            Transacciones
          </button>
          <button
            onClick={() => setActiveTab('disputes')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'disputes' ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
            }`}
          >
            Disputas {disputedPayments.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#A32D2D] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {disputedPayments.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'disputes' ? (
          isLoadingDisputes ? <LoadingScreen /> : (
            <div className="card">
              <SectionTitle>Pagos congelados por reclamo del paciente</SectionTitle>
              {disputedError ? (
                <div className="my-3"><Alert type="error" message={`No se pudo cargar la cola de disputas: ${getErrorMessage(disputedError)}`} /></div>
              ) : disputedPayments.length === 0 ? (
                <EmptyState title="No hay disputas pendientes" description="Cuando un paciente reporte un problema, aparecerá aquí." />
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {[...disputedPayments]
                    .sort((a, b) => {
                      if (!a.sla_deadline) return 1
                      if (!b.sla_deadline) return -1
                      return new Date(a.sla_deadline).getTime() - new Date(b.sla_deadline).getTime()
                    })
                    .map((d) => {
                    const sla = d.sla_deadline ? formatSlaStatus(d.sla_deadline, now) : null
                    return (
                      <div key={d.payment_id} className="py-3">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">
                              {DISPUTE_CATEGORY_LABELS[d.dispute_category || ''] || d.dispute_category || 'Sin categoría'}
                            </p>
                            <p className="text-xs text-[#6B738A] mt-0.5">
                              Reportado {d.disputed_at ? new Date(d.disputed_at).toLocaleString('es-BO') : '—'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold">Bs. {d.amount.toFixed(2)}</p>
                            <p className="text-xs text-[#0F6E56]">prof. {d.professional_net.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="bg-[#F5F6FA] rounded-lg p-2 mb-2">
                          <p className="text-xs">{d.dispute_reason}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${d.has_clinical_note ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-[#F5F6FA] text-[#6B738A]'}`}>
                            {d.has_clinical_note ? '✓ Con historia clínica' : '✗ Sin historia clínica'}
                          </span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${d.has_prescription ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-[#F5F6FA] text-[#6B738A]'}`}>
                            {d.has_prescription ? '✓ Con receta' : '✗ Sin receta'}
                          </span>
                          {d.consultation_duration_minutes != null && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#6B738A]">
                              {d.consultation_duration_minutes} min de consulta
                            </span>
                          )}
                          {sla && (
                            <span className={`text-[11px] px-1.5 py-0.5 rounded ${SLA_TIER_STYLES[sla.tier]}`}>
                              {SLA_TIER_ICON[sla.tier]} {sla.text}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setResolveModal(d)
                            setResolution('RELEASE')
                            setResolveAmount('')
                            setResolveNote('')
                          }}
                          className="btn-secondary text-xs py-1 px-3"
                        >
                          Resolver disputa
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        ) : isLoading ? <LoadingScreen /> : (
          <div className="card">
            <div className="flex items-center justify-between">
              <SectionTitle>Ultimas transacciones QR</SectionTitle>
              {isFetching && <span className="text-[10px] text-[#A0A8BF]">Actualizando...</span>}
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 pb-4 border-b border-[#DDE1EE]">
              <div>
                <label className="block text-[10px] font-medium text-[#6B738A] mb-1">Desde</label>
                <input
                  type="date"
                  className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-xs focus:outline-none focus:border-[#185FA5]"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#6B738A] mb-1">Hasta</label>
                <input
                  type="date"
                  className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-xs focus:outline-none focus:border-[#185FA5]"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#6B738A] mb-1">Paciente</label>
                <input
                  type="text"
                  placeholder="Nombre o apellido"
                  className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-xs focus:outline-none focus:border-[#185FA5]"
                  value={filterPatient}
                  onChange={(e) => setFilterPatient(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#6B738A] mb-1">Profesional</label>
                <input
                  type="text"
                  placeholder="Nombre o apellido"
                  className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-xs focus:outline-none focus:border-[#185FA5]"
                  value={filterProfessional}
                  onChange={(e) => setFilterProfessional(e.target.value)}
                />
              </div>
              {hasActiveFilters && (
                <div className="col-span-2 sm:col-span-4 flex items-center justify-between">
                  <p className="text-[10px] text-[#6B738A]">
                    {payments.length} transacción{payments.length !== 1 ? 'es' : ''} encontrada{payments.length !== 1 ? 's' : ''} con estos filtros
                  </p>
                  <button onClick={clearFilters} className="text-xs text-[#185FA5] hover:underline">
                    Limpiar filtros
                  </button>
                </div>
              )}
            </div>

            {payments.length === 0 ? (
              <p className="text-sm text-[#6B738A] text-center py-8">
                {hasActiveFilters ? 'No hay transacciones con estos filtros' : 'No hay transacciones aun'}
              </p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {payments.map((p: any) => {
                  const isExpanded = expandedId === p.id
                  return (
                    <div key={p.id}>
                      <div
                        className="py-3 flex items-center gap-3 cursor-pointer hover:bg-[#F5F6FA] -mx-2 px-2 rounded-lg transition-colors"
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {p.patient_name || 'Paciente desconocido'} → {p.professional_name || 'Profesional desconocido'}
                          </p>
                          <p className="text-xs text-[#6B738A] mt-0.5">
                            {new Date(p.created_at).toLocaleString('es-BO')}
                            {p.specialty && <span> · {p.specialty}</span>}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {p.status === 'CANCELLED_NO_CHARGE' ? (
                            <>
                              <p className="text-sm font-bold text-[#A0A8BF]">Bs. 0.00</p>
                              <p className="text-xs text-[#A0A8BF]">prof. 0.00</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-bold">Bs. {Number(p.amount).toFixed(2)}</p>
                              <p className="text-xs text-[#0F6E56]">prof. {Number(p.professional_net).toFixed(2)}</p>
                            </>
                          )}
                        </div>
                        <StatusBadge status={p.status} channel={p.payment_channel} />
                        {p.created_by_role === 'PROFESSIONAL' && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-[#EEEDFE] text-[#534AB7] flex-shrink-0"
                            title="Cita agendada directamente por el profesional (membresía) — cobro directo, no vía plataforma."
                          >
                            Directo
                          </span>
                        )}
                        {p.payment_channel !== 'CASH' && ['CONFIRMED', 'RELEASED_TO_PROFESSIONAL'].includes(p.status) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRefundModal({ id: p.id, amount: p.amount }) }}
                            className="text-xs text-[#A32D2D] hover:underline flex-shrink-0"
                          >
                            Reembolsar
                          </button>
                        )}
                        <svg
                          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          className={`text-[#A0A8BF] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>

                      {isExpanded && (
                        <div className="pb-4 px-2 -mt-1">
                          <div className="bg-[#F5F6FA] rounded-lg p-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                            <div>
                              <p className="text-[#A0A8BF]">ID de pago</p>
                              <p className="font-mono text-[10px] text-[#3C4257] break-all">{p.id}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">ID de consulta</p>
                              <p className="font-mono text-[10px] text-[#3C4257] break-all">{p.consultation_id || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Tipo de consulta</p>
                              <p className="text-[#3C4257]">{p.consultation_type || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Paciente</p>
                              <p className="text-[#3C4257]">{p.patient_name || '—'} {p.patient_ci && `(CI ${p.patient_ci})`}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Profesional</p>
                              <p className="text-[#3C4257]">{p.professional_name || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Especialidad</p>
                              <p className="text-[#3C4257]">{p.specialty || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Monto total</p>
                              <p className="text-[#3C4257]">Bs. {p.status === 'CANCELLED_NO_CHARGE' ? '0.00' : Number(p.amount).toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Comisión plataforma</p>
                              <p className="text-[#3C4257]">Bs. {p.status === 'CANCELLED_NO_CHARGE' ? '0.00' : Number(p.platform_fee).toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Neto profesional</p>
                              <p className="text-[#3C4257]">Bs. {p.status === 'CANCELLED_NO_CHARGE' ? '0.00' : Number(p.professional_net).toFixed(2)}</p>
                            </div>
                            {p.status === 'CANCELLED_NO_CHARGE' && (
                              <div className="col-span-2 sm:col-span-3">
                                <p className="text-[#A0A8BF] text-[10px]">
                                  Se canceló antes de generarse el cobro (precio de referencia de la consulta: Bs. {Number(p.amount).toFixed(2)}).
                                </p>
                              </div>
                            )}
                            {p.outcome_note && (
                              <div className="col-span-2 sm:col-span-3">
                                <p className="text-[#A0A8BF]">Qué pasó</p>
                                <p className="text-[#3C4257]">{formatOutcomeNote(p.outcome_note)}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[#A0A8BF]">Banco</p>
                              <p className="text-[#3C4257]">{p.bank_name || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">ID transacción bancaria</p>
                              <p className="text-[#3C4257]">{p.bank_tx_id || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Estado de la consulta</p>
                              <p className="text-[#3C4257]">{p.consultation_status || '—'}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Fecha de creación</p>
                              <p className="text-[#3C4257]">{new Date(p.created_at).toLocaleString('es-BO')}</p>
                            </div>
                            <div>
                              <p className="text-[#A0A8BF]">Fecha de pago</p>
                              <p className="text-[#3C4257]">{p.paid_at ? new Date(p.paid_at).toLocaleString('es-BO') : '—'}</p>
                            </div>
                            {p.scheduled_at && (
                              <div>
                                <p className="text-[#A0A8BF]">Horario agendado</p>
                                <p className="text-[#3C4257]">{new Date(p.scheduled_at).toLocaleString('es-BO')}</p>
                              </div>
                            )}
                            {p.refunded_at && (
                              <>
                                <div>
                                  <p className="text-[#A0A8BF]">Fecha de reembolso</p>
                                  <p className="text-[#3C4257]">{new Date(p.refunded_at).toLocaleString('es-BO')}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">Monto reembolsado</p>
                                  <p className="text-[#3C4257]">
                                    {p.refunded_amount != null ? `Bs. ${Number(p.refunded_amount).toFixed(2)}` : '— (registro anterior, ver bitácora)'}
                                  </p>
                                </div>
                                <div className="col-span-2">
                                  <p className="text-[#A0A8BF]">Motivo del reembolso</p>
                                  <p className="text-[#3C4257]">{p.refund_note || '—'}</p>
                                </div>
                              </>
                            )}
                            {p.disputed_at && (
                              <>
                                <div>
                                  <p className="text-[#A0A8BF]">Fecha de disputa</p>
                                  <p className="text-[#3C4257]">{new Date(p.disputed_at).toLocaleString('es-BO')}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">Categoría de disputa</p>
                                  <p className="text-[#3C4257]">{DISPUTE_CATEGORY_LABELS[p.dispute_category] || p.dispute_category || '—'}</p>
                                </div>
                                <div className="col-span-2 sm:col-span-3">
                                  <p className="text-[#A0A8BF]">Motivo del paciente</p>
                                  <p className="text-[#3C4257]">{p.dispute_reason || '—'}</p>
                                </div>
                                {p.resolution_note && (
                                  <div className="col-span-2 sm:col-span-3">
                                    <p className="text-[#A0A8BF]">Nota de resolución del admin</p>
                                    <p className="text-[#3C4257]">{p.resolution_note}</p>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {refundModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h3 className="text-base font-semibold mb-1">Procesar reembolso</h3>
              <p className="text-xs text-[#6B738A] mb-4">
                Monto: Bs. {Number(refundModal.amount).toFixed(2)}
              </p>
              <div className="mb-4">
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Motivo</label>
                <textarea
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none"
                  rows={3}
                  placeholder="Describe el motivo del reembolso (minimo 10 caracteres)..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setRefundModal(null); setRefundReason('') }}
                  className="flex-1 btn-secondary text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => refundMutation.mutate({ id: refundModal.id, type: 'FULL', reason: refundReason })}
                  disabled={refundReason.length < 10 || refundMutation.isPending}
                  className="flex-1 bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] py-2 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {refundMutation.isPending ? 'Procesando...' : 'Confirmar reembolso'}
                </button>
              </div>
            </div>
          </div>
        )}

        {resolveModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h3 className="text-base font-semibold mb-1">Resolver disputa</h3>
              <p className="text-xs text-[#6B738A] mb-4">
                Monto en disputa: Bs. {resolveModal.amount.toFixed(2)} · profesional recibiría Bs. {resolveModal.professional_net.toFixed(2)}
              </p>

              <div className="mb-4 space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={resolution === 'RELEASE'} onChange={() => setResolution('RELEASE')} />
                  Liberar el pago al profesional
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={resolution === 'REFUND_FULL'} onChange={() => setResolution('REFUND_FULL')} />
                  Reembolso total al paciente
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={resolution === 'REFUND_PARTIAL'} onChange={() => setResolution('REFUND_PARTIAL')} />
                  Reembolso parcial al paciente
                </label>
              </div>

              {resolution === 'REFUND_PARTIAL' && (
                <div className="mb-4">
                  <label className="block text-xs font-medium text-[#6B738A] mb-1">Monto a reembolsar (Bs.)</label>
                  <input
                    type="number"
                    min="0.01"
                    max={resolveModal.amount}
                    step="0.01"
                    className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                    value={resolveAmount}
                    onChange={(e) => setResolveAmount(e.target.value)}
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Nota de resolución (mínimo 10 caracteres)</label>
                <textarea
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none"
                  rows={3}
                  placeholder="Explica brevemente el motivo de la decisión..."
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setResolveModal(null)}
                  className="flex-1 btn-secondary text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => resolveMutation.mutate({
                    paymentId: resolveModal.payment_id,
                    resolution,
                    note: resolveNote,
                    amount: resolution === 'REFUND_PARTIAL' ? parseFloat(resolveAmount) : undefined,
                  })}
                  disabled={
                    resolveNote.trim().length < 10 ||
                    (resolution === 'REFUND_PARTIAL' && (!resolveAmount || parseFloat(resolveAmount) <= 0)) ||
                    resolveMutation.isPending
                  }
                  className="flex-1 btn-primary text-xs disabled:opacity-50"
                >
                  {resolveMutation.isPending ? 'Procesando...' : 'Confirmar resolución'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}