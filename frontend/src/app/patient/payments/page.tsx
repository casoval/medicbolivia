'use client'
// src/app/patient/payments/page.tsx
// Panel del paciente: historial detallado de cada pago realizado, con
// estadísticas generales, para que el paciente sepa en todo momento cuánto
// pagó, cuándo, por qué consulta y en qué estado está cada pago.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, SectionTitle } from '@/components/ui'
import { ConsultationTypeBadge, ModalityBadge } from '@/components/shared/ConsultationBadges'
import { patientsAPI, getErrorMessage } from '@/lib/api'
import type { PatientPaymentItem } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// ── Formateo de fechas (mismo criterio que el resto del panel: el backend
// manda UTC sin 'Z', hay que agregarla antes de parsear) ────────────────
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

// Explica en una frase, para el paciente, qué significa el estado actual
// de SU pago — más allá del badge corto, esto es lo que evita dudas.
function paymentExplanation(p: PatientPaymentItem): string {
  const isDirecto = p.payment_channel === 'CASH'
  if (isDirecto) {
    switch (p.status) {
      case 'PENDING':
        return 'Esta cita te la agendó directamente tu profesional. El cobro es directo entre ustedes — todavía no ha registrado que lo cobró.'
      case 'CONFIRMED':
        return 'Esta cita te la agendó directamente tu profesional y ya registró el cobro. Es un pago directo, fuera de la plataforma — no queda retenido ni pasa por garantía.'
      default:
        return ''
    }
  }
  switch (p.status) {
    case 'PENDING':
      return 'Generaste el código QR pero el pago todavía no fue confirmado por el banco.'
    case 'CONFIRMED':
      return 'Tu pago fue confirmado. El dinero está retenido temporalmente por la plataforma hasta que la consulta termine, como garantía para ambas partes.'
    case 'RELEASED_TO_PROFESSIONAL':
      return 'Tu pago fue confirmado y, al completarse la consulta, el monto correspondiente ya fue entregado al profesional.'
    case 'REFUNDED_FULL':
      return 'Se te devolvió el 100% de lo que pagaste.'
    case 'REFUNDED_PARTIAL':
      return 'Se te devolvió una parte de lo que pagaste; el resto fue entregado al profesional.'
    case 'DISPUTED':
      return 'Reportaste un problema con esta consulta. El pago está congelado mientras un administrador revisa el caso.'
    case 'CANCELLED_NO_CHARGE':
      return 'Esta consulta se canceló antes de que llegaras a pagar — no se te cobró nada.'
    default:
      return ''
  }
}

// Estados donde el monto NO representa dinero realmente pagado y retenido:
// nunca llegó a cobrarse, todavía no se confirma, o ya se devolvió. En esos
// casos el monto se muestra en gris para distinguirlo a simple vista de un
// pago real y vigente.
const NO_MONEY_COMMITTED = new Set([
  'PENDING', 'CANCELLED_NO_CHARGE', 'REFUNDED_FULL', 'REFUNDED_PARTIAL', 'DISPUTED',
])
function paymentAmountColorClass(status: string): string {
  if (NO_MONEY_COMMITTED.has(status)) return 'text-[#A0A8BF]' // gris: pendiente / cancelado / devuelto / congelado
  return 'text-[#141820]' // CONFIRMED o RELEASED_TO_PROFESSIONAL: sí pagaste y quedó pagado
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '',                       label: 'Todos' },
  { key: 'CONFIRMED',              label: 'Confirmados' },
  { key: 'RELEASED_TO_PROFESSIONAL', label: 'Completados' },
  { key: 'PENDING',                label: 'Pendientes' },
  { key: 'REFUNDED_FULL',          label: 'Reembolsados' },
  { key: 'DISPUTED',               label: 'En disputa' },
]

