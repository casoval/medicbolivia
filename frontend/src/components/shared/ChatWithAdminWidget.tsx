'use client'
// src/components/shared/ChatWithAdminWidget.tsx
//
// Chat directo con soporte (paciente/profesional ↔ equipo de MedicBolivia).
// Módulo aparte del chat interno paciente-profesional (ChatWindow.tsx):
// acá no hay bloqueo, ni reportes, ni expiración por ventana de días —
// es la línea directa con el equipo, pensada para estar siempre
// disponible. Se monta una sola vez desde DashboardLayout para los
// roles PATIENT y PROFESSIONAL.
//
// Dos puntos de entrada comparten el mismo panel (via useSupportChatUIStore):
// - La burbuja flotante de acá abajo, que se puede ocultar con la "x"
//   (persistido en localStorage — vuelve a aparecer solo si el usuario
//   entra a una pestaña nueva, no con cada mensaje).
// - El botón del encabezado (ver DashboardLayout.tsx), que siempre
//   funciona aunque la burbuja esté oculta.
//
// Para ADMIN la burbuja también se muestra (con el mismo badge de no
// leídos que el botón del encabezado), pero en vez de abrir el panel
// mini lleva a la bandeja completa /admin/support-chat — un admin puede
// tener varias conversaciones abiertas a la vez, así que un popup de
// una sola conversación no tiene sentido para ese rol.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { supportChatAPI, adminSupportChatAPI, SUPPORT_CHAT_PAGE_SIZE, getErrorMessage } from '@/lib/api'
import { useSupportChatSocket } from '@/lib/useSupportChatSocket'
import { useAuthStore, useSupportChatUIStore } from '@/lib/store'
import { Alert, Spinner } from '@/components/ui'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const IconChat = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
const IconClip = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.48"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconClose = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
const IconExpand = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 10

function fmtHora(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' })
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-label="Escribiendo...">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  )
}

const SIZE = 56
const MARGIN = 20

export function ChatWithAdminWidget() {
  const { t } = useLanguage()
  const router = useRouter()
  const { user } = useAuthStore()
  const role = user?.role
  const isAdmin = role === 'ADMIN'
  const eligible = role === 'PATIENT' || role === 'PROFESSIONAL' || isAdmin

  const { isOpen, open, close, unreadCount, setUnreadCount, bubbleHidden, setBubbleHidden } = useSupportChatUIStore()

  const { data: config } = useQuery({
    queryKey: ['support-chat-config'],
    queryFn: supportChatAPI.getConfig,
    enabled: eligible,
    staleTime: 5 * 60 * 1000,
  })

  const supportChatEnabled = config?.enabled !== false

  // Paciente/profesional: un solo hilo propio con soporte. Admin: no
  // aplica (la bandeja tiene muchas conversaciones a la vez), así que
  // ni siquiera se pide — ver adminUnread más abajo en su lugar.
  const { data: conversation } = useQuery({
    queryKey: ['support-chat-my-conversation'],
    queryFn: supportChatAPI.getMyConversation,
    enabled: eligible && !isAdmin && supportChatEnabled,
    // Mientras el panel está cerrado, esto es lo único que actualiza el
    // badge de no leídos (no hay socket abierto de fondo). Mismo
    // intervalo que la campanita de notificaciones.
    refetchInterval: isOpen ? false : 20000,
  })

  const { data: adminUnread } = useQuery({
    queryKey: ['admin-support-chat-unread'],
    queryFn: adminSupportChatAPI.getUnreadCount,
    enabled: isAdmin && supportChatEnabled,
    refetchInterval: 20000,
  })

  useEffect(() => {
    if (isAdmin) {
      if (adminUnread) setUnreadCount(adminUnread.unread)
    } else if (conversation && !isOpen) {
      setUnreadCount(conversation.unread_count)
    }
  }, [conversation, adminUnread, isAdmin, isOpen, setUnreadCount])

  // ── burbuja oculta manualmente (persistido por usuario) ──
  const storageKey = user ? `mb_support_widget_hidden_${role}_${user.id}` : null
  useEffect(() => {
    if (!storageKey) return
    try {
      if (localStorage.getItem(storageKey) === '1') setBubbleHidden(true)
    } catch {
      // no crítico
    }
  }, [storageKey, setBubbleHidden])

  function dismissBubble(e: React.MouseEvent) {
    e.stopPropagation()
    setBubbleHidden(true)
    if (storageKey) {
      try { localStorage.setItem(storageKey, '1') } catch { /* no crítico */ }
    }
  }

  function handleBubbleClick() {
    if (isAdmin) {
      router.push('/admin/support-chat')
    } else {
      open()
    }
  }

  if (!eligible || !supportChatEnabled) return null
  // Para paciente/profesional, la burbuja necesita el hilo propio ya
  // resuelto (para poder abrir el panel al toque); para admin no hace
  // falta (el clic solo navega a la bandeja).
  if (!isAdmin && !conversation) return null

  return (
    <>
      {!bubbleHidden && !isOpen && (
        <div className="fixed z-[60]" style={{ right: MARGIN, bottom: MARGIN }}>
          <div className="relative">
            <button
              onClick={handleBubbleClick}
              className="rounded-full bg-[#185FA5] text-white shadow-lg flex items-center justify-center border-2 border-white active:scale-95 transition-transform"
              style={{ width: SIZE, height: SIZE }}
              title={t('Chat con soporte')}
            >
              <IconChat />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#E24B4A] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white pointer-events-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={dismissBubble}
              className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white text-[#475569] border border-[#DDE1EE] shadow flex items-center justify-center hover:text-[#141820]"
              title={t('Ocultar (accedé desde el botón del encabezado)')}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* El panel mini solo aplica a paciente/profesional — el admin
          siempre va a la bandeja completa (ver handleBubbleClick). */}
      {!isAdmin && isOpen && user && conversation && (
        <SupportChatPanel conversationId={conversation.id} currentUserId={user.id} onClose={close} />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────
// Panel de chat: fijo abajo-a-la-derecha en escritorio, pantalla
// completa en mobile (viewport angosto). Sin menú de bloqueo ni banner
// de expiración — a diferencia del chat interno, acá siempre se puede
// escribir salvo que el interruptor global esté apagado.
// ─────────────────────────────────────────────────────

function SupportChatPanel({
  conversationId, currentUserId, onClose,
}: {
  conversationId: string
  currentUserId: string
  onClose: () => void
}) {
  const { t } = useLanguage()
  const { setUnreadCount } = useSupportChatUIStore()
  const [draft, setDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)

  const { data: history, isLoading } = useQuery({
    queryKey: ['support-chat-messages', conversationId],
    queryFn: () => supportChatAPI.getMessages(),
  })

  const {
    messages, hasMore, connected, otherTyping,
    sendMessage, sendTyping, seedMessages, prependOlderMessages, addLocalMessage,
  } = useSupportChatSocket(conversationId, currentUserId)

  useEffect(() => {
    didInitialScroll.current = false
    if (history) seedMessages(history, SUPPORT_CHAT_PAGE_SIZE)
  }, [history, seedMessages, conversationId])

  // Marca leídos los mensajes del admin apenas se ven, y refleja el
  // contador en 0 mientras el panel está abierto (el usuario los está
  // viendo en vivo).
  const lastMarkedForRef = useRef<string | null>(null)
  useEffect(() => {
    const unreadFromAdmin = messages.filter((m) => m.is_admin_sender && !m.read_at)
    setUnreadCount(0)
    if (unreadFromAdmin.length === 0) return
    const marker = unreadFromAdmin[unreadFromAdmin.length - 1].id
    if (lastMarkedForRef.current === marker) return
    lastMarkedForRef.current = marker
    supportChatAPI.markRead().catch(() => { /* no crítico */ })
  }, [messages, setUnreadCount])

  useLayoutEffect(() => {
    if (didInitialScroll.current || messages.length === 0) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    didInitialScroll.current = true
  }, [messages.length])

  const prevCountRef = useRef(0)
  useEffect(() => {
    if (!didInitialScroll.current) return
    if (messages.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevCountRef.current = messages.length
  }, [messages.length])

  async function handleLoadOlder() {
    const oldest = messages[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true)
    const container = historyRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0
    try {
      const older = await supportChatAPI.getMessages(oldest.created_at)
      prependOlderMessages(older, SUPPORT_CHAT_PAGE_SIZE)
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight
        }
      })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoadingOlder(false)
    }
  }

  function handleSend() {
    const content = draft.trim()
    if (!content) return
    addLocalMessage({
      id: `temp-${Date.now()}`, conversation_id: conversationId, sender_id: currentUserId,
      is_admin_sender: false, content, attachment_url: null, attachment_content_type: null,
      read_at: null, created_at: new Date().toISOString(),
    })
    sendMessage(content)
    setDraft('')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Tipo de archivo no permitido. Solo imágenes (JPEG, PNG, WEBP) o PDF')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Archivo demasiado grande. Máximo ${MAX_MB} MB`)
      return
    }
    setUploading(true)
    try {
      const msg = await supportChatAPI.sendAttachment(file)
      addLocalMessage(msg)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className="fixed z-[70] inset-0 sm:inset-auto flex flex-col bg-white sm:rounded-2xl sm:shadow-2xl sm:border sm:border-[#DDE1EE] overflow-hidden"
      style={{ right: 20, bottom: 20, width: '100%', maxWidth: 380, height: '100%', maxHeight: 600 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#185FA5] text-white shrink-0">
        <div>
          <p className="text-sm font-semibold">{t('Chat con soporte')}</p>
          <p className="text-[11px] text-white/80">
            {connected ? t('Equipo de MedicBolivia') : t('Conectando...')}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cerrar">
          <IconClose />
        </button>
      </div>

      {/* Historial */}
      <div ref={historyRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#FAFAFA]">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
            {messages.length === 0 && (
              <p className="text-xs text-[#64748B] text-center py-6">
                {t('¿En qué te podemos ayudar? Escribinos y el equipo de MedicBolivia te responde a la brevedad.')}
              </p>
            )}
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                  className="text-xs text-[#185FA5] hover:underline disabled:opacity-50 flex items-center gap-1.5"
                >
                  {loadingOlder ? <Spinner size="sm" /> : null}
                  {loadingOlder ? 'Cargando...' : 'Ver mensajes anteriores'}
                </button>
              </div>
            )}
            {messages.map((m) => {
              const own = !m.is_admin_sender
              return (
                <div key={m.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'}`}>
                  {!own && <p className="text-[10px] text-[#64748B] px-1 mb-0.5">{t('Soporte MedicBolivia')}</p>}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      own ? 'bg-[#185FA5] text-white rounded-br-md' : 'bg-white border border-[#E5E7EB] text-[#111827] rounded-bl-md'
                    }`}
                  >
                    {m.attachment_url ? (
                      m.attachment_content_type?.startsWith('image/') ? (
                        <button onClick={() => setPreviewUrl(m.attachment_url)} className="relative block group" aria-label="Ver imagen en grande">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.attachment_url} alt="Adjunto" loading="lazy" className="rounded-lg max-w-full max-h-56 cursor-zoom-in" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-1.5"><IconExpand /></span>
                          </span>
                        </button>
                      ) : (
                        <a href={m.attachment_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
                          <IconFile /> {t('Ver documento')}
                        </a>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    )}
                  </div>
                  <p className="text-[11px] text-[#9CA3AF] mt-1 px-1">{fmtHora(m.created_at)}</p>
                </div>
              )
            })}
            {otherTyping && (
              <div className="flex flex-col items-start">
                <div className="bg-white border border-[#E5E7EB] rounded-2xl rounded-bl-md px-3 py-2.5">
                  <TypingDots />
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="px-4 pb-2"><Alert type="error" message={error} /></div>}

      {/* Composer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[#E5E7EB] shrink-0">
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
          onChange={(e) => { setDraft(e.target.value); sendTyping() }}
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

      {previewUrl && (
        <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-6" onClick={() => setPreviewUrl(null)}>
          <button onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10" aria-label="Cerrar">
            <IconClose />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Adjunto ampliado" className="max-w-full max-h-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
