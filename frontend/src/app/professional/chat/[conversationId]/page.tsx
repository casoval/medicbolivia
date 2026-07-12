'use client'
// src/app/professional/chat/[conversationId]/page.tsx
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { useAuthStore } from '@/lib/store'
import { chatAPI } from '@/lib/api'
import { ChatConversationList } from '@/components/shared/ChatConversationList'
import { ChatWindow } from '@/components/shared/ChatWindow'
import { LoadingScreen, EmptyState } from '@/components/ui'

export default function ProfessionalChatConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const { user } = useAuthStore()

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: chatAPI.listConversations,
  })

  const conversation = conversations?.find((c) => c.id === conversationId)

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/chat" role="PROFESSIONAL">
      <div className="max-w-5xl grid md:grid-cols-[320px_1fr] gap-4">
        <div className="hidden md:block bg-white rounded-xl border border-[#E5E7EB] overflow-hidden h-[calc(100vh-140px)] overflow-y-auto">
          <ChatConversationList activeConversationId={conversationId} basePath="/professional/chat" />
        </div>

        {isLoading ? (
          <LoadingScreen text="Cargando conversación..." />
        ) : !conversation || !user ? (
          <EmptyState title="Conversación no encontrada" description="Puede que ya no tengas acceso a este chat." />
        ) : (
          <ChatWindow conversation={conversation} currentUserId={user.id} backHref="/professional/chat" />
        )}
      </div>
    </DashboardLayout>
  )
}
