'use client'
// src/components/shared/LanguageSwitcher.tsx
//
// Selector de idioma para la barra superior. Cambia solo el texto visible
// de la interfaz (ver LanguageContext) — no traduce datos médicos ni de
// base de datos. Pensado para dos variantes de fondo:
//   - "light": barra blanca (landing pública)
//   - "dark": barra con degradado azul/verde (panel de paciente)

import { useState, useRef, useEffect } from 'react'
import { useLanguage, LANGUAGES } from '@/lib/i18n/LanguageContext'
import { Globe } from 'lucide-react'

export function LanguageSwitcher({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const { lang, setLang } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]

  const triggerClass =
    variant === 'dark'
      ? 'flex items-center gap-1.5 text-xs sm:text-sm font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/15 px-2.5 py-1.5 rounded-lg transition-colors'
      : 'flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#6B738A] hover:text-[#141820] border border-[#DDE1EE] hover:bg-[#F5F6FA] px-2.5 py-1.5 rounded-lg transition-colors'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={triggerClass}
        aria-label="Cambiar idioma / Simiyta tikray"
        aria-expanded={open}
      >
        <Globe className="w-4 h-4" />
        <span>{current.nativeLabel}</span>
        <span className={`transition-transform text-[10px] ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 bg-white border border-[#DDE1EE] rounded-xl shadow-lg overflow-hidden z-50">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code)
                setOpen(false)
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm text-left transition-colors ${
                l.code === lang
                  ? 'bg-[#E7F8EF] text-[#0F6E56] font-medium'
                  : 'text-[#141820] hover:bg-[#F5F6FA]'
              }`}
            >
              <span>{l.nativeLabel}</span>
              {l.code !== 'es' && (
                <span className="text-[10px] text-[#6B738A] font-normal">{l.label}</span>
              )}
            </button>
          ))}
          <div className="px-3.5 py-2 border-t border-[#DDE1EE] bg-[#F5F6FA]">
            <p className="text-[10px] text-[#6B738A] leading-snug">
              Traducción visual en revisión, aún no validada por hablantes nativos.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
