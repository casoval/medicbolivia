'use client'
// src/app/patient/chat/page.tsx
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { ChatConversationList } from '@/components/shared/ChatConversationList'
import { ChatGlobalDeactivateButton } from '@/components/shared/ChatGlobalDeactivateButton'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export default function PatientChatPage() {
  const { t } = useLanguage()
  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/chat" role="PATIENT">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-[#111827] mb-1">{t('Mensajes')}</h1>
        <p className="text-sm text-[#6B7280] mb-4">
          Chatea con tus profesionales para el seguimiento posterior a una consulta.
        </p>
        <ChatGlobalDeactivateButton />
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <ChatConversationList basePath="/patient/chat" />
        </div>
      </div>
    </DashboardLayout>
  )
}
