'use client'
// src/app/admin/payouts/page.tsx
// Panel admin: pagos a profesionales — Fase 1 semi-automática.
// Todavía no hay integración bancaria de transferencias salientes (solo
// existe la de COBRO por QR). El flujo acá es:
//   1. Ver pendientes (ganancias liberadas sin pagar, por profesional)
//   2. Generar un lote (solo incluye a quienes tienen cuenta VERIFICADA)
//   3. Descargar el CSV y transferir A MANO en la banca en línea
//   4. Confirmar el lote — recién ahí se avisa a cada profesional por WhatsApp
// Ver app/services/payout.py en el backend y el documento de diseño
// "diseno-pagos-profesionales.md" para el detalle completo.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, EmptyState, Alert, SectionTitle } from '@/components/ui'
import { BankAccountModal } from '@/components/admin/BankAccountModal'
import { adminAPI, getErrorMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const BATCH_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  EXPORTED: 'CSV descargado',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
}
const BATCH_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-[#F5F6FA] text-[#475569]',
  EXPORTED: 'bg-[#FAEEDA] text-[#854F0B]',
  CONFIRMED: 'bg-[#E1F5EE] text-[#0F6E56]',
  CANCELLED: 'bg-[#FCEBEB] text-[#A32D2D]',
}

function fmtFecha(iso?: string | null): string {
  if (!iso) return '—'
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz',
  })
}

// Modal para ver la cuenta bancaria completa de un profesional puntual
// (número sin enmascarar) y, si corresponde, marcarla como verificada.
// Ahora vive en src/components/admin/BankAccountModal.tsx (compartido
// también con la ficha de un profesional en admin/professionals) — ver
// import de BankAccountModal arriba.

