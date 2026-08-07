'use client'
// src/app/admin/refunds/page.tsx
// Panel admin: reembolsos a PACIENTES — Fase 1 semi-automática, espejo de
// /admin/payouts (que resuelve lo mismo para profesionales). El banco
// (Banco Ganadero) solo expone servicios de COBRO, no de reversa, así
// que la plata sigue en la cuenta de la plataforma hasta transferirla
// A MANO. El flujo acá es:
//   1. Un admin (o una cancelación automática) aprueba un reembolso →
//      aparece en "Esperando datos del paciente" hasta que el paciente
//      indica a dónde transferirle.
//   2. Cuando el paciente carga sus datos, pasa a "Listos para pagar".
//   3. El admin transfiere A MANO (banca en línea, QR persona-a-persona,
//      billetera móvil) y confirma acá — recién ahí se avisa al paciente.
// A diferencia de los payouts a profesionales, acá no hay lotes/CSV: cada
// reembolso tiene su propio destino y el volumen es esporádico, así que
// se resuelve uno por uno. Ver app/services/refund_payout.py en el backend.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, EmptyState, Alert, SectionTitle } from '@/components/ui'
import { adminAPI, getErrorMessage } from '@/lib/api'
import type { RefundPendingItem } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

function fmtFecha(iso?: string | null): string {
  if (!iso) return '—'
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz',
  })
}

export default function AdminRefundsPage() {
  const { t } = useLanguage()
  const [success, setSuccess] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmingPayment, setConfirmingPayment] = useState<RefundPendingItem | null>(null)
  const [referenceNote, setReferenceNote] = useState('')

  const { data: pending, isLoading, refetch } = useQuery({
    queryKey: ['admin-refunds-pending'],
    queryFn: adminAPI.getPendingRefunds,
    refetchInterval: 30_000,
  })

  const confirmMutation = useMutation({
    mutationFn: ({ paymentId, note }: { paymentId: string; note: string }) =>
      adminAPI.confirmRefundPayout(paymentId, note || undefined),
    onSuccess: () => {
      setSuccess(t('Reembolso confirmado. Se avisó al paciente.'))
      setErrorMsg('')
      setConfirmingPayment(null)
      setReferenceNote('')
      refetch()
    },
    onError: (err) => setErrorMsg(getErrorMessage(err)),
  })

  const readyToPay = pending?.ready_to_pay ?? []
  const awaitingAccount = pending?.awaiting_account ?? []

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/refunds" role="ADMIN">
      <div className="max-w-5xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Reembolsos a pacientes')}</h1>
          <p className="text-xs text-[#475569] mt-0.5">
            {t('Fase 1 (semi-automática): igual que con los profesionales, el banco no expone transferencias salientes. Cuando un paciente indica a dónde transferirle, aparece acá; transfieres a mano y confirmas para avisarle.')}
          </p>
        </div>

        {success && <div className="mb-3"><Alert type="success" message={success} /></div>}
        {errorMsg && <div className="mb-3"><Alert type="error" message={errorMsg} /></div>}

        <div className="card mb-4">
          <SectionTitle>{t('Pendientes de transferir')}</SectionTitle>

          {isLoading ? (
            <LoadingScreen text="Cargando pendientes..." />
          ) : readyToPay.length === 0 && awaitingAccount.length === 0 ? (
            <EmptyState
              title={t('Nada pendiente')}
              description={t('No hay reembolsos aprobados sin transferir en este momento.')}
            />
          ) : (
            <>
              {readyToPay.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[#0F6E56] mb-2">
                    {t('Listos para pagar')} · Bs. {pending?.ready_to_pay_total.toFixed(2)}
                  </p>
                  <div className="space-y-1.5">
                    {readyToPay.map((r) => (
                      <div key={r.payment_id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[#F5F6FA]">
                        <div>
                          <p className="font-medium text-[#141820]">{r.patient_name}</p>
                          <p className="text-[#64748B]">
                            {r.destination} · {t('aprobado el')} {fmtFecha(r.refunded_at)}
                          </p>
                          {r.refund_note && <p className="text-[#94A0B8] italic mt-0.5">{r.refund_note}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[#0F6E56] whitespace-nowrap">Bs. {r.amount.toFixed(2)}</p>
                          <button
                            onClick={() => { setConfirmingPayment(r); setReferenceNote('') }}
                            className="btn-primary text-xs py-1 px-2 whitespace-nowrap"
                          >
                            {t('Confirmar pago')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {awaitingAccount.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#B45309] mb-2">
                    {t('Esperando datos del paciente')} · Bs. {pending?.awaiting_account_total.toFixed(2)}
                  </p>
                  <p className="text-xs text-[#64748B] mb-2">
                    {t('Ya se le avisó al paciente que indique a dónde transferirle. En cuanto lo haga, pasa a "Listos para pagar".')}
                  </p>
                  <div className="space-y-1.5">
                    {awaitingAccount.map((r) => (
                      <div key={r.payment_id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[#FAEEDA]">
                        <div>
                          <p className="font-medium text-[#141820]">{r.patient_name}</p>
                          <p className="text-[#854F0B]">
                            {t('aprobado el')} {fmtFecha(r.refunded_at)}
                          </p>
                          {r.refund_note && <p className="text-[#854F0B]/70 italic mt-0.5">{r.refund_note}</p>}
                        </div>
                        <p className="font-semibold text-[#854F0B] whitespace-nowrap">Bs. {r.amount.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Confirmar transferencia */}
        {confirmingPayment && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirmingPayment(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold mb-1">{t('Confirmar que ya transferiste este reembolso')}</p>
              <p className="text-xs text-[#64748B] mb-3">
                {confirmingPayment.patient_name} · Bs. {confirmingPayment.amount.toFixed(2)} · {confirmingPayment.destination}
              </p>
              <p className="text-xs text-[#64748B] mb-3">
                {t('Esto marca el reembolso como transferido y avisa al paciente por WhatsApp/in-app. No se puede deshacer.')}
              </p>
              <label className="block text-xs font-medium text-[#475569] mb-1">{t('Referencia / nota (opcional)')}</label>
              <textarea
                className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none mb-3"
                rows={2}
                placeholder={t('Ej: N° de operación del banco')}
                value={referenceNote}
                onChange={(e) => setReferenceNote(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmingPayment(null)} className="btn-secondary text-xs py-1.5 px-3">
                  {t('Cancelar')}
                </button>
                <button
                  onClick={() => confirmMutation.mutate({ paymentId: confirmingPayment.payment_id, note: referenceNote })}
                  disabled={confirmMutation.isPending}
                  className="btn-primary text-xs py-1.5 px-3"
                >
                  {confirmMutation.isPending ? t('Confirmando...') : t('Confirmar pago')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
