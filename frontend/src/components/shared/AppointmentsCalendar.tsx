'use client'
// src/components/shared/AppointmentsCalendar.tsx
//
// Calendario de citas agendadas, compartido entre
// /professional/appointments y /patient/history.
//
// 4 vistas, como un calendario de consultorio clásico:
//   - Agenda: tabla del día seleccionado (Consulta · Paciente/Profesional · Estado)
//   - Día:    grilla horaria de un solo día
//   - Semana: grilla horaria de 7 días (en móvil se comprime a tira de días + 1 columna)
//   - Mes:    grilla mensual clásica (en móvil se comprime a lista tipo agenda)
//
// El color de cada cita sigue el mismo código que StatusBadge (components/ui/index.tsx)
// para no introducir una convención visual nueva en la app.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { StatusBadge } from '@/components/ui'
import { fmtFechaHoraLocal } from '@/lib/consultationHistory'
import type { Consultation, ConsultationStatus } from '@/types'

// ─────────────────────────────────────────────────────
// Colores por estado
// ─────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  COMPLETED: 'bg-[#0F6E56]',
  IN_PROGRESS: 'bg-[#185FA5]',
  PAYMENT_CONFIRMED: 'bg-[#185FA5]',
  WAITING_PROFESSIONAL: 'bg-[#185FA5]',
  PROFESSIONAL_ACCEPTED: 'bg-[#185FA5]',
  AGENT_TRIAGING: 'bg-[#185FA5]',
  WAITING_PAYMENT: 'bg-[#854F0B]',
  CANCELLED: 'bg-[#6B738A]',
  REFUNDED: 'bg-[#6B738A]',
}
const STATUS_CHIP_BG: Record<string, string> = {
  COMPLETED: 'bg-[#E1F5EE] border-[#9FE1CB] text-[#0F6E56]',
  IN_PROGRESS: 'bg-[#E6F1FB] border-[#85B7EB] text-[#185FA5]',
  PAYMENT_CONFIRMED: 'bg-[#E6F1FB] border-[#85B7EB] text-[#185FA5]',
  WAITING_PROFESSIONAL: 'bg-[#E6F1FB] border-[#85B7EB] text-[#185FA5]',
  PROFESSIONAL_ACCEPTED: 'bg-[#E6F1FB] border-[#85B7EB] text-[#185FA5]',
  AGENT_TRIAGING: 'bg-[#E6F1FB] border-[#85B7EB] text-[#185FA5]',
  WAITING_PAYMENT: 'bg-[#FAEEDA] border-[#FAC775] text-[#854F0B]',
  CANCELLED: 'bg-[#ECEEF5] border-[#DDE1EE] text-[#6B738A]',
  REFUNDED: 'bg-[#ECEEF5] border-[#DDE1EE] text-[#6B738A]',
}
function dotClass(status: string) {
  return STATUS_DOT[status] || 'bg-[#6B738A]'
}
function chipClass(status: string) {
  return STATUS_CHIP_BG[status] || 'bg-[#ECEEF5] border-[#DDE1EE] text-[#6B738A]'
}
function isCancelledStatus(status: string) {
  return status === 'CANCELLED' || status === 'REFUNDED'
}

const LEGEND: { status: ConsultationStatus; label: string }[] = [
  { status: 'PROFESSIONAL_ACCEPTED', label: 'Confirmada' },
  { status: 'WAITING_PAYMENT', label: 'Pendiente de pago' },
  { status: 'COMPLETED', label: 'Completada' },
  { status: 'CANCELLED', label: 'Cancelada / reembolsada' },
]

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const WEEKDAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// scheduled_at viene del backend como hora Bolivia "naive" (sin 'Z'),
// se parsea tal cual, sin conversión de zona horaria.
function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function timeOf(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-BO', { hour: 'numeric', minute: '2-digit' })
}
function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function startOfWeek(d: Date) {
  const offset = (d.getDay() + 6) % 7 // lunes = 0
  return addDays(d, -offset)
}
function toInputDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fromInputDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function fmtLongDate(d: Date) {
  return `${d.getDate()} de ${MONTHS[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`
}

// Duración estimada del bloque en la grilla horaria. Usa la duración que el
// propio profesional configuró en /professional/schedule
// (Professional.appointment_duration_minutes, viaja en cada Consultation
// como professional_appointment_duration_minutes). Si por alguna razón no
// viene (profesional sin configurar aún, datos legacy), cae a 30 min —
// mismo valor por defecto que usa el backend al validar solapes de horario.
const DEFAULT_SLOT_MIN = 30
function plannedDuration(c: Consultation) {
  return c.professional_appointment_duration_minutes || DEFAULT_SLOT_MIN
}

