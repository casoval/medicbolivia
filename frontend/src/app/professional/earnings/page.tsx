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
import { ConsultationTypeBadge, ModalityBadge } from '@/components/shared/ConsultationBadges'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { professionalsAPI, getErrorMessage } from '@/lib/api'
import type { ProfessionalEarningItem } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

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
  if (p.payment_channel === 'CASH') {
    switch (p.status) {
      case 'PENDING':
        return 'Agendaste esta cita tú mismo y elegiste "pagar después" — todavía no registras que cobraste. Hazlo desde el detalle de la cita en tu calendario.'
      case 'CONFIRMED':
        return 'Cobro directo con tu paciente (cita que tú agendaste). Ya registraste el cobro — este dinero es tuyo, nunca pasó por la plataforma, así que no hay comisión ni garantía.'
      default:
        return ''
    }
  }
  switch (p.status) {
    case 'PENDING':
      return 'El paciente generó el código QR pero todavía no se confirma el pago desde el banco — no hay nada cobrado aún.'
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
function earningAmountColorClass(status: string, channel?: string | null): string {
  if (status === 'RELEASED_TO_PROFESSIONAL') return 'text-[#0F6E56]' // ya es suyo
  // Cobro directo (CASH) confirmado nunca queda en garantía — es dinero ya
  // recibido igual que uno liberado por la plataforma.
  if (channel === 'CASH' && status === 'CONFIRMED') return 'text-[#0F6E56]'
  if (NO_MONEY_FOR_PROFESSIONAL.has(status)) return 'text-[#A0A8BF]' // gris: cancelado / sin cobro / devuelto / congelado
  return 'text-[#141820]' // CONFIRMED: en garantía, es dinero real pero todavía no liberado
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '',                          label: 'Todos' },
  { key: 'CONFIRMED',                 label: 'En garantía' },
  { key: 'RELEASED_TO_PROFESSIONAL',  label: 'Recibidos' },
  { key: 'PENDING',                   label: 'Pendientes' },
  { key: 'REFUNDED_FULL',             label: 'Reembolsados' },
  { key: 'DISPUTED',                  label: 'En disputa' },
]


export default function ProfessionalEarningsPage() {
  const { t } = useLanguage()
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
          <h1 className="text-base font-semibold">{t('Mis pagos')}</h1>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#0F6E56]">Bs. {stats?.total_recibido.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('Total recibido')}</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#185FA5]">{stats?.consultas_cobradas ?? 0}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('Consultas cobradas')}</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#854F0B]">Bs. {stats?.total_retenido.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('En garantía (retenido)')}</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#6B738A]">Bs. {stats?.total_comision_plataforma.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('Comisión de la plataforma')}</p>
              </div>
            </div>

            {/* Desglose por canal — lo cobrado vía plataforma (QR, con
                comisión y garantía) es distinto de lo cobrado directo en
                efectivo con tus pacientes (citas que tú mismo agendaste por
                membresía): ese dinero nunca pasa por la plataforma, no
                genera comisión ni queda retenido en garantía. */}
            {((stats?.total_recibido_directo ?? 0) > 0 || (stats?.total_pendiente_cobro_directo ?? 0) > 0) && (
              <div className="mb-5 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-[#EEF3FB] text-[#185FA5] border border-[#C3D6EF]">
                  Vía plataforma: Bs. {stats?.total_recibido_plataforma.toFixed(2) ?? '0.00'}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-[#EEEDFE] text-[#534AB7] border border-[#D7D4F7]">
                  Cobros directos ya cobrados: Bs. {stats?.total_recibido_directo.toFixed(2) ?? '0.00'}
                </span>
                {(stats?.total_pendiente_cobro_directo ?? 0) > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-[#FFF4E5] text-[#B25E09] border border-[#F5D9A8]">
                    Directo, pendiente de que registres el cobro: Bs. {stats?.total_pendiente_cobro_directo.toFixed(2)}
                  </span>
                )}
              </div>
            )}

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
                <SectionTitle>{t('Detalle de pagos recibidos')}</SectionTitle>
                {isFetching && <span className="text-[10px] text-[#A0A8BF]">{t('Actualizando...')}</span>}
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
                          <PatientAvatar
                            firstName={p.patient_first_name}
                            lastName={p.patient_last_name}
                            photoUrl={p.patient_photo_url}
                            size="w-10 h-10"
                            colorClasses="bg-[#0F6E56]/10 text-[#0F6E56]"
                            textSize="text-sm"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{patientName}</p>
                              <p className={`text-sm font-bold flex-shrink-0 ${earningAmountColorClass(p.status, p.payment_channel)}`}>
                                Bs. {p.professional_net.toFixed(2)}
                              </p>
                            </div>
                            <p className="text-xs text-[#6B738A] mt-0.5">
                              {p.specialty || 'Especialidad no especificada'} ·{' '}
                              {CONSULTATION_TYPE_LABELS[p.consultation_type || ''] || 'Consulta'} · cobro total Bs.{' '}
                              {p.amount.toFixed(2)}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <StatusBadge status={p.status} channel={p.payment_channel ?? undefined} />
                              <ConsultationTypeBadge consultation={{
                                consultation_type: (p.consultation_type as any) || 'IMMEDIATE',
                                created_by_role: p.created_by_role ?? undefined,
                                modality: p.modality ?? undefined,
                              }} />
                              <ModalityBadge consultation={{
                                consultation_type: (p.consultation_type as any) || 'IMMEDIATE',
                                created_by_role: p.created_by_role ?? undefined,
                                modality: p.modality ?? undefined,
                              }} />
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
                                <p className="text-[#A0A8BF]">{t('Monto cobrado al paciente')}</p>
                                <p className="text-[#3C4257] font-medium">Bs. {p.amount.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">{t('Comisión de la plataforma')}</p>
                                <p className="text-[#3C4257]">Bs. {p.platform_fee.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">{t('Tu neto')}</p>
                                <p className={`font-medium ${earningAmountColorClass(p.status, p.payment_channel)}`}>Bs. {p.professional_net.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">{t('Fecha de pago del paciente')}</p>
                                <p className="text-[#3C4257]">{fmtFechaHora(p.paid_at || p.created_at)}</p>
                              </div>
                              {p.released_at && (
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Fecha en que se te liberó')}</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.released_at)}</p>
                                </div>
                              )}
                              {p.scheduled_at && (
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Fecha de la cita')}</p>
                                  <p className="text-[#3C4257]">{fmtFecha(p.scheduled_at)}</p>
                                </div>
                              )}
                            </div>

                            {p.refunded_at && (
                              <div className="pt-2 border-t border-[#DDE1EE] grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Fecha de reembolso al paciente')}</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.refunded_at)}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Monto devuelto al paciente')}</p>
                                  <p className="text-[#3C4257]">
                                    Bs. {p.refunded_amount != null ? p.refunded_amount.toFixed(2) : p.amount.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                            )}

                            {p.disputed_at && (
                              <div className="pt-2 border-t border-[#DDE1EE] grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Fecha del reclamo')}</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.disputed_at)}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Categoría')}</p>
                                  <p className="text-[#3C4257]">
                                    {DISPUTE_CATEGORY_LABELS[p.dispute_category || ''] || p.dispute_category || '—'}
                                  </p>
                                </div>
                                {p.resolution_note && (
                                  <div className="col-span-2">
                                    <p className="text-[#A0A8BF]">{t('Resolución del administrador')}</p>
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