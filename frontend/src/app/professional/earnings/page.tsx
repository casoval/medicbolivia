'use client'
// src/app/professional/earnings/page.tsx
// Panel del profesional: historial detallado de cada pago RECIBIDO por
// consulta, con estadísticas generales, para que el profesional sepa en
// todo momento cuánto ya cobró, cuánto está retenido en garantía y cuánto
// se llevó la plataforma de comisión.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, SectionTitle } from '@/components/ui'
import { professionalsAPI, getErrorMessage } from '@/lib/api'
import type { ProfessionalEarningItem } from '@/lib/api'

function fmtFechaHora(iso?: string | null): string {
  if (!iso) return '—'
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/La_Paz',
  })
}
function fmtFecha(iso?: string | null): string {
  if (!iso) return '—'
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz',
  })
}

const CONSULTATION_TYPE_LABELS: Record<string, string> = {
  IMMEDIATE:  'Consulta inmediata',
  SCHEDULED:  'Cita agendada',
  FOLLOW_UP:  'Consulta de seguimiento',
}

const DISPUTE_CATEGORY_LABELS: Record<string, string> = {
  NO_SHOW: 'El profesional no llegó',
  MALA_CALIDAD: 'Mala calidad de atención',
  TECNICO: 'Problema técnico',
  OTRO: 'Otro motivo',
}

// Explica en una frase, para el profesional, qué significa el estado
// actual de ESTE pago — para que nunca tenga dudas de si el dinero ya es
// suyo, sigue retenido, o fue devuelto al paciente.
function earningExplanation(p: ProfessionalEarningItem): string {
  switch (p.status) {
    case 'CONFIRMED':
      return 'El paciente ya pagó. El monto está retenido temporalmente por la plataforma como garantía y se liberará a tu favor una vez termine el período de espera post-consulta.'
    case 'RELEASED_TO_PROFESSIONAL':
      return 'Este pago ya fue liberado a tu favor — el dinero es tuyo.'
    case 'REFUNDED_FULL':
      return 'Este pago fue devuelto en su totalidad al paciente. No corresponde ningún monto para ti en esta consulta.'
    case 'REFUNDED_PARTIAL':
      return 'Se devolvió una parte al paciente; el resto, una vez liberado, te corresponde a ti.'
    case 'DISPUTED':
      return 'El paciente reportó un problema con esta consulta. El pago está congelado mientras un administrador revisa el caso — todavía no se te ha liberado ni devuelto al paciente.'
    default:
      return ''
  }
}

// Estados donde NO hay (o ya dejó de haber) dinero real a favor del
// profesional en esta consulta: nunca se cobró, se canceló, se devolvió al
// paciente, o está congelado por una disputa sin resolver. En estos casos
// el monto se muestra en gris para que se distinga a simple vista de un
// pago realmente recibido.
const NO_MONEY_FOR_PROFESSIONAL = new Set([
  'PENDING', 'CANCELLED_NO_CHARGE', 'REFUNDED_FULL', 'REFUNDED_PARTIAL', 'DISPUTED',
])
function earningAmountColorClass(status: string): string {
  if (status === 'RELEASED_TO_PROFESSIONAL') return 'text-[#0F6E56]' // ya es suyo
  if (NO_MONEY_FOR_PROFESSIONAL.has(status)) return 'text-[#A0A8BF]' // gris: cancelado / sin cobro / devuelto / congelado
  return 'text-[#141820]' // CONFIRMED: en garantía, es dinero real pero todavía no liberado
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '',                          label: 'Todos' },
  { key: 'RELEASED_TO_PROFESSIONAL',  label: 'Recibidos' },
  { key: 'CONFIRMED',                 label: 'En garantía' },
  { key: 'DISPUTED',                  label: 'En disputa' },
  { key: 'REFUNDED_FULL',             label: 'Reembolsados' },
]

