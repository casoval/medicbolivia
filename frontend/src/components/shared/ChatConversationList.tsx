'use client'
// src/components/shared/ChatConversationList.tsx
// Lista de conversaciones del chat interno, compartida entre
// /patient/chat y /professional/chat.

import { useQuery } from '@tanstack/react-query'
import { chatAPI } from '@/lib/api'
import { LoadingScreen, EmptyState } from '@/components/ui'

function fmtFechaCorta(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', timeZone: 'America/La_Paz' })
}

interface ChatConversationListProps {
  activeConversationId?: string
  /** Prefijo de ruta, ej: '/patient/chat' o '/professional/chat' */
  basePath: string
}

export function ChatConversationList({ activeConversationId, basePath }: ChatConversationListProps) {
  const { data: conversations, isLoading } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: chatAPI.listConversations,
    refetchInterval: 30_000, // fallback por si el WS de una conversación abierta en otra pestaña se cae
  })

  if (isLoading) return <LoadingScreen text="Cargando conversaciones..." />

  if (!conversations || conversations.length === 0) {
    return (
      <EmptyState
        title="Todavía no tienes conversaciones"
        description="El chat se habilita automáticamente al terminar una consulta, para el seguimiento posterior."
      />
    )
  }

  return (
    <div className="divide-y divide-[#E5E7EB]">
      {conversations.map((c) => (
        <a
          key={c.id}
          href={`${basePath}/${c.id}`}
          className={`flex items-center gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors ${
            c.id === activeConversationId ? 'bg-[#E6F1FB]' : ''
          }`}
        >
          {c.other_participant.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.other_participant.photo_url} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-sm font-bold flex-shrink-0">
              {c.other_participant.full_name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-[#111827] truncate">{c.other_participant.full_name}</p>
              {c.last_message_at && (
                <span className="text-xs text-[#9CA3AF] flex-shrink-0">{fmtFechaCorta(c.last_message_at)}</span>
              )}
            </div>
            <p className="text-xs text-[#6B7280] truncate">
              {c.status !== 'ACTIVE' && <span className="text-[#9CA3AF]">Cerrada · </span>}
              {c.last_message_preview || 'Sin mensajes todavía'}
            </p>
          </div>
        </a>
      ))}
    </div>
  )
}
