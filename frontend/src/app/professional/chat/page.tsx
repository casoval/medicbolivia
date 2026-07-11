'use client'
// src/app/professional/chat/page.tsx
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { ChatConversationList } from '@/components/shared/ChatConversationList'

export default function ProfessionalChatPage() {
  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/chat" role="PROFESSIONAL">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-[#111827] mb-1">Mensajes</h1>
        <p className="text-sm text-[#6B7280] mb-4">
          Seguimiento posterior a tus consultas. Recordá que, por política, tu número de teléfono
          no se comparte con el paciente a través de la plataforma.
        </p>
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <ChatConversationList basePath="/professional/chat" />
        </div>
      </div>
    </DashboardLayout>
  )
}
