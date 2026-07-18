'use client'
// src/app/professional/chat/page.tsx
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { ChatConversationList } from '@/components/shared/ChatConversationList'
import { ChatGlobalDeactivateButton } from '@/components/shared/ChatGlobalDeactivateButton'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export default function ProfessionalChatPage() {
  const { t } = useLanguage()
  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/chat" role="PROFESSIONAL">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-[#111827] mb-1">{t('Mensajes')}</h1>
        <p className="text-sm text-[#6B7280] mb-4">
          Seguimiento posterior a tus consultas. Recordá que, por política, tu número de teléfono
          no se comparte con el paciente a través de la plataforma.
        </p>
        <ChatGlobalDeactivateButton />
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <ChatConversationList basePath="/professional/chat" />
        </div>
      </div>
    </DashboardLayout>
  )
}
