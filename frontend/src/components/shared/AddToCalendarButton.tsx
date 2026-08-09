'use client'
// src/components/shared/AddToCalendarButton.tsx
// Botón "Agregar a calendario" para citas agendadas (SCHEDULED / FOLLOW_UP).
// Da dos opciones: descargar el .ics (funciona con cualquier app de
// calendario) o abrir directo en Google Calendar (más cómodo en celular).

import { useState, useRef, useEffect } from 'react'
import { downloadICS, googleCalendarUrl, type CalendarEventInput } from '@/lib/calendarExport'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export function AddToCalendarButton({ event }: { event: CalendarEventInput }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#185FA5] border border-[#185FA5] px-2.5 py-1 rounded-full hover:bg-[#E6F1FB] transition-colors"
      >
        📅 {t('Agregar a calendario')}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 bg-white border border-[#DDE1EE] rounded-lg shadow-lg overflow-hidden min-w-[190px]">
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-xs text-[#141820] hover:bg-[#F5F6FA] transition-colors"
          >
            {t('Google Calendar')}
          </a>
          <button
            type="button"
            onClick={() => { downloadICS(event); setOpen(false) }}
            className="block w-full text-left px-3 py-2 text-xs text-[#141820] hover:bg-[#F5F6FA] transition-colors border-t border-[#EEF0F6]"
          >
            {t('Descargar .ics (Apple / Outlook / otro)')}
          </button>
        </div>
      )}
    </div>
  )
}