export default function AdminPayoutsPage() {
  const { t } = useLanguage()
  const [success, setSuccess] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [viewingProfessional, setViewingProfessional] = useState<{ id: string; name: string } | null>(null)
  const [confirmingBatchId, setConfirmingBatchId] = useState<string | null>(null)
  const [referenceNote, setReferenceNote] = useState('')

  const { data: pending, isLoading: pendingLoading, refetch: refetchPending } = useQuery({
    queryKey: ['admin-payouts-pending'],
    queryFn: adminAPI.getPendingPayouts,
    refetchInterval: 30_000,
  })

  const { data: batches, isLoading: batchesLoading, refetch: refetchBatches } = useQuery({
    queryKey: ['admin-payout-batches'],
    queryFn: adminAPI.listPayoutBatches,
  })

  const createBatchMutation = useMutation({
    mutationFn: () => adminAPI.createPayoutBatch(),
    onSuccess: (res) => {
      const blockedNote = res.blocked_count
        ? ` ${res.blocked_count} profesional(es) quedaron afuera por falta de cuenta verificada — ya se les avisó.`
        : ''
      setSuccess(`Lote creado: Bs. ${res.total_amount.toFixed(2)} para ${res.professional_count} profesional(es).${blockedNote}`)
      setErrorMsg('')
      refetchPending()
      refetchBatches()
    },
    onError: (err) => {
      setErrorMsg(getErrorMessage(err))
      setSuccess('')
    },
  })

  const confirmMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => adminAPI.confirmPayoutBatch(id, note || undefined),
    onSuccess: () => {
      setSuccess(t('Lote confirmado. Se avisó a cada profesional por WhatsApp.'))
      setErrorMsg('')
      setConfirmingBatchId(null)
      setReferenceNote('')
      refetchBatches()
      refetchPending()
    },
    onError: (err) => setErrorMsg(getErrorMessage(err)),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => adminAPI.cancelPayoutBatch(id),
    onSuccess: () => {
      setSuccess(t('Lote cancelado. Las ganancias vuelven a estar pendientes.'))
      refetchBatches()
      refetchPending()
    },
    onError: (err) => setErrorMsg(getErrorMessage(err)),
  })

  async function handleExport(batchId: string) {
    try {
      const blob = await adminAPI.exportPayoutBatch(batchId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `medicbolivia_pagos_${batchId.slice(0, 8)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      refetchBatches()
    } catch (err) {
      setErrorMsg(getErrorMessage(err))
    }
  }

  const payable = pending?.payable ?? []
  const blocked = pending?.blocked ?? []

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/payouts" role="ADMIN">
      <div className="max-w-5xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Pagos a profesionales')}</h1>
          <p className="text-xs text-[#475569] mt-0.5">
            {t('Fase 1 (semi-automática): todavía no hay integración bancaria de transferencias salientes. Generas el lote, descargas el CSV, transfieres a mano en tu banca en línea y confirmas acá — recién ahí se avisa a cada profesional por WhatsApp.')}
          </p>
        </div>

        {success && <div className="mb-3"><Alert type="success" message={success} /></div>}
        {errorMsg && <div className="mb-3"><Alert type="error" message={errorMsg} /></div>}

        {/* Pendientes de pago */}
        <div className="card mb-4">
          <SectionTitle
            action={
              <button
                onClick={() => createBatchMutation.mutate()}
                disabled={createBatchMutation.isPending || payable.length === 0}
                className="btn-primary text-xs py-1.5 px-3"
              >
                {createBatchMutation.isPending ? t('Generando...') : t('Generar lote de pago')}
              </button>
            }
          >
            {t('Pendientes de pago')}
          </SectionTitle>

          {pendingLoading ? (
            <LoadingScreen text="Cargando pendientes..." />
          ) : payable.length === 0 && blocked.length === 0 ? (
            <EmptyState
              title={t('Nada pendiente')}
              description={t('No hay ganancias liberadas sin pagar en este momento.')}
            />
          ) : (
            <>
              {payable.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-[#0F6E56] mb-2">
                    {t('Listos para el próximo lote')} · Bs. {pending?.payable_total.toFixed(2)}
                  </p>
                  <div className="space-y-1.5">
                    {payable.map((p) => (
                      <div key={p.professional_id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[#F5F6FA]">
                        <div>
                          <p className="font-medium text-[#141820]">{p.professional_name}</p>
                          <p className="text-[#64748B]">{p.bank_name} · {p.account_number_masked} · {p.earning_count} {t('consulta(s)')}</p>
                        </div>
                        <p className="font-semibold text-[#0F6E56]">Bs. {p.total_amount.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {blocked.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[#B45309] mb-2">
                    {t('Sin cuenta bancaria verificada')} · Bs. {pending?.blocked_total.toFixed(2)}
                  </p>
                  <p className="text-xs text-[#64748B] mb-2">
                    {t('No entran en el lote automático hasta que registren y verifiques su cuenta. Ya se les avisó que el equipo coordinará el pago por otra vía.')}
                  </p>
                  <div className="space-y-1.5">
                    {blocked.map((p) => (
                      <div key={p.professional_id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[#FAEEDA]">
                        <div>
                          <p className="font-medium text-[#141820]">{p.professional_name}</p>
                          <p className="text-[#854F0B]">
                            {p.has_bank_account ? t('Cuenta registrada, falta verificarla') : t('Sin cuenta bancaria registrada')}
                            {' · '}{p.earning_count} {t('consulta(s)')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-[#854F0B]">Bs. {p.total_amount.toFixed(2)}</p>
                          {p.has_bank_account && (
                            <button
                              onClick={() => setViewingProfessional({ id: p.professional_id, name: p.professional_name })}
                              className="btn-secondary text-xs py-1 px-2"
                            >
                              {t('Revisar')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Historial de lotes */}
        <div className="card">
          <SectionTitle>{t('Lotes de pago')}</SectionTitle>
          {batchesLoading ? (
            <LoadingScreen text="Cargando lotes..." />
          ) : !batches || batches.length === 0 ? (
            <EmptyState title={t('Todavía no generaste ningún lote')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#64748B] border-b border-[#DDE1EE]">
                    <th className="py-2 pr-3">{t('Fecha')}</th>
                    <th className="py-2 pr-3">{t('Estado')}</th>
                    <th className="py-2 pr-3">{t('Profesionales')}</th>
                    <th className="py-2 pr-3">{t('Total')}</th>
                    <th className="py-2 pr-3">{t('Nota')}</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-b border-[#F0F1F5] align-top">
                      <td className="py-2 pr-3 text-[#3C4257] whitespace-nowrap">{fmtFecha(b.created_at)}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${BATCH_STATUS_STYLES[b.status] || ''}`}>
                          {BATCH_STATUS_LABELS[b.status] || b.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[#3C4257]">{b.professional_count}</td>
                      <td className="py-2 pr-3 font-semibold text-[#141820] whitespace-nowrap">Bs. {b.total_amount.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-[#64748B]">{b.bank_reference_note || '—'}</td>
                      <td className="py-2">
                        <div className="flex gap-2 justify-end flex-wrap">
                          {(b.status === 'DRAFT' || b.status === 'EXPORTED') && (
                            <button onClick={() => handleExport(b.id)} className="btn-secondary text-xs py-1 px-2 whitespace-nowrap">
                              {t('Descargar CSV')}
                            </button>
                          )}
                          {(b.status === 'DRAFT' || b.status === 'EXPORTED') && (
                            <button
                              onClick={() => { setConfirmingBatchId(b.id); setReferenceNote('') }}
                              className="btn-primary text-xs py-1 px-2 whitespace-nowrap"
                            >
                              {t('Confirmar pago')}
                            </button>
                          )}
                          {(b.status === 'DRAFT' || b.status === 'EXPORTED') && (
                            <button
                              onClick={() => {
                                if (confirm(t('¿Cancelar este lote? Las ganancias vuelven a quedar pendientes.'))) {
                                  cancelMutation.mutate(b.id)
                                }
                              }}
                              className="text-xs py-1 px-2 text-[#A32D2D] hover:underline whitespace-nowrap"
                            >
                              {t('Cancelar')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Confirmar lote */}
        {confirmingBatchId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirmingBatchId(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-semibold mb-2">{t('Confirmar que ya transferiste este lote')}</p>
              <p className="text-xs text-[#64748B] mb-3">
                {t('Esto marca cada pago incluido como transferido y avisa por WhatsApp a cada profesional. No se puede deshacer.')}
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
                <button onClick={() => setConfirmingBatchId(null)} className="btn-secondary text-xs py-1.5 px-3">
                  {t('Cancelar')}
                </button>
                <button
                  onClick={() => confirmMutation.mutate({ id: confirmingBatchId, note: referenceNote })}
                  disabled={confirmMutation.isPending}
                  className="btn-primary text-xs py-1.5 px-3"
                >
                  {confirmMutation.isPending ? t('Confirmando...') : t('Confirmar pago')}
                </button>
              </div>
            </div>
          </div>
        )}

        {viewingProfessional && (
          <BankAccountModal
            professionalId={viewingProfessional.id}
            professionalName={viewingProfessional.name}
            onClose={() => setViewingProfessional(null)}
            onVerified={() => {
              setSuccess(t('Cuenta verificada.'))
              refetchPending()
            }}
          />
        )}
      </div>
    </DashboardLayout>
  )
}
