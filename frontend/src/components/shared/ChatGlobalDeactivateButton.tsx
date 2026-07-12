'use client'
// src/components/shared/ChatGlobalDeactivateButton.tsx
// "Desactivar mi chat y reportar" — acción GENERAL (no depende de
// ninguna conversación puntual), por eso vive en el listado de
// Mensajes y no dentro de ChatWindow. Ver backend: POST/DELETE /chat/block-all.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatAPI, getErrorMessage } from '@/lib/api'
import { Alert } from '@/components/ui'
import { CHAT_REASON_CATEGORY_LABELS, type ChatReasonCategory } from '@/types'

const IconBan = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><path d="M4.9 4.9l14.2 14.2" />
  </svg>
)

export function ChatGlobalDeactivateButton() {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [reportChecked, setReportChecked] = useState(false)
  const [reasonCategory, setReasonCategory] = useState<ChatReasonCategory>('OTHER')
  const [reasonText, setReasonText] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: status } = useQuery({
    queryKey: ['chat-global-block-status'],
    queryFn: chatAPI.getGlobalBlockStatus,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['chat-global-block-status'] })
    queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
  }

  async function handleReactivate() {
    setSubmitting(true)
    setError('')
    try {
      await chatAPI.unblockAll()
      refresh()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitDeactivate() {
    setSubmitting(true)
    setError('')
    try {
      await chatAPI.blockAll({
        isReported: reportChecked,
        reasonCategory: reportChecked ? reasonCategory : undefined,
        reasonText: reportChecked ? (reasonText || undefined) : undefined,
      })
      refresh()
      setModalOpen(false)
      setReportChecked(false)
      setReasonText('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (status?.blocked) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg mb-3">
        <p className="text-xs text-[#991B1B]">Tu chat interno está desactivado en este momento.</p>
        <button
          onClick={handleReactivate}
          disabled={submitting}
          className="text-xs font-medium text-[#185FA5] hover:underline disabled:opacity-50 flex-shrink-0"
        >
          {submitting ? 'Reactivando...' : 'Reactivar chat'}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2] px-3 py-1.5 rounded-lg"
        >
          <IconBan /> Desactivar mi chat y reportar (opcional)
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-sm font-semibold text-[#111827]">Desactivar mi chat interno</h3>
              <p className="text-xs text-[#6B7280] mt-1">
                Esto corta el chat con cualquiera de tus contactos, no solo con uno en particular.
                No podrás escribir ni recibir mensajes hasta que lo reactives.
              </p>
            </div>

            {error && <Alert type="error" message={error} />}

            <label className="flex items-start gap-2 text-sm text-[#111827]">
              <input
                type="checkbox"
                checked={reportChecked}
                onChange={(e) => setReportChecked(e.target.checked)}
                className="mt-0.5"
              />
              Además, quiero reportar este caso al equipo de MedicBolivia
            </label>

            {reportChecked && (
              <div className="space-y-3 pl-6">
                <div>
                  <label className="text-xs text-[#6B7280] block mb-1">Motivo</label>
                  <select
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value as ChatReasonCategory)}
                    className="w-full text-sm border border-[#E5E7EB] rounded-lg px-3 py-2"
                  >
                    {Object.entries(CHAT_REASON_CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#6B7280] block mb-1">Detalle (opcional)</label>
                  <textarea
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="w-full text-sm border border-[#E5E7EB] rounded-lg px-3 py-2 resize-none"
                    placeholder="Contanos brevemente qué pasó..."
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-[#6B7280] hover:bg-[#F5F6FA] rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmitDeactivate}
                disabled={submitting}
                className="px-4 py-2 text-sm text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Aplicando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
