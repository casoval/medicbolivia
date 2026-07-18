'use client'
// src/app/admin/ia/page.tsx
// Menú "IA" del panel admin — 5 pestañas:
//   1. Bot         → monitor y edición del bot de WhatsApp
//   2. Recordatorios → avisos automáticos a pacientes/profesionales/admin
//   3. Conversaciones → inbox de WhatsApp + on/off del agente
//   4. Mensajería masiva → anuncio libre a todos/pacientes/profesionales/público
//   5. Automatización → backups de la BD enviados por Gmail

import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { BotTab } from '@/components/admin/ia/BotTab'
import { RemindersTab } from '@/components/admin/ia/RemindersTab'
import { ConversationsTab } from '@/components/admin/ia/ConversationsTab'
import { BroadcastTab } from '@/components/admin/ia/BroadcastTab'
import { AutomationTab } from '@/components/admin/ia/AutomationTab'
import { useLanguage } from '@/lib/i18n/LanguageContext'

type TabKey = 'bot' | 'reminders' | 'conversations' | 'broadcast' | 'automation'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'bot',           label: 'Bot de WhatsApp' },
  { key: 'reminders',     label: 'Recordatorios' },
  { key: 'conversations', label: 'Conversaciones y agente' },
  { key: 'broadcast',     label: 'Mensajería masiva' },
  { key: 'automation',    label: 'Automatización' },
]

export default function AdminIAPage() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<TabKey>('bot')

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/ia" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('IA / WhatsApp')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            {t('Bot de WhatsApp, recordatorios automáticos, conversaciones, mensajería masiva y automatización de backups.')}
          </p>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-4 border-b border-[#DDE1EE] overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-[#185FA5] text-[#185FA5] font-medium'
                  : 'border-transparent text-[#6B738A] hover:text-[#141820]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'bot' && <BotTab />}
        {tab === 'reminders' && <RemindersTab />}
        {tab === 'conversations' && <ConversationsTab />}
        {tab === 'broadcast' && <BroadcastTab />}
        {tab === 'automation' && <AutomationTab />}
      </div>
    </DashboardLayout>
  )
}