// Rango horario visible en las vistas Día/Semana.
const DAY_START_HOUR = 7
const DAY_END_HOUR = 20
const ROW_PX = 22 // px por cada 15 minutos
const HOUR_PX = ROW_PX * 4

type ViewMode = 'agenda' | 'day' | 'week' | 'month'

interface Props {
  consultations: Consultation[]
  role: 'PATIENT' | 'PROFESSIONAL'
  /** Si se pasa, la celda/chip llama a esto en vez de abrir el panel de detalle interno. */
  onSelectConsultation?: (c: Consultation) => void
}

export function AppointmentsCalendar({ consultations, role, onSelectConsultation }: Props) {
  const [view, setView] = useState<ViewMode>('agenda')
  const [cursor, setCursor] = useState(() => new Date())
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [detail, setDetail] = useState<Consultation | null>(null)

  const today = new Date()

  // Solo citas agendadas (no consultas inmediatas) con fecha asignada.
  const scheduled = useMemo(() => {
    const base = consultations.filter(
      (c) => (c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP') && !!c.scheduled_at
    )
    return includeCancelled ? base : base.filter((c) => !isCancelledStatus(c.status))
  }, [consultations, includeCancelled])

  const byDay = useMemo(() => {
    const map = new Map<string, Consultation[]>()
    for (const c of scheduled) {
      const key = dayKey(c.scheduled_at as string)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
    }
    return map
  }, [scheduled])

  function apptsOn(d: Date) {
    return byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || []
  }

  function openDetail(c: Consultation) {
    if (onSelectConsultation) onSelectConsultation(c)
    else setDetail(c)
  }

  function nameOf(c: Consultation) {
    if (role === 'PATIENT') {
      return c.professional_first_name
        ? `Dr(a). ${c.professional_first_name} ${c.professional_last_name || ''}`.trim()
        : 'Profesional'
    }
    return c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : 'Paciente'
  }

  function typeLabel(c: Consultation) {
    return c.consultation_type === 'FOLLOW_UP' ? 'Reconsulta' : 'Cita agendada'
  }

  // ── Navegación ──
  function goPrev() {
    if (view === 'month') setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    else if (view === 'week') setCursor((d) => addDays(d, -7))
    else setCursor((d) => addDays(d, -1))
  }
  function goNext() {
    if (view === 'month') setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    else if (view === 'week') setCursor((d) => addDays(d, 7))
    else setCursor((d) => addDays(d, 1))
  }
  function goToday() {
    setCursor(new Date())
  }

  const headerLabel =
    view === 'month'
      ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
      : view === 'week'
      ? (() => {
          const s = startOfWeek(cursor)
          const e = addDays(s, 6)
          return `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)}. – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)}. ${e.getFullYear()}`
        })()
      : fmtLongDate(cursor)

  return (
    <div>
      {/* Tabs de vista */}
      <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-3 w-fit overflow-x-auto max-w-full">
        {(['agenda', 'day', 'week', 'month'] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              view === v ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
            }`}
          >
            {v === 'agenda' ? 'Agenda' : v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}
          </button>
        ))}
      </div>

      {/* Navegación de fecha + filtro */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="px-2.5 py-1 rounded-lg border border-[#DDE1EE] text-xs font-medium text-[#141820] hover:bg-[#F4F6FB]"
          >
            Hoy
          </button>
          <button
            onClick={goPrev}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#DDE1EE] text-[#6B738A] hover:bg-[#F4F6FB]"
            aria-label="Anterior"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-[#141820] min-w-[9rem] text-center">{headerLabel}</span>
          <button
            onClick={goNext}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#DDE1EE] text-[#6B738A] hover:bg-[#F4F6FB]"
            aria-label="Siguiente"
          >
            ›
          </button>
          <input
            type="date"
            value={toInputDate(cursor)}
            onChange={(e) => e.target.value && setCursor(fromInputDate(e.target.value))}
            className="ml-1 text-xs border border-[#DDE1EE] rounded-lg px-1.5 py-1 text-[#6B738A]"
            aria-label="Ir a una fecha"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[#6B738A]">
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            className="rounded border-[#DDE1EE]"
          />
          Incluir citas canceladas
        </label>
      </div>

      {/* Leyenda de colores */}
      <div className="flex flex-wrap gap-3 mb-4">
        {LEGEND.map((l) => (
          <div key={l.status} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dotClass(l.status)}`} />
            <span className="text-xs text-[#6B738A]">{l.label}</span>
          </div>
        ))}
      </div>

      {view === 'agenda' && (
        <AgendaView day={cursor} appts={apptsOn(cursor)} role={role} nameOf={nameOf} typeLabel={typeLabel} onSelect={openDetail} />
      )}

      {view === 'day' && (
        <DayGrid day={cursor} appts={apptsOn(cursor)} isToday={sameDay(cursor, today)} nameOf={nameOf} onSelect={openDetail} />
      )}

      {view === 'week' && (
        <WeekView cursor={cursor} today={today} apptsOn={apptsOn} nameOf={nameOf} onSelect={openDetail} />
      )}

      {view === 'month' && (
        <MonthView cursor={cursor} today={today} byDay={byDay} nameOf={nameOf} onSelect={openDetail} />
      )}

      {/* Panel de detalle interno (solo si el padre no maneja su propio detalle) */}
      {detail &&
        !onSelectConsultation &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4"
            onClick={() => setDetail(null)}
          >
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#141820]">Detalle de la cita</h3>
                <StatusBadge status={detail.status} />
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-[#4A5169]">
                <p>
                  <span className="font-medium text-[#141820]">{role === 'PATIENT' ? 'Profesional: ' : 'Paciente: '}</span>
                  {nameOf(detail)}
                </p>
                <p>
                  <span className="font-medium text-[#141820]">Fecha y hora: </span>
                  {fmtFechaHoraLocal(detail.scheduled_at)}
                </p>
                <p>
                  <span className="font-medium text-[#141820]">Tipo: </span>
                  {typeLabel(detail)}
                </p>
                {detail.specialty && (
                  <p>
                    <span className="font-medium text-[#141820]">Especialidad: </span>
                    {detail.specialty}
                  </p>
                )}
                {detail.chief_complaint && (
                  <p>
                    <span className="font-medium text-[#141820]">Motivo: </span>
                    {detail.chief_complaint}
                  </p>
                )}
              </div>
              <button
                onClick={() => setDetail(null)}
                className="mt-4 w-full text-xs font-medium text-[#185FA5] border border-[#DDE1EE] rounded-lg py-2 hover:bg-[#F4F6FB]"
              >
                Cerrar
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Vista Agenda: tabla del día seleccionado
// ─────────────────────────────────────────────────────
function AgendaView({
  day,
  appts,
  role,
  nameOf,
  typeLabel,
  onSelect,
}: {
  day: Date
  appts: Consultation[]
  role: 'PATIENT' | 'PROFESSIONAL'
  nameOf: (c: Consultation) => string
  typeLabel: (c: Consultation) => string
  onSelect: (c: Consultation) => void
}) {
  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
      <div className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[110px_1fr_140px] bg-[#F5F6FA] text-[11px] font-semibold text-[#6B738A] uppercase px-3 py-2 gap-2">
        <span>Hora</span>
        <span>{role === 'PATIENT' ? 'Profesional' : 'Paciente'}</span>
        <span className="text-right sm:text-left">Estado</span>
      </div>
      {appts.length === 0 ? (
        <div className="flex items-center gap-3 px-3 py-6">
          <span className="w-9 h-9 rounded-full bg-[#F5F6FA] text-[#6B738A] text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {day.getDate()}
          </span>
          <p className="text-xs text-[#6B738A]">
            No hay citas registradas para el {WEEKDAYS_LONG[(day.getDay() + 6) % 7]} {day.getDate()} de{' '}
            {MONTHS[day.getMonth()].toLowerCase()}.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#ECEEF5]">
          {appts.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="w-full grid grid-cols-[auto_1fr_auto] sm:grid-cols-[110px_1fr_140px] items-center gap-2 px-3 py-2.5 text-left hover:bg-[#F9FAFC]"
            >
              <span className="text-xs font-medium text-[#141820]">{timeOf(c.scheduled_at as string)}</span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#141820] truncate">{nameOf(c)}</span>
                <span className="block text-[11px] text-[#A0A8BF] truncate">{typeLabel(c)}</span>
              </span>
              <span className="justify-self-end sm:justify-self-start">
                <StatusBadge status={c.status} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Grilla horaria (usada por Día y por cada columna de Semana)
// ─────────────────────────────────────────────────────
function hourLabels() {
  const labels: string[] = []
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) {
    labels.push(`${String(h).padStart(2, '0')}:00`)
  }
  return labels
}

// Calcula columna/ancho para citas superpuestas en un mismo día.
function layoutOverlaps(appts: Consultation[]): { c: Consultation; col: number; cols: number }[] {
  const items = appts
    .map((c) => {
      const start = new Date(c.scheduled_at as string)
      const startMin = start.getHours() * 60 + start.getMinutes()
      return { c, startMin, endMin: startMin + plannedDuration(c) }
    })
    .sort((a, b) => a.startMin - b.startMin)

  const active: { endMin: number; col: number }[] = []
  let cluster: { c: Consultation; col: number }[] = []
  let clusterMaxCols = 0
  const results: { c: Consultation; col: number; cols: number }[] = []

  function flushCluster() {
    for (const p of cluster) results.push({ c: p.c, col: p.col, cols: clusterMaxCols })
    cluster = []
    clusterMaxCols = 0
  }

  for (const item of items) {
    // Libera columnas de citas que ya terminaron antes de que empiece esta.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMin <= item.startMin) active.splice(i, 1)
    }
    if (active.length === 0 && cluster.length > 0) flushCluster()

    let col = 0
    const usedCols = new Set(active.map((a) => a.col))
    while (usedCols.has(col)) col++
    active.push({ endMin: item.endMin, col })
    clusterMaxCols = Math.max(clusterMaxCols, active.length)
    cluster.push({ c: item.c, col })
  }
  flushCluster()
  return results
}

function DayGrid({
  day,
  appts,
  isToday,
  nameOf,
  onSelect,
  compact,
}: {
  day: Date
  appts: Consultation[]
  isToday: boolean
  nameOf: (c: Consultation) => string
  onSelect: (c: Consultation) => void
  compact?: boolean
}) {
  const labels = hourLabels()
  const totalMin = (DAY_END_HOUR - DAY_START_HOUR) * 60
  const gridHeight = (totalMin / 15) * ROW_PX
  const layout = layoutOverlaps(appts)
  const now = new Date()
  const nowOffset =
    isToday && now.getHours() >= DAY_START_HOUR && now.getHours() <= DAY_END_HOUR
      ? ((now.getHours() * 60 + now.getMinutes() - DAY_START_HOUR * 60) / 15) * ROW_PX
      : null

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
      {!compact && (
        <div className="bg-[#F5F6FA] px-3 py-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-[#141820]">
            {WEEKDAYS_LONG[(day.getDay() + 6) % 7].toUpperCase()} {day.getDate()} DE {MONTHS[day.getMonth()].toUpperCase()}
          </span>
          {appts.length > 0 && <span className="text-[11px] text-[#6B738A]">{appts.length} cita(s)</span>}
        </div>
      )}
      <div className="overflow-y-auto" style={{ maxHeight: compact ? 420 : 560 }}>
        <div className="relative flex" style={{ height: gridHeight }}>
          {/* Columna de horas */}
          <div className="w-14 flex-shrink-0 border-r border-[#ECEEF5] sticky left-0 bg-white z-10">
            {labels.map((l) => (
              <div key={l} style={{ height: HOUR_PX }} className="relative">
                <span className="absolute -top-2 right-1.5 text-[10px] text-[#A0A8BF]">{l}</span>
              </div>
            ))}
          </div>
          {/* Área de citas */}
          <div className="flex-1 relative">
            {labels.map((_, i) => (
              <div key={i} className="absolute left-0 right-0 border-t border-[#ECEEF5]" style={{ top: i * HOUR_PX }} />
            ))}
            {nowOffset !== null && (
              <div className="absolute left-0 right-0 border-t-2 border-[#E24B4A] z-20" style={{ top: nowOffset }}>
                <span className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-[#E24B4A]" />
              </div>
            )}
            {layout.map(({ c, col, cols }) => {
              const start = new Date(c.scheduled_at as string)
              const startMin = start.getHours() * 60 + start.getMinutes() - DAY_START_HOUR * 60
              const dur = plannedDuration(c)
              const top = (startMin / 15) * ROW_PX
              const height = Math.max((dur / 15) * ROW_PX - 2, 18)
              const widthPct = 100 / cols
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className={`absolute rounded-md border px-1.5 py-0.5 text-left overflow-hidden hover:brightness-95 ${chipClass(c.status)}`}
                  style={{
                    top,
                    height,
                    left: `calc(${col * widthPct}% + 2px)`,
                    width: `calc(${widthPct}% - 4px)`,
                  }}
                  title={`${timeOf(c.scheduled_at as string)} · ${nameOf(c)} · ${c.status}`}
                >
                  <span className="block text-[10px] font-semibold leading-tight truncate">
                    {timeOf(c.scheduled_at as string)}
                  </span>
                  <span className="block text-[10px] leading-tight truncate">{nameOf(c)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Vista Semana
// ─────────────────────────────────────────────────────
function WeekView({
  cursor,
  today,
  apptsOn,
  nameOf,
  onSelect,
}: {
  cursor: Date
  today: Date
  apptsOn: (d: Date) => Consultation[]
  nameOf: (c: Consultation) => string
  onSelect: (c: Consultation) => void
}) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const labels = hourLabels()
  const totalMin = (DAY_END_HOUR - DAY_START_HOUR) * 60
  const gridHeight = (totalMin / 15) * ROW_PX
  // 44px para la columna de horas + 7 columnas de mínimo 64px cada una.
  // En pantallas angostas la grilla completa no entra y aparece scroll
  // horizontal — pero se ve la semana COMPLETA (7 días), solo compactada,
  // en vez de colapsar a un solo día.

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        {/* Encabezado de días */}
        <div className="grid grid-cols-[44px_repeat(7,minmax(64px,1fr))] bg-[#F5F6FA]">
          <div />
          {days.map((d) => (
            <div key={d.toISOString()} className="text-center py-1.5 border-l border-[#ECEEF5]">
              <p className="text-[9px] text-[#6B738A] uppercase">{WEEKDAYS[(d.getDay() + 6) % 7]}</p>
              <p
                className={`text-[11px] font-semibold mx-auto mt-0.5 w-5 h-5 rounded-full flex items-center justify-center ${
                  sameDay(d, today) ? 'bg-[#185FA5] text-white' : 'text-[#141820]'
                }`}
              >
                {d.getDate()}
              </p>
            </div>
          ))}
        </div>
        {/* Grilla horaria */}
        <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
          <div className="grid grid-cols-[44px_repeat(7,minmax(64px,1fr))]" style={{ height: gridHeight }}>
            <div className="relative border-r border-[#ECEEF5] sticky left-0 bg-white z-10">
              {labels.map((l) => (
                <div key={l} style={{ height: HOUR_PX }} className="relative">
                  <span className="absolute -top-2 right-1 text-[9px] text-[#A0A8BF]">{l}</span>
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d.toISOString()} className="relative border-l border-[#ECEEF5]">
                {labels.map((_, i) => (
                  <div key={i} className="absolute left-0 right-0 border-t border-[#ECEEF5]" style={{ top: i * HOUR_PX }} />
                ))}
                {layoutOverlaps(apptsOn(d)).map(({ c, col, cols: nCols }) => {
                  const s = new Date(c.scheduled_at as string)
                  const startMin = s.getHours() * 60 + s.getMinutes() - DAY_START_HOUR * 60
                  const dur = plannedDuration(c)
                  const top = (startMin / 15) * ROW_PX
                  const height = Math.max((dur / 15) * ROW_PX - 2, 16)
                  const widthPct = 100 / nCols
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelect(c)}
                      className={`absolute rounded border px-1 py-0.5 text-left overflow-hidden hover:brightness-95 ${chipClass(c.status)}`}
                      style={{ top, height, left: `calc(${col * widthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)` }}
                      title={`${timeOf(c.scheduled_at as string)} · ${nameOf(c)}`}
                    >
                      <span className="block text-[9px] font-semibold leading-tight truncate">
                        {timeOf(c.scheduled_at as string)}
                      </span>
                      <span className="block text-[9px] leading-tight truncate">{nameOf(c)}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="sm:hidden text-[10px] text-[#A0A8BF] text-center py-1.5 border-t border-[#ECEEF5]">
        ← Desliza para ver toda la semana →
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Vista Mes
// ─────────────────────────────────────────────────────
function MonthView({
  cursor,
  today,
  byDay,
  nameOf,
  onSelect,
}: {
  cursor: Date
  today: Date
  byDay: Map<string, Consultation[]>
  nameOf: (c: Consultation) => string
  onSelect: (c: Consultation) => void
}) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = (firstOfMonth.getDay() + 6) % 7
  const gridStart = addDays(firstOfMonth, -startOffset)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  // Día tocado en la grilla compacta móvil — por defecto, hoy si cae en el
  // mes visible, si no el primero del mes. Se reinicia al cambiar de mes.
  const [selectedDay, setSelectedDay] = useState<Date>(() =>
    today.getFullYear() === year && today.getMonth() === month ? today : firstOfMonth
  )
  useEffect(() => {
    setSelectedDay(today.getFullYear() === year && today.getMonth() === month ? today : firstOfMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  return (
    <div>
      {/* ── Escritorio: grilla mensual ── */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-[11px] font-medium text-[#6B738A] text-center py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === month
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
            const dayAppts = byDay.get(key) || []
            const visible = dayAppts.slice(0, 3)
            const overflow = dayAppts.length - visible.length
            return (
              <div
                key={i}
                className={`min-h-[92px] rounded-lg border p-1.5 flex flex-col gap-1 ${
                  inMonth ? 'border-[#DDE1EE] bg-white' : 'border-[#ECEEF5] bg-[#FAFBFD]'
                }`}
              >
                <span
                  className={`text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full ${
                    sameDay(d, today) && inMonth ? 'bg-[#185FA5] text-white' : inMonth ? 'text-[#141820]' : 'text-[#B7BDD1]'
                  }`}
                >
                  {d.getDate()}
                </span>
                <div className="flex flex-col gap-0.5">
                  {visible.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onSelect(c)}
                      className={`text-left text-[10px] leading-tight rounded border px-1 py-0.5 truncate hover:brightness-95 ${chipClass(
                        c.status
                      )}`}
                      title={`${timeOf(c.scheduled_at as string)} · ${nameOf(c)} · ${c.status}`}
                    >
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${dotClass(c.status)}`} />
                      {timeOf(c.scheduled_at as string)} {nameOf(c)}
                    </button>
                  ))}
                  {overflow > 0 && <span className="text-[10px] text-[#6B738A] px-1">+{overflow} más</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Móvil: grilla mensual compacta + agenda del día tocado ── */}
      <div className="sm:hidden">
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-[10px] font-medium text-[#6B738A] text-center py-1">
              {w[0]}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 mb-3">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === month
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
            const dayAppts = byDay.get(key) || []
            const dots = dayAppts.slice(0, 3)
            const isSel = sameDay(d, selectedDay)
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(d)}
                className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5 ${
                  isSel
                    ? 'border-[#185FA5] bg-[#E6F1FB]'
                    : inMonth
                    ? 'border-[#ECEEF5] bg-white'
                    : 'border-transparent bg-[#FAFBFD]'
                }`}
              >
                <span
                  className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full ${
                    sameDay(d, today) && inMonth
                      ? 'bg-[#185FA5] text-white font-semibold'
                      : inMonth
                      ? 'text-[#141820]'
                      : 'text-[#C4C9DA]'
                  }`}
                >
                  {d.getDate()}
                </span>
                {dots.length > 0 && (
                  <span className="flex gap-0.5">
                    {dots.map((c) => (
                      <span key={c.id} className={`w-1 h-1 rounded-full ${dotClass(c.status)}`} />
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Agenda del día tocado en la grilla */}
        <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
          <div className="bg-[#F5F6FA] px-3 py-2">
            <span className="text-xs font-semibold text-[#141820]">
              {WEEKDAYS_LONG[(selectedDay.getDay() + 6) % 7]} {selectedDay.getDate()} de {MONTHS[selectedDay.getMonth()].toLowerCase()}
            </span>
          </div>
          {(byDay.get(`${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}`) || []).length === 0 ? (
            <p className="text-xs text-[#6B738A] text-center py-6">No hay citas agendadas ese día.</p>
          ) : (
            <div className="divide-y divide-[#ECEEF5]">
              {(byDay.get(`${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}`) || []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className="w-full flex items-center gap-2 text-left px-3 py-2.5 hover:bg-[#F9FAFC]"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass(c.status)}`} />
                  <span className="text-xs font-medium text-[#141820] w-14 flex-shrink-0">
                    {timeOf(c.scheduled_at as string)}
                  </span>
                  <span className="text-xs text-[#141820] truncate flex-1">{nameOf(c)}</span>
                  <StatusBadge status={c.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}