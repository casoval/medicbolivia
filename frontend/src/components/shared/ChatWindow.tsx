'use client'
// src/components/shared/ChatWindow.tsx
// Ventana de chat de una conversación: historial + composer + adjuntos +
// menú de bloqueo. Compartida entre /patient/chat/[id] y
// /professional/chat/[id] — el rol de quién mira la pantalla es
// irrelevante para este componente, solo importa currentUserId para
// alinear las burbujas propias vs. las del otro participante.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatAPI, getErrorMessage } from '@/lib/api'
import { useChatSocket } from '@/lib/useChatSocket'
import { Alert, Spinner } from '@/components/ui'
import type { ChatConversationSummary } from '@/types'

const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
const IconClip = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.48"/></svg>
const IconDots = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
const IconBan = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconDownload = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const IconClose = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
const IconExpand = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 10

function fmtHora(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' })
}

function fmtDiasRestantes(expiresAt: string | null): string | null {
  if (!expiresAt) return null
  const s = expiresAt.endsWith('Z') ? expiresAt : expiresAt + 'Z'
  const diffMs = new Date(s).getTime() - Date.now()
  if (diffMs <= 0) return 'venció'
  const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return `vence en ${dias} día${dias === 1 ? '' : 's'}`
}

interface ChatWindowProps {
  conversation: ChatConversationSummary
  currentUserId: string
  /** Ruta a la que volver desde el header (ej: '/patient/chat') */
  backHref: string
}

