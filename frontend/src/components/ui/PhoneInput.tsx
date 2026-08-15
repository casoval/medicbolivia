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

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  const [mounted, setMounted] = useState(false)
  // Posición del dropdown en coordenadas de VIEWPORT (position: fixed),
  // recalculada cada vez que se abre. Se pinta vía portal a document.body
  // — ver comentario grande más abajo sobre por qué hace falta esto.
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 224 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLUListElement>(null)

  const selected: CountryCode =
    COUNTRY_CODES.find((c) => c.code === countryCode) ?? COUNTRY_CODES[0]

  // createPortal no puede correr en el server (necesita document.body) —
  // se habilita recién después del primer render en el cliente.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Si el padre resetea `value` a '' (ej. al limpiar el formulario), este
  // componente también se resetea a su estado inicial en vez de quedar
  // con un localNumber viejo "fantasma" que ya no coincide con lo que
  // ve la persona en pantalla.
  useEffect(() => {
    if (value === '') {
      setLocalNumber('')
    }
  }, [value])

  const updateDropdownPos = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: 224 })
  }, [])

  // Recalcula la posición justo antes de pintar el dropdown, para que no
  // haya un frame donde se vea en (0,0) y "salte" a su lugar.
  useLayoutEffect(() => {
    if (open) updateDropdownPos()
  }, [open, updateDropdownPos])

  // Cerrar el dropdown al hacer click afuera. Como el <ul> ahora vive en
  // un portal (fuera del DOM de wrapperRef), hay que chequear también
  // dropdownRef — si no, cualquier click DENTRO de la lista se
  // interpretaría como "afuera" y la cerraría antes de que el onClick
  // de la opción llegue a dispararse.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      const insideButton = wrapperRef.current?.contains(target)
      const insideDropdown = dropdownRef.current?.contains(target)
      if (!insideButton && !insideDropdown) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Si la página hace scroll o cambia de tamaño mientras el dropdown está
  // abierto, lo más simple y predecible es cerrarlo (en vez de perseguir
  // al botón recalculando en cada evento) — mismo criterio que ya usan la
  // mayoría de los selects nativos.
  useEffect(() => {
    if (!open) return
    function closeOnScrollOrResize() {
      setOpen(false)
    }
    window.addEventListener('scroll', closeOnScrollOrResize, true)
    window.addEventListener('resize', closeOnScrollOrResize)
    return () => {
      window.removeEventListener('scroll', closeOnScrollOrResize, true)
      window.removeEventListener('resize', closeOnScrollOrResize)
    }
  }, [open])

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
          ref={buttonRef}
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

        {/*
          El dropdown se pinta con un PORTAL a document.body, en vez de
          quedar anidado en el DOM acá adentro. Motivo (bug real visto en
          producción): esta sección envuelve cada campo del formulario en
          su propio <Reveal>, que anima con `translate-y-*` — y CUALQUIER
          transform distinto de `none` (incluido translate(0,0) ya
          asentado) crea un stacking context nuevo. Eso encierra este
          z-20 dentro de la burbuja del Reveal de "Teléfono", así que no
          puede ganarle a los Reveal de "Correo" y "Tipo de consulta"
          (que vienen después en el DOM y se pintan encima como bloques
          completos) por más z-index que tenga puertas adentro. Con el
          portal, el <ul> vive directo en <body>, fuera de esa jerarquía,
          y position:fixed + coordenadas calculadas con
          getBoundingClientRect() lo ubican pegado al botón igual que
          antes — pero ya sin quedar atrapado.
        */}
        {open && mounted && createPortal(
          <ul
            ref={dropdownRef}
            role="listbox"
            className="fixed z-50 max-h-64 overflow-auto rounded-lg border border-blue-100 bg-white py-1 shadow-lg"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
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
          </ul>,
          document.body
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