function PatientAvatar({ firstName, lastName }: { firstName?: string | null; lastName?: string | null }) {
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?'
  return (
    <div className="w-10 h-10 rounded-full bg-[#0F6E56]/10 text-[#0F6E56] text-sm font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  )
}

export default function ProfessionalEarningsPage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['professional', 'earnings', statusFilter],
    queryFn: () => professionalsAPI.getMyEarnings({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) }),
    refetchInterval: 20000,
  })

  const stats = data?.stats
  const items = data?.items || []

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/earnings" role="PROFESSIONAL">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Mis pagos</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Todo lo que cobraste, consulta por consulta: cuánto recibiste, cuánto está en garantía y cuánto se
            llevó la plataforma.
          </p>
        </div>

        {error && (
          <div className="mb-4">
            <p className="text-sm px-3 py-2.5 rounded-lg border bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]">
              No se pudo cargar tu historial de pagos: {getErrorMessage(error)}
            </p>
          </div>
        )}

        {isLoading ? <LoadingScreen text="Cargando tus pagos..." /> : (
          <>
            {/* ── Estadísticas ─────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#0F6E56]">Bs. {stats?.total_recibido.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">Total recibido</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#185FA5]">{stats?.consultas_cobradas ?? 0}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">Consultas cobradas</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#854F0B]">Bs. {stats?.total_retenido.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">En garantía (retenido)</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#6B738A]">Bs. {stats?.total_comision_plataforma.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">Comisión de la plataforma</p>
              </div>
            </div>

            {(stats?.total_en_disputa ?? 0) > 0 && (
              <div className="mb-4">
                <p className="text-sm px-3 py-2.5 rounded-lg border bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]">
                  Tienes Bs. {stats?.total_en_disputa.toFixed(2)} congelado(s) en disputa mientras un administrador
                  revisa el o los reclamos de paciente(s).
                </p>
              </div>
            )}

            {(stats?.total_retenido ?? 0) > 0 && (
              <div className="mb-4">
                <p className="text-sm px-3 py-2.5 rounded-lg border bg-[#E6F1FB] text-[#185FA5] border-[#85B7EB]">
                  Bs. {stats?.total_retenido.toFixed(2)} está retenido en garantía. Se libera a tu favor
                  automáticamente al finalizar el período de espera posterior a cada consulta, siempre que no se
                  haya reportado ningún problema.
                </p>
              </div>
            )}

            {/* ── Filtros por estado ───────────────────────── */}
            <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit flex-wrap">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    statusFilter === tab.key ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <SectionTitle>Detalle de pagos recibidos</SectionTitle>
                {isFetching && <span className="text-[10px] text-[#A0A8BF]">Actualizando...</span>}
              </div>

              {items.length === 0 ? (
                <EmptyState
                  title="Todavía no tienes pagos registrados"
                  description="Cuando un paciente pague una consulta contigo, aparecerá aquí con todo el detalle."
                />
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {items.map((p) => {
                    const isOpen = expandedId === p.id
                    const patientName = p.patient_first_name
                      ? `${p.patient_first_name} ${p.patient_last_name || ''}`.trim()
                      : 'Paciente'
                    return (
                      <div key={p.id} className="py-3">
                        <button
                          onClick={() => setExpandedId(isOpen ? null : p.id)}
                          className="w-full flex items-start gap-3 text-left"
                        >
                          <PatientAvatar firstName={p.patient_first_name} lastName={p.patient_last_name} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{patientName}</p>
                              <p className={`text-sm font-bold flex-shrink-0 ${earningAmountColorClass(p.status)}`}>
                                Bs. {p.professional_net.toFixed(2)}
                              </p>
                            </div>
                            <p className="text-xs text-[#6B738A] mt-0.5">
                              {p.specialty || 'Especialidad no especificada'} ·{' '}
                              {CONSULTATION_TYPE_LABELS[p.consultation_type || ''] || 'Consulta'} · cobro total Bs.{' '}
                              {p.amount.toFixed(2)}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <StatusBadge status={p.status} />
                              <span className="text-[11px] text-[#A0A8BF]">
                                {fmtFechaHora(p.paid_at || p.created_at)}
                              </span>
                            </div>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="mt-3 ml-[52px] bg-[#F5F6FA] rounded-lg p-3 space-y-3">
                            <p className="text-xs text-[#3C4257]">{earningExplanation(p)}</p>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <p className="text-[#A0A8BF]">Monto cobrado al paciente</p>
                                <p className="text-[#3C4257] font-medium">Bs. {p.amount.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">Comisión de la plataforma</p>
                                <p className="text-[#3C4257]">Bs. {p.platform_fee.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">Tu neto</p>
                                <p className={`font-medium ${earningAmountColorClass(p.status)}`}>Bs. {p.professional_net.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">Fecha de pago del paciente</p>
                                <p className="text-[#3C4257]">{fmtFechaHora(p.paid_at || p.created_at)}</p>
                              </div>
                              {p.released_at && (
                                <div>
                                  <p className="text-[#A0A8BF]">Fecha en que se te liberó</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.released_at)}</p>
                                </div>
                              )}
                              {p.scheduled_at && (
                                <div>
                                  <p className="text-[#A0A8BF]">Fecha de la cita</p>
                                  <p className="text-[#3C4257]">{fmtFecha(p.scheduled_at)}</p>
                                </div>
                              )}
                            </div>

                            {p.refunded_at && (
                              <div className="pt-2 border-t border-[#DDE1EE] grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <p className="text-[#A0A8BF]">Fecha de reembolso al paciente</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.refunded_at)}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">Monto devuelto al paciente</p>
                                  <p className="text-[#3C4257]">
                                    Bs. {p.refunded_amount != null ? p.refunded_amount.toFixed(2) : p.amount.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                            )}

                            {p.disputed_at && (
                              <div className="pt-2 border-t border-[#DDE1EE] grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <p className="text-[#A0A8BF]">Fecha del reclamo</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.disputed_at)}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">Categoría</p>
                                  <p className="text-[#3C4257]">
                                    {DISPUTE_CATEGORY_LABELS[p.dispute_category || ''] || p.dispute_category || '—'}
                                  </p>
                                </div>
                                {p.resolution_note && (
                                  <div className="col-span-2">
                                    <p className="text-[#A0A8BF]">Resolución del administrador</p>
                                    <p className="text-[#3C4257]">{p.resolution_note}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}