export function ChatWindow({ conversation, currentUserId, backHref }: ChatWindowProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: history, isLoading } = useQuery({
    queryKey: ['chat-messages', conversation.id],
    queryFn: () => chatAPI.getMessages(conversation.id),
  })

  const { messages, connected, chatUnavailable, sendMessage, seedMessages, addLocalMessage } =
    useChatSocket(conversation.id, currentUserId)

  useEffect(() => {
    if (history) seedMessages(history)
  }, [history, seedMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const writable = conversation.status === 'ACTIVE' && !chatUnavailable
  const diasRestantes = fmtDiasRestantes(conversation.expires_at)

  function handleSend() {
    const content = draft.trim()
    if (!content || !writable) return
    sendMessage(content)
    setDraft('')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Solo se permiten imágenes (JPEG, PNG, WEBP) o PDF')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`El archivo supera el máximo de ${MAX_MB} MB`)
      return
    }

    setUploading(true)
    try {
      const msg = await chatAPI.sendAttachment(conversation.id, file)
      addLocalMessage(msg)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(url: string) {
    setDownloading(true)
    try {
      // Las URLs de adjuntos son prefirmadas de R2; intentamos traer el
      // archivo como blob para forzar la descarga (con el nombre elegido)
      // en vez de solo navegar a la URL.
      const res = await fetch(url)
      if (!res.ok) throw new Error('No se pudo descargar')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const ext = blob.type.split('/')[1]?.split('+')[0] || 'jpg'
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `adjunto-chat.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      // Si el bucket no permite CORS para leer el blob, al menos abrimos
      // la imagen en una pestaña nueva para que el usuario la guarde a mano.
      window.open(url, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    if (!previewUrl) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewUrl(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewUrl])

  const [confirmBlockOpen, setConfirmBlockOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // La ventana de chat de esta conversación ya venció: no se puede
  // "reactivar" desbloqueando (regla de los 15 días). El botón de
  // Desbloquear se deshabilita en ese caso.
  const windowExpired = conversation.status !== 'ACTIVE'
    || (conversation.expires_at ? new Date(conversation.expires_at.endsWith('Z') ? conversation.expires_at : conversation.expires_at + 'Z') < new Date() : false)

  async function handleConfirmBlock() {
    setSubmitting(true)
    try {
      await chatAPI.block(conversation.id)
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
      setConfirmBlockOpen(false)
      setMenuOpen(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUnblock() {
    try {
      await chatAPI.unblock(conversation.id)
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
      setMenuOpen(false)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-3">
          <a href={backHref} className="text-[#6B7280] hover:text-[#111827] md:hidden">←</a>
          {conversation.other_participant.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conversation.other_participant.photo_url} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold">
              {conversation.other_participant.full_name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-[#111827]">{conversation.other_participant.full_name}</p>
            <p className="text-xs text-[#6B7280]">
              {conversation.status === 'ACTIVE'
                ? (diasRestantes ? `Seguimiento activo · ${diasRestantes}` : 'Seguimiento activo')
                : 'Conversación cerrada · solo lectura'}
            </p>
          </div>
        </div>

        <div className="relative">
          <button onClick={() => setMenuOpen((o) => !o)} className="p-2 text-[#6B7280] hover:bg-[#F5F6FA] rounded-lg">
            <IconDots />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 w-72 bg-white border border-[#E5E7EB] rounded-xl shadow-lg py-1 z-10">
              {conversation.my_active_block_contact ? (
                <button
                  onClick={handleUnblock}
                  disabled={windowExpired}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#185FA5] hover:bg-[#F5F6FA] text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  title={windowExpired ? 'La ventana de chat de esta conversación ya venció' : undefined}
                >
                  <IconBan /> Desbloquear a {conversation.other_participant.full_name.split(' ')[0]}
                </button>
              ) : (
                <button
                  onClick={() => { setConfirmBlockOpen(true); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#DC2626] hover:bg-[#FEF2F2] text-left"
                >
                  <IconBan /> Bloquear a {conversation.other_participant.full_name.split(' ')[0]}
                </button>
              )}
            </div>
          )}
        </div>

        {confirmBlockOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setConfirmBlockOpen(false)}>
            <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className="text-sm font-semibold text-[#111827]">
                  ¿Bloquear a {conversation.other_participant.full_name}?
                </h3>
                <p className="text-xs text-[#6B7280] mt-1">
                  Ya no podrán escribirse por el chat interno. Tus demás conversaciones no se ven afectadas.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmBlockOpen(false)}
                  className="px-4 py-2 text-sm text-[#6B7280] hover:bg-[#F5F6FA] rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmBlock}
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Bloqueando...' : 'Bloquear'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#FAFAFA]">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          messages.map((m) => {
            const own = m.sender_id === currentUserId
            return (
              <div key={m.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    own ? 'bg-[#185FA5] text-white rounded-br-md' : 'bg-white border border-[#E5E7EB] text-[#111827] rounded-bl-md'
                  }`}
                >
                  {m.attachment_url ? (
                    m.attachment_content_type?.startsWith('image/') ? (
                      <button
                        onClick={() => setPreviewUrl(m.attachment_url)}
                        className="relative block group"
                        aria-label="Ver imagen en grande"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.attachment_url} alt="Adjunto" className="rounded-lg max-w-full max-h-64 cursor-zoom-in" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-1.5">
                            <IconExpand />
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <a href={m.attachment_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
                          <IconFile /> Ver documento
                        </a>
                        <button
                          onClick={() => handleDownload(m.attachment_url!)}
                          className={`p-1 rounded hover:bg-black/10 ${own ? 'text-white' : 'text-[#6B7280]'}`}
                          aria-label="Descargar documento"
                        >
                          <IconDownload />
                        </button>
                      </div>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  )}
                </div>
                <p className="text-[11px] text-[#9CA3AF] mt-1 px-1">{fmtHora(m.created_at)}</p>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="px-4 pb-2"><Alert type="error" message={error} /></div>}

      {!writable && (
        <div className="px-4 py-3 border-t border-[#E5E7EB] bg-[#F5F6FA] text-xs text-[#6B7280] text-center">
          Esta conversación no está disponible en este momento. El historial sigue visible.
        </div>
      )}

      {/* Composer */}
      {writable && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[#E5E7EB]">
          <input ref={fileInputRef} type="file" accept={ALLOWED_TYPES.join(',')} className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="p-2 text-[#6B7280] hover:bg-[#F5F6FA] rounded-lg disabled:opacity-50"
            aria-label="Adjuntar archivo"
          >
            {uploading ? <Spinner size="sm" /> : <IconClip />}
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={connected ? 'Escribe un mensaje' : 'Conectando...'}
            disabled={!connected}
            className="flex-1 border border-[#E5E7EB] rounded-full px-4 py-2 text-sm focus:outline-none focus:border-[#185FA5]"
          />
          <button
            onClick={handleSend}
            disabled={!connected || !draft.trim()}
            className="p-2 bg-[#185FA5] text-white rounded-full disabled:opacity-40"
            aria-label="Enviar mensaje"
          >
            <IconSend />
          </button>
        </div>
      )}

      {/* Lightbox: imagen ampliada a pantalla completa con descarga */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10"
            aria-label="Cerrar"
          >
            <IconClose />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload(previewUrl) }}
            disabled={downloading}
            className="absolute top-4 right-16 text-white p-2 rounded-full hover:bg-white/10 disabled:opacity-50"
            aria-label="Descargar imagen"
          >
            {downloading ? <Spinner size="sm" /> : <IconDownload />}
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Adjunto ampliado"
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