function DoctorAvatar({ firstName, lastName, photoUrl }: {
  firstName?: string | null; lastName?: string | null; photoUrl?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?'
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={`${firstName || ''} ${lastName || ''}`.trim() || 'Profesional'}
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-[#F5F6FA]"
      />
    )
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#185FA5]/10 text-[#185FA5] text-sm font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  )
}

export default function PatientPaymentsPage() {
  const { t } = useLanguage()
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['patient', 'payments', statusFilter],
    queryFn: () => patientsAPI.getMyPayments({ limit: 100, ...(statusFilter ? { status: statusFilter } : {}) }),
    refetchInterval: 20000,
  })

  const stats = data?.stats
  const items = data?.items || []

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/payments" role="PATIENT">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Mis pagos')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            {t('Todo lo que pagaste, consulta por consulta: cuánto, cuándo y en qué estado está cada pago.')}
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
                <p className="text-xl font-bold text-[#0F6E56]">Bs. {stats?.total_pagado.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('Total pagado')}</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#185FA5]">{stats?.consultas_pagadas ?? 0}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('Consultas pagadas')}</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#854F0B]">Bs. {stats?.total_pendiente.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('QR pendiente')}</p>
              </div>
              <div className="card py-3 text-center">
                <p className="text-xl font-bold text-[#6B738A]">Bs. {stats?.total_reembolsado.toFixed(2) ?? '0.00'}</p>
                <p className="text-xs text-[#6B738A] mt-0.5">{t('Reembolsado')}</p>
              </div>
            </div>

            {/* Desglose por canal — separa lo que pasó por la plataforma (QR) de
                lo que le pagaste directo a un profesional que te agendó por su
                cuenta (membresía). Son cosas distintas: lo directo no tiene
                garantía ni reembolso desde la plataforma. */}
            {((stats?.total_pagado_directo ?? 0) > 0 || (stats?.total_pendiente_cobro_directo ?? 0) > 0) && (
              <div className="mb-5 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-[#EEF3FB] text-[#185FA5] border border-[#C3D6EF]">
                  Vía plataforma: Bs. {stats?.total_pagado_plataforma.toFixed(2) ?? '0.00'}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-[#EEEDFE] text-[#534AB7] border border-[#D7D4F7]">
                  Cobro directo con el profesional: Bs. {stats?.total_pagado_directo.toFixed(2) ?? '0.00'}
                </span>
                {(stats?.total_pendiente_cobro_directo ?? 0) > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-[#FFF4E5] text-[#B25E09] border border-[#F5D9A8]">
                    Directo pendiente de que el profesional lo registre: Bs. {stats?.total_pendiente_cobro_directo.toFixed(2)}
                  </span>
                )}
              </div>
            )}

            {(stats?.total_en_disputa ?? 0) > 0 && (
              <div className="mb-4">
                <p className="text-sm px-3 py-2.5 rounded-lg border bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]">
                  Tienes Bs. {stats?.total_en_disputa.toFixed(2)} congelado(s) en disputa mientras un administrador
                  revisa tu(s) reclamo(s).
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
                <SectionTitle>{t('Detalle de pagos')}</SectionTitle>
                {isFetching && <span className="text-[10px] text-[#A0A8BF]">{t('Actualizando...')}</span>}
              </div>

              {items.length === 0 ? (
                <EmptyState
                  title="Todavía no tienes pagos registrados"
                  description="Cuando pagues una consulta, aparecerá aquí con todo el detalle."
                />
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {items.map((p) => {
                    const isOpen = expandedId === p.id
                    const doctorName = p.professional_first_name
                      ? `Dr. ${p.professional_first_name} ${p.professional_last_name || ''}`.trim()
                      : 'Profesional no asignado'
                    return (
                      <div key={p.id} className="py-3">
                        <button
                          onClick={() => setExpandedId(isOpen ? null : p.id)}
                          className="w-full flex items-start gap-3 text-left"
                        >
                          <DoctorAvatar
                            firstName={p.professional_first_name}
                            lastName={p.professional_last_name}
                            photoUrl={p.professional_photo_url}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium truncate">{doctorName}</p>
                              <p className={`text-sm font-bold flex-shrink-0 ${paymentAmountColorClass(p.status)}`}>Bs. {p.amount.toFixed(2)}</p>
                            </div>
                            <p className="text-xs text-[#6B738A] mt-0.5">
                              {p.specialty || 'Especialidad no especificada'} ·{' '}
                              {CONSULTATION_TYPE_LABELS[p.consultation_type || ''] || 'Consulta'}
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
                            <p className="text-xs text-[#3C4257]">{paymentExplanation(p)}</p>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <p className="text-[#A0A8BF]">{t('Monto pagado')}</p>
                                <p className={`font-medium ${paymentAmountColorClass(p.status)}`}>Bs. {p.amount.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">{t('Comisión de la plataforma')}</p>
                                <p className="text-[#3C4257]">Bs. {p.platform_fee.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">{t('Monto para el profesional')}</p>
                                <p className="text-[#3C4257]">Bs. {p.professional_net.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[#A0A8BF]">{t('Fecha de creación del QR')}</p>
                                <p className="text-[#3C4257]">{fmtFechaHora(p.created_at)}</p>
                              </div>
                              {p.paid_at && (
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Fecha de pago confirmado')}</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.paid_at)}</p>
                                </div>
                              )}
                              {p.bank_name && (
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Banco')}</p>
                                  <p className="text-[#3C4257]">{p.bank_name}</p>
                                </div>
                              )}
                              {p.bank_tx_id && (
                                <div>
                                  <p className="text-[#A0A8BF]">{t('N° de transacción')}</p>
                                  <p className="text-[#3C4257]">{p.bank_tx_id}</p>
                                </div>
                              )}
                              {p.released_at && (
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Fecha de liberación al profesional')}</p>
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
                                  <p className="text-[#A0A8BF]">{t('Fecha de reembolso')}</p>
                                  <p className="text-[#3C4257]">{fmtFechaHora(p.refunded_at)}</p>
                                </div>
                                <div>
                                  <p className="text-[#A0A8BF]">{t('Monto reembolsado')}</p>
                                  <p className="text-[#0F6E56] font-medium">
                                    Bs. {p.refunded_amount != null ? p.refunded_amount.toFixed(2) : p.amount.toFixed(2)}
                                  </p>
                                </div>
                                {p.refund_note && (
                                  <div className="col-span-2">
                                    <p className="text-[#A0A8BF]">{t('Motivo del reembolso')}</p>
                                    <p className="text-[#3C4257]">{p.refund_note}</p>
                                  </div>
                                )}
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
                                {p.dispute_reason && (
                                  <div className="col-span-2">
                                    <p className="text-[#A0A8BF]">{t('Tu motivo')}</p>
                                    <p className="text-[#3C4257]">{p.dispute_reason}</p>
                                  </div>
                                )}
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