'use client'
// src/app/admin/support-chat/page.tsx
// Bandeja compartida del chat directo con soporte: cualquier admin ve
// todas las conversaciones de pacientes y profesionales, y puede
// responder cualquiera (no hay asignación 1 a 1). Ver
// backend/app/api/v1/endpoints/admin_support_chat.py.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { Alert, EmptyState, LoadingScreen, Spinner } from '@/components/ui'
import { adminSupportChatAPI, SUPPORT_CHAT_PAGE_SIZE, getErrorMessage } from '@/lib/api'
import { useSupportChatSocket } from '@/lib/useSupportChatSocket'
import { useAuthStore } from '@/lib/store'
import type { SupportConversationSummary } from '@/types'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
const IconClip = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 01-7.78-7.78l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.48"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_MB = 10

function fmtHora(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' })
}

const ROLE_LABELS: Record<string, string> = { PATIENT: 'Paciente', PROFESSIONAL: 'Profesional' }

function ConversationListItem({ conv, active, onClick }: { conv: SupportConversationSummary; active: boolean; onClick: () => void }) {
  const initials = (conv.participant?.full_name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const waitingOnUs = conv.last_message_from === 'USER'
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-2.5 transition-colors ${
        active ? 'bg-[#E6F1FB]' : 'hover:bg-[#F5F6FA]'
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-[#185FA5] text-white text-xs font-bold flex items-center justify-center shrink-0">
        {initials || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={`text-sm truncate ${conv.unread_count > 0 ? 'font-semibold text-[#141820]' : 'font-medium text-[#141820]'}`}>
            {conv.participant?.full_name || 'Usuario'}
          </p>
          {conv.last_message_at && <span className="text-[10px] text-[#94A3B8] shrink-0">{fmtHora(conv.last_message_at)}</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[#64748B] truncate">
            {conv.participant?.role && <span className="mr-1">{ROLE_LABELS[conv.participant.role]}</span>}
            {waitingOnUs && conv.last_message_preview ? `↳ ${conv.last_message_preview}` : conv.last_message_preview || 'Sin mensajes'}
          </p>
          {conv.unread_count > 0 && (
            <span className="w-5 h-5 shrink-0 bg-[#E24B4A] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {conv.unread_count > 9 ? '9+' : conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function AdminConversationPanel({ conv, currentUserId }: { conv: SupportConversationSummary; currentUserId: string }) {
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)

  const { data: history, isLoading } = useQuery({
    queryKey: ['admin-support-chat-messages', conv.id],
    queryFn: () => adminSupportChatAPI.getMessages(conv.id),
    // Sin esto, hereda el staleTime global de 5 minutos (ver Providers.tsx),
    // pensado para datos casi estáticos. Acá es letal: mientras el admin
    // está viendo OTRA conversación, esta no tiene socket abierto (solo la
    // seleccionada lo tiene) — así que un mensaje nuevo que llegue mientras
    // tanto no se entera ni por WS ni por caché al volver a seleccionarla,
    // hasta que pasen los 5 minutos o se recargue la página entera. Con
    // staleTime: 0, cada vez que se (re)selecciona una conversación se pide
    // la lista fresca al backend, sin depender del reload.
    staleTime: 0,
  })

  const {
    messages, hasMore, connected, sendMessage, seedMessages, prependOlderMessages, addLocalMessage,
  } = useSupportChatSocket(conv.id, currentUserId)

  useEffect(() => {
    didInitialScroll.current = false
    if (history) seedMessages(history, SUPPORT_CHAT_PAGE_SIZE)
  }, [history, seedMessages, conv.id])

  const lastMarkedForRef = useRef<string | null>(null)
  useEffect(() => {
    const unreadFromUser = messages.filter((m) => !m.is_admin_sender && !m.read_at)
    if (unreadFromUser.length === 0) return
    const marker = unreadFromUser[unreadFromUser.length - 1].id
    if (lastMarkedForRef.current === marker) return
    lastMarkedForRef.current = marker
    adminSupportChatAPI.markRead(conv.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['admin-support-chat-conversations'] }))
      .catch(() => { /* no crítico */ })
  }, [messages, conv.id, queryClient])

  useLayoutEffect(() => {
    if (didInitialScroll.current || messages.length === 0) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    didInitialScroll.current = true
  }, [messages.length])

  const prevCountRef = useRef(0)
  useEffect(() => {
    if (!didInitialScroll.current) return
    if (messages.length > prevCountRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    prevCountRef.current = messages.length
  }, [messages.length])

  async function handleLoadOlder() {
    const oldest = messages[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true)
    const container = historyRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0
    try {
      const older = await adminSupportChatAPI.getMessages(conv.id, oldest.created_at)
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
      id: `temp-${Date.now()}`, conversation_id: conv.id, sender_id: currentUserId,
      is_admin_sender: true, content, attachment_url: null, attachment_content_type: null,
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
      const msg = await adminSupportChatAPI.sendAttachment(conv.id, file)
      addLocalMessage(msg)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleToggleStatus() {
    setClosing(true)
    setError('')
    try {
      if (conv.status === 'OPEN') {
        await adminSupportChatAPI.close(conv.id)
      } else {
        await adminSupportChatAPI.reopen(conv.id)
      }
      queryClient.invalidateQueries({ queryKey: ['admin-support-chat-conversations'] })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#DDE1EE] shrink-0">
        <div>
          <p className="text-sm font-semibold">{conv.participant?.full_name || 'Usuario'}</p>
          <p className="text-xs text-[#64748B]">
            {conv.participant?.role && ROLE_LABELS[conv.participant.role]}
            {' · '}
            {conv.status === 'OPEN' ? 'Abierta' : 'Marcada como resuelta'}
          </p>
        </div>
        <button
          onClick={handleToggleStatus}
          disabled={closing}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60 ${
            conv.status === 'OPEN' ? 'bg-[#F5F6FA] text-[#475569] hover:bg-[#E5E7EB]' : 'bg-[#E7F8EF] text-[#0F6E56]'
          }`}
        >
          {closing ? '...' : conv.status === 'OPEN' ? 'Marcar como resuelta' : 'Reabrir'}
        </button>
      </div>

      <div ref={historyRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#FAFAFA]">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
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
            const own = m.is_admin_sender
            return (
              <div key={m.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  own ? 'bg-[#185FA5] text-white rounded-br-md' : 'bg-white border border-[#E5E7EB] text-[#111827] rounded-bl-md'
                }`}>
                  {m.attachment_url ? (
                    m.attachment_content_type?.startsWith('image/') ? (
                      <a href={m.attachment_url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.attachment_url} alt="Adjunto" className="rounded-lg max-w-full max-h-64" />
                      </a>
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
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="px-4 pb-2"><Alert type="error" message={error} /></div>}

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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={connected ? 'Escribe una respuesta' : 'Conectando...'}
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
    </div>
  )
}

export default function AdminSupportChatPage() {
  const { t } = useLanguage()
  const { user } = useAuthStore()
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'CLOSED' | undefined>('OPEN')
  const [roleFilter, setRoleFilter] = useState<'PATIENT' | 'PROFESSIONAL' | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['admin-support-chat-conversations', statusFilter, roleFilter],
    queryFn: () => adminSupportChatAPI.listConversations({ status: statusFilter, role: roleFilter }),
    refetchInterval: 20000,
  })

  const selected = conversations.find((c) => c.id === selectedId) || null

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/support-chat" role="ADMIN">
      <div className="mb-4">
        <h1 className="text-base font-semibold">{t('Chat con soporte')}</h1>
        <p className="text-xs text-[#475569] mt-0.5">
          Mensajes directos de pacientes y profesionales con el equipo de MedicBolivia — cualquier
          admin puede ver y responder cualquier conversación.
        </p>
      </div>

      <div className="card p-0 overflow-hidden" style={{ height: 'calc(100vh - 190px)', minHeight: 480 }}>
        <div className="flex h-full">
          {/* Lista de conversaciones */}
          <div className={`w-full sm:w-80 border-r border-[#DDE1EE] flex flex-col shrink-0 ${selected ? 'hidden sm:flex' : 'flex'}`}>
            <div className="p-3 border-b border-[#DDE1EE] flex flex-wrap gap-1.5 shrink-0">
              {(['OPEN', 'CLOSED', undefined] as const).map((s) => (
                <button
                  key={s ?? 'ALL'}
                  onClick={() => setStatusFilter(s)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-lg ${statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-[#F5F6FA] text-[#475569]'}`}
                >
                  {s === 'OPEN' ? t('Abiertas') : s === 'CLOSED' ? t('Resueltas') : t('Todas')}
                </button>
              ))}
              <span className="w-full h-0" />
              {(['PATIENT', 'PROFESSIONAL', undefined] as const).map((r) => (
                <button
                  key={r ?? 'ALL_ROLE'}
                  onClick={() => setRoleFilter(r)}
                  className={`text-[11px] font-medium px-2 py-1 rounded-lg ${roleFilter === r ? 'bg-[#E6F1FB] text-[#185FA5]' : 'bg-white text-[#94A3B8] border border-[#E5E7EB]'}`}
                >
                  {r ? ROLE_LABELS[r] : t('Todos')}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoading ? (
                <LoadingScreen text="Cargando conversaciones..." />
              ) : conversations.length === 0 ? (
                <EmptyState title={t('No hay conversaciones acá')} description={t('Cuando alguien escriba a soporte, aparecerá en esta lista.')} />
              ) : (
                conversations.map((c) => (
                  <ConversationListItem key={c.id} conv={c} active={c.id === selectedId} onClick={() => setSelectedId(c.id)} />
                ))
              )}
            </div>
          </div>

          {/* Conversación seleccionada */}
          <div className={`flex-1 min-w-0 ${selected ? 'flex' : 'hidden sm:flex'} flex-col`}>
            {selected && user ? (
              <>
                <button
                  onClick={() => setSelectedId(null)}
                  className="sm:hidden flex items-center gap-1.5 text-xs text-[#185FA5] px-4 py-2 border-b border-[#DDE1EE]"
                >
                  ← {t('Volver a la lista')}
                </button>
                <AdminConversationPanel key={selected.id} conv={selected} currentUserId={user.id} />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#94A3B8]">{t('Selecciona una conversación para ver los mensajes')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
