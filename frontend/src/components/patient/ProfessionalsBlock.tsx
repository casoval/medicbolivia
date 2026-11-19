// src/components/patient/ProfessionalsBlock.tsx
// Lista de profesionales encontrados por el agente (chat de texto, voz y llamada).

import { useState } from 'react'
import type { Professional } from '@/types'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { ProfessionalCard } from './ProfessionalCard'

// ── Profesionales encontrados en una respuesta ───────
// Se muestran primero los conectados AHORA (pueden atender ya). Los que no están
// conectados quedan plegados detrás de un botón: siguen disponibles para agendar
// una cita, pero no estorban. Si no hay ninguno conectado se muestran directamente,
// con una nota, para no dejar al paciente sin opciones.
export function ProfessionalsBlock({
  pros, onConsult, loading, stale,
}: {
  pros: Professional[]
  onConsult: (pro: Professional) => void
  loading: boolean
  stale: boolean   // true = es de una búsqueda anterior: se pliega para no alargar el chat
}) {
  const { t } = useLanguage()
  const active = pros.filter((p) => p.availability === 'ONLINE_NOW')
  const inactive = pros.filter((p) => p.availability !== 'ONLINE_NOW')
  const [showInactive, setShowInactive] = useState(active.length === 0)
  const [showStale, setShowStale] = useState(false)

  const card = (pro: Professional) => (
    <ProfessionalCard key={pro.id} professional={pro} onConsult={onConsult} loading={loading} />
  )

  if (stale && !showStale) {
    return (
      <button
        onClick={() => setShowStale(true)}
        className="w-full px-3 py-2 text-xs text-[#475569] border border-dashed border-[#C9CEDD] rounded-lg hover:bg-white transition-colors"
      >
        {t('Mostrar de nuevo los profesionales de esa búsqueda')} ({pros.length})
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#475569] font-medium">
        {active.length > 0
          ? t('Profesionales conectados ahora:')
          : t('Ningún profesional está conectado en este momento. Puedes agendar una cita con:')}
      </p>

      {active.map(card)}

      {active.length > 0 && inactive.length > 0 && (
        <button
          onClick={() => setShowInactive((v) => !v)}
          aria-expanded={showInactive}
          className="w-full px-3 py-2 text-xs font-medium text-[#185FA5] border border-dashed border-[#185FA5]/40 rounded-lg hover:bg-[#E6F1FB] transition-colors"
        >
          {showInactive
            ? t('Ocultar profesionales no conectados')
            : `${t('Ver profesionales no conectados')} (${inactive.length}) · ${t('puedes agendar una cita')}`}
        </button>
      )}

      {showInactive && inactive.length > 0 && (
        <>
          {active.length > 0 && (
            <p className="text-xs text-[#475569] font-medium">{t('No conectados ahora — puedes agendar una cita:')}</p>
          )}
          {inactive.map(card)}
        </>
      )}
    </div>
  )
}
