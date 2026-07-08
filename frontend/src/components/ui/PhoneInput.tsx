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

import { useState, useEffect } from 'react'
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE } from '@/lib/countryCodes'

interface PhoneInputProps {
  value: string
  onChange: (fullPhoneDigits: string) => void
  required?: boolean
  placeholder?: string
}

export function PhoneInput({ value, onChange, required, placeholder = '72345678' }: PhoneInputProps) {
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE)
  const [localNumber, setLocalNumber] = useState('')

  // Si el padre resetea `value` a '' (ej. al limpiar el formulario), este
  // componente también se resetea a su estado inicial en vez de quedar
  // con un localNumber viejo "fantasma" que ya no coincide con lo que
  // ve la persona en pantalla.
  useEffect(() => {
    if (value === '') {
      setLocalNumber('')
    }
  }, [value])

  function emitChange(nextCountryCode: string, nextLocalNumber: string) {
    const digitsOnly = nextLocalNumber.replace(/\D/g, '')
    onChange(digitsOnly ? `${nextCountryCode}${digitsOnly}` : '')
  }

  function handleCountryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCountryCode(e.target.value)
    emitChange(e.target.value, localNumber)
  }

  function handleNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalNumber(e.target.value)
    emitChange(countryCode, e.target.value)
  }

  return (
    <div className="flex gap-2">
      <select
        value={countryCode}
        onChange={handleCountryChange}
        className="input w-[104px] flex-shrink-0"
        aria-label="Código de país"
      >
        {COUNTRY_CODES.map((c) => (
          // El `code` (código de marcado) no es único por sí solo —
          // varios países comparten el mismo código (+1 para EEUU,
          // Canadá, República Dominicana, Puerto Rico) — así que la key
          // de React combina code+iso aunque el `value` siga siendo
          // solo el código (es lo único que le importa al backend).
          //
          // Se muestra bandera + iniciales ISO (ej. "🇧🇴 BO +591") en vez
          // del nombre completo del país: así el selector queda angosto
          // y prolijo, como en la mayoría de los sitios (Stripe, WhatsApp,
          // etc.), sin cortar texto ni empujar el input de al lado.
          <option key={`${c.code}-${c.iso}`} value={c.code} title={c.name}>
            {c.flag} {c.iso} +{c.code}
          </option>
        ))}
      </select>
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
