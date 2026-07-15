'use client'
// ── SpanishDateTimePicker: calendario en español (lunes primero) + hora ──────
// Reemplaza <input type="datetime-local"> porque su selector nativo usa el
// idioma/orden de días del sistema operativo del navegador (en Chrome suele
// salir en inglés con domingo primero) y eso NO se puede forzar a español ni
// a "lunes primero" desde CSS/JS. Este componente sí lo controlamos.
//
// Devuelve el valor en el mismo formato "YYYY-MM-DDTHH:MM" que el input nativo
// producía, así que es un reemplazo directo en cualquier lugar que lo use.

import { useState } from 'react'

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const DIAS_ES  = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'] // lunes primero

export function SpanishDateTimePicker({
  value,
  onChange,
  onOpenChange,
}: {
  value: string
  onChange: (v: string) => void
  /** Se llama cuando se abre/cierra el desplegable del calendario — útil
   * para que el contenedor padre reserve espacio o permita scroll y así
   * el desplegable no tape botones que estén justo debajo. */
  onOpenChange?: (open: boolean) => void
}) {
  const now = new Date()
  const [open, setOpenRaw] = useState(false)
  function setOpen(v: boolean | ((prev: boolean) => boolean)) {
    setOpenRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      onOpenChange?.(next)
      return next
    })
  }
  const initial = value ? new Date(value) : now
  const [viewYear, setViewYear]   = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  const [datePart, timePart] = value ? value.split('T') : ['', '']

  const firstDay = new Date(viewYear, viewMonth, 1)
  // getDay(): 0=Domingo..6=Sábado → convertir a índice lunes-primero (0=Lunes..6=Domingo)
  const leadingBlanks = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  function pad(n: number) { return String(n).padStart(2, '0') }

  function pickDay(day: number) {
    const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`
    onChange(`${iso}T${timePart || '09:00'}`)
  }

  function setTime(hhmm: string) {
    const iso = datePart || `${viewYear}-${pad(viewMonth + 1)}-${pad(now.getDate())}`
    onChange(`${iso}T${hhmm}`)
  }

  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  function isPastDay(day: number) {
    return new Date(viewYear, viewMonth, day) < todayMidnight
  }

  const selectedDay = datePart && Number(datePart.split('-')[0]) === viewYear && Number(datePart.split('-')[1]) - 1 === viewMonth
    ? Number(datePart.split('-')[2])
    : null

  // No permitir retroceder a un mes ya pasado por completo
  const canGoPrevMonth = new Date(viewYear, viewMonth, 1) > new Date(now.getFullYear(), now.getMonth(), 1)

  const displayLabel = value
    ? new Date(value).toLocaleDateString('es-BO', { day: 'numeric', month: 'short' }) + ' · ' + (timePart || '')
    : 'Elegir fecha y hora'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="px-2 py-1 border border-[#DDE1EE] rounded-lg text-xs bg-white"
      >
        {displayLabel}
      </button>

      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-[#DDE1EE] rounded-xl shadow-lg p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              disabled={!canGoPrevMonth}
              onClick={() => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
              className="text-xs px-2 py-1 text-[#6B738A] hover:text-[#185FA5] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-[#6B738A]"
            >‹</button>
            <span className="text-xs font-semibold capitalize">{MESES_ES[viewMonth]} {viewYear}</span>
            <button type="button" onClick={() => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }} className="text-xs px-2 py-1 text-[#6B738A] hover:text-[#185FA5]">›</button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {DIAS_ES.map(d => (
              <div key={d} className="text-[10px] text-center text-[#A0A8BF] font-medium">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const disabled = isPastDay(day)
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => !disabled && pickDay(day)}
                  className={`text-xs rounded-full py-1 ${
                    disabled
                      ? 'text-[#DDE1EE] cursor-not-allowed'
                      : selectedDay === day ? 'bg-[#185FA5] text-white' : 'hover:bg-[#F5F6FA] text-[#141820]'
                  }`}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-[#6B738A]">Hora:</label>
            <input
              type="time"
              value={timePart || ''}
              min={datePart === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : undefined}
              onChange={(e) => setTime(e.target.value)}
              className="px-2 py-1 border border-[#DDE1EE] rounded-lg text-xs flex-1"
            />
          </div>

          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#185FA5] font-medium">
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SpanishDatePicker: mismo calendario en español (lunes primero), pero solo
// fecha (sin hora). Reemplaza <input type="date">, cuyo selector nativo del
// navegador sale en el idioma/orden del sistema operativo (en Chrome suele
// salir en inglés con domingo primero) y no se puede forzar desde CSS/JS. ──
export function SpanishDatePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(value.getFullYear())
  const [viewMonth, setViewMonth] = useState(value.getMonth())

  function openPicker() {
    setViewYear(value.getFullYear())
    setViewMonth(value.getMonth())
    setOpen(true)
  }

  const firstDay = new Date(viewYear, viewMonth, 1)
  const leadingBlanks = (firstDay.getDay() + 6) % 7 // lunes primero
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const selectedDay =
    value.getFullYear() === viewYear && value.getMonth() === viewMonth ? value.getDate() : null

  function pickDay(day: number) {
    onChange(new Date(viewYear, viewMonth, day))
    setOpen(false)
  }

  const displayLabel = `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="text-xs border border-[#DDE1EE] rounded-lg px-2 py-1 text-[#6B738A] bg-white hover:bg-[#F4F6FB]"
        aria-label="Ir a una fecha"
      >
        🗓 {displayLabel}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full right-0 mt-1 bg-white border border-[#DDE1EE] rounded-xl shadow-lg p-3 w-64">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
                className="text-xs px-2 py-1 text-[#6B738A] hover:text-[#185FA5]"
              >‹</button>
              <span className="text-xs font-semibold capitalize">{MESES_ES[viewMonth]} {viewYear}</span>
              <button
                type="button"
                onClick={() => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
                className="text-xs px-2 py-1 text-[#6B738A] hover:text-[#185FA5]"
              >›</button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {DIAS_ES.map((d) => (
                <div key={d} className="text-[10px] text-center text-[#A0A8BF] font-medium">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  className={`text-xs rounded-full py-1 ${
                    selectedDay === day ? 'bg-[#185FA5] text-white' : 'hover:bg-[#F5F6FA] text-[#141820]'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>

            <div className="mt-2 flex justify-between">
              <button type="button" onClick={() => { onChange(new Date()); setOpen(false) }} className="text-xs text-[#185FA5] font-medium">
                Hoy
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#6B738A]">
                Cerrar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}