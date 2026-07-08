'use client'
// src/components/ui/PhoneInput.tsx
//
// Input de teléfono con selector de código de país. Bolivia (+591) viene
// preseleccionada por default, pero permite elegir otro país para
// registros desde el exterior.
//
// El valor que expone hacia afuera (onChange) es SIEMPRE el string ya
// concatenado "código_país + número_local", solo dígitos, sin '+' ni
// espacios — el mismo formato canónico que espera el backend
// (ver backend/app/core/phone.py::normalize_intl_phone). El componente
// es "tonto" respecto a ese formato: no valida longitud por país, eso
// queda del lado del backend.

import { useState, useEffect, useRef } from 'react'
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE, type CountryCode } from '@/lib/countryCodes'

interface PhoneInputProps {
  value: string
  onChange: (fullPhoneDigits: string) => void
  required?: boolean
  placeholder?: string
}

// Bandera como imagen real (flagcdn.com, PNG por código ISO) en vez de
// emoji. Un <select> nativo no puede mostrar <img> dentro de <option>
// (solo texto), y el emoji de bandera no tiene glifo en Windows —
// Segoe UI Emoji cae a un fallback de texto con las letras ISO, lo que
// duplicaba "BO BO +591". La imagen se ve igual en cualquier SO.
function FlagImg({ iso, name }: { iso: string; name: string }) {
  return (
    <img
      src={`https://flagcdn.com/24x18/${iso.toLowerCase()}.png`}
      srcSet={`https://flagcdn.com/48x36/${iso.toLowerCase()}.png 2x`}
      width={20}
      height={15}
      alt=""
      title={name}
      className="inline-block rounded-[2px] flex-shrink-0"
      // Si flagcdn no carga (offline, bloqueado, etc.), no dejamos un
      // ícono roto: colapsamos la imagen y el ISO/código de al lado
      // alcanzan para identificar el país.
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

export function PhoneInput({ value, onChange, required, placeholder = '72345678' }: PhoneInputProps) {
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE)
  const [localNumber, setLocalNumber] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const selected: CountryCode =
    COUNTRY_CODES.find((c) => c.code === countryCode) ?? COUNTRY_CODES[0]

  // Si el padre resetea `value` a '' (ej. al limpiar el formulario), este
  // componente también se resetea a su estado inicial en vez de quedar
  // con un localNumber viejo "fantasma" que ya no coincide con lo que
  // ve la persona en pantalla.
  useEffect(() => {
    if (value === '') {
      setLocalNumber('')
    }
  }, [value])

  // Cerrar el dropdown al hacer click afuera.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function emitChange(nextCountryCode: string, nextLocalNumber: string) {
    const digitsOnly = nextLocalNumber.replace(/\D/g, '')
    onChange(digitsOnly ? `${nextCountryCode}${digitsOnly}` : '')
  }

  function handleSelectCountry(c: CountryCode) {
    setCountryCode(c.code)
    setOpen(false)
    emitChange(c.code, localNumber)
  }

  function handleNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalNumber(e.target.value)
    emitChange(countryCode, e.target.value)
  }

  return (
    <div className="flex gap-2">
      <div className="relative" ref={wrapperRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="input w-[104px] flex-shrink-0 flex items-center gap-1.5 cursor-pointer"
          aria-label="Código de país"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <FlagImg iso={selected.iso} name={selected.name} />
          <span className="text-sm">+{selected.code}</span>
          <svg
            className={`ml-auto h-3.5 w-3.5 text-blue-900/50 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-56 overflow-auto rounded-lg border border-blue-100 bg-white py-1 shadow-lg"
          >
            {COUNTRY_CODES.map((c) => (
              // El `code` (código de marcado) no es único por sí solo —
              // varios países comparten el mismo código (+1 para EEUU,
              // Canadá, República Dominicana, Puerto Rico) — así que la
              // key de React combina code+iso.
              <li key={`${c.code}-${c.iso}`} role="option" aria-selected={c.code === countryCode}>
                <button
                  type="button"
                  onClick={() => handleSelectCountry(c)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-blue-50 ${
                    c.code === countryCode ? 'bg-blue-50 font-medium' : ''
                  }`}
                >
                  <FlagImg iso={c.iso} name={c.name} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-blue-900/50">+{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        type="tel"
        className="input flex-1 min-w-0"
        placeholder={placeholder}
        value={localNumber}
        onChange={handleNumberChange}
        required={required}
      />
    </div>
  )
}
