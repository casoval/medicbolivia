'use client'
// src/lib/i18n/LanguageContext.tsx
//
// Traducción SOLO VISUAL de la interfaz — no toca lógica de negocio, no
// traduce datos de la base (nombres, especialidades, contenido clínico),
// no persiste nada en el backend. Es puramente cosmético: cambia el texto
// que se ve, en el navegador de quien lo usa.
//
// Alcance: toda la app (landing, login, registro, panel de paciente,
// panel de profesional, panel de admin, verificar receta, mantenimiento).
//
// Cobertura: el diccionario tiene ~1340 términos únicos, extraídos
// directamente del código fuente y traducidos (hoja "MedicBolivia_
// Traduccion_Unificada"). Todo lo que no está en el diccionario
// simplemente se muestra en español.
//
// IMPORTANTE — estas traducciones siguen siendo un borrador: no están
// validadas todavía por hablantes nativos ni por instituciones como el
// ILC (Instituto de Lengua y Cultura, Bolivia).

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import dictionary from './dictionary.json'

export type LanguageCode = 'es' | 'qu' | 'ay' | 'gn'

export const LANGUAGES: { code: LanguageCode; label: string; nativeLabel: string }[] = [
  { code: 'es', label: 'Español', nativeLabel: 'Español' },
  { code: 'qu', label: 'Quechua', nativeLabel: 'Runasimi' },
  { code: 'ay', label: 'Aymara', nativeLabel: 'Aymar aru' },
  { code: 'gn', label: 'Guaraní', nativeLabel: "Avañe'ẽ" },
]

type Dictionary = Record<string, { qu: string | null; ay: string | null; gn: string | null }>
const DICT = dictionary as Dictionary

const STORAGE_KEY = 'medicbolivia_lang'

interface LanguageContextValue {
  lang: LanguageCode
  setLang: (lang: LanguageCode) => void
  t: (es: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>('es')

  // Carga la preferencia guardada del navegador (solo visual, no hay
  // sincronización con el backend ni con la cuenta del usuario).
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as LanguageCode | null
    if (saved && LANGUAGES.some((l) => l.code === saved)) {
      setLangState(saved)
    }
  }, [])

  function setLang(next: LanguageCode) {
    setLangState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  function t(es: string): string {
    if (lang === 'es') return es
    const entry = DICT[es]
    if (!entry) return es // sin traducción registrada -> se queda en español
    const translated = entry[lang]
    return translated || es
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error('useLanguage debe usarse dentro de <LanguageProvider>')
  }
  return ctx
}