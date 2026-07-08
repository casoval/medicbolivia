'use client'
// src/components/shared/AppointmentsCalendar.tsx
//
// Calendario mensual de citas agendadas, compartido entre
// /professional/appointments y /patient/history.
//
// Objetivo: que con un vistazo rápido (sin abrir nada) se entienda
// cuántas citas hay cada día y en qué estado están, usando el mismo
// código de colores que StatusBadge (components/ui/index.tsx) para
// no introducir una convención visual nueva.
//
// - En pantallas grandes: grilla mensual clásica (7 columnas).
// - En pantallas chicas: lista tipo "agenda" agrupada por día, porque
//   una grilla de 7 columnas es ilegible en un celular.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { StatusBadge } from '@/components/ui'
import { fmtFechaHoraLocal } from '@/lib/consultationHistory'
import type { Consultation, ConsultationStatus } from '@/types'

// ─────────────────────────────────────────────────────
// Colores por estado — misma familia que StatusBadge, pero
// reducidos a un punto de color (no hay espacio para el badge
// completo dentro de una celda de calendario).
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
  COMPLETED: 'bg-[#E1F5EE] border-[#9FE1CB]',
  IN_PROGRESS: 'bg-[#E6F1FB] border-[#85B7EB]',
  PAYMENT_CONFIRMED: 'bg-[#E6F1FB] border-[#85B7EB]',
  WAITING_PROFESSIONAL: 'bg-[#E6F1FB] border-[#85B7EB]',
  PROFESSIONAL_ACCEPTED: 'bg-[#E6F1FB] border-[#85B7EB]',
  AGENT_TRIAGING: 'bg-[#E6F1FB] border-[#85B7EB]',
  WAITING_PAYMENT: 'bg-[#FAEEDA] border-[#FAC775]',
  CANCELLED: 'bg-[#ECEEF5] border-[#DDE1EE]',
  REFUNDED: 'bg-[#ECEEF5] border-[#DDE1EE]',
}
function dotClass(status: string) {
  return STATUS_DOT[status] || 'bg-[#6B738A]'
}
function chipClass(status: string) {
  return STATUS_CHIP_BG[status] || 'bg-[#ECEEF5] border-[#DDE1EE]'
}

const LEGEND: { status: ConsultationStatus; label: string }[] = [
  { status: 'PROFESSIONAL_ACCEPTED', label: 'Confirmada' },
  { status: 'WAITING_PAYMENT', label: 'Pendiente de pago' },
  { status: 'COMPLETED', label: 'Completada' },
  { status: 'CANCELLED', label: 'Cancelada / reembolsada' },
]

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// scheduled_at viene del backend como hora Bolivia "naive" (sin 'Z'),
// igual que en fmtFechaHoraLocal — se parsea tal cual, sin conversión.
function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function timeOf(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-BO', { hour: 'numeric', minute: '2-digit' })
}

interface Props {
  consultations: Consultation[]
  role: 'PATIENT' | 'PROFESSIONAL'
  /** Si se pasa, la celda/chip llama a esto en vez de abrir el panel de detalle interno. */
  onSelectConsultation?: (c: Consultation) => void
}

export function AppointmentsCalendar({ consultations, role, onSelectConsultation }: Props) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [detail, setDetail] = useState<Consultation | null>(null)

  // Solo citas agendadas (no consultas inmediatas) con fecha asignada.
  const scheduled = useMemo(
    () =>
      consultations.filter(
        (c) => (c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP') && !!c.scheduled_at
      ),
    [consultations]
  )

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

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const today = new Date()
  const isToday = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear()

  // Días a mostrar: relleno desde lunes de la primera semana hasta domingo de la última.
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = (firstOfMonth.getDay() + 6) % 7 // lunes=0
  const gridStart = new Date(year, month, 1 - startOffset)
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })

  const monthCount = scheduled.filter((c) => {
    const d = new Date(c.scheduled_at as string)
    return d.getMonth() === month && d.getFullYear() === year
  }).length

  function openDetail(c: Consultation) {
    if (onSelectConsultation) onSelectConsultation(c)
    else setDetail(c)
  }

  function nameOf(c: Consultation) {
    if (role === 'PATIENT') {
      return c.professional_first_name ? `Dr(a). ${c.professional_first_name} ${c.professional_last_name || ''}`.trim() : 'Profesional'
    }
    return c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : 'Paciente'
  }

  return (
    <div>
      {/* Encabezado: navegación de mes */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#DDE1EE] text-[#6B738A] hover:bg-[#F4F6FB]"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <h3 className="text-sm font-semibold text-[#141820] w-40 text-center">
            {MONTHS[month]} {year}
          </h3>
          <button
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#DDE1EE] text-[#6B738A] hover:bg-[#F4F6FB]"
            aria-label="Mes siguiente"
          >
            ›
          </button>
          <button
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="ml-1 text-xs font-medium text-[#185FA5] hover:underline"
          >
            Hoy
          </button>
        </div>
        <span className="text-xs text-[#6B738A]">
          {monthCount} {monthCount === 1 ? 'cita' : 'citas'} este mes
        </span>
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

      {/* ── Vista de escritorio: grilla mensual ── */}
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
                    isToday(d.getDate()) && inMonth
                      ? 'bg-[#185FA5] text-white'
                      : inMonth
                      ? 'text-[#141820]'
                      : 'text-[#B7BDD1]'
                  }`}
                >
                  {d.getDate()}
                </span>
                <div className="flex flex-col gap-0.5">
                  {visible.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openDetail(c)}
                      className={`text-left text-[10px] leading-tight rounded border px-1 py-0.5 truncate hover:brightness-95 ${chipClass(
                        c.status
                      )}`}
                      title={`${timeOf(c.scheduled_at as string)} · ${nameOf(c)} · ${c.status}`}
                    >
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${dotClass(c.status)}`} />
                      {timeOf(c.scheduled_at as string)} {nameOf(c)}
                    </button>
                  ))}
                  {overflow > 0 && (
                    <span className="text-[10px] text-[#6B738A] px-1">+{overflow} más</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Vista móvil: agenda por día ── */}
      <div className="sm:hidden flex flex-col gap-3">
        {Array.from(byDay.entries())
          .filter(([key]) => {
            const [y, m] = key.split('-').map(Number)
            return y === year && m === month
          })
          .sort(([a], [b]) => {
            const da = a.split('-').map(Number)
            const db = b.split('-').map(Number)
            return new Date(da[0], da[1], da[2]).getTime() - new Date(db[0], db[1], db[2]).getTime()
          })
          .map(([key, appts]) => {
            const [, , d] = key.split('-').map(Number)
            return (
              <div key={key}>
                <p className="text-xs font-semibold text-[#141820] mb-1.5">
                  {d} de {MONTHS[month]}
                </p>
                <div className="flex flex-col gap-1.5">
                  {appts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openDetail(c)}
                      className={`flex items-center gap-2 text-left rounded-lg border px-3 py-2 ${chipClass(c.status)}`}
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
              </div>
            )
          })}
        {monthCount === 0 && (
          <p className="text-xs text-[#6B738A] text-center py-8">No hay citas agendadas este mes.</p>
        )}
      </div>

      {/* Panel de detalle interno (solo si el padre no maneja su propio detalle) */}
      {detail &&
        !onSelectConsultation &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4"
            onClick={() => setDetail(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#141820]">Detalle de la cita</h3>
                <StatusBadge status={detail.status} />
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-[#4A5169]">
                <p>
                  <span className="font-medium text-[#141820]">
                    {role === 'PATIENT' ? 'Profesional: ' : 'Paciente: '}
                  </span>
                  {nameOf(detail)}
                </p>
                <p>
                  <span className="font-medium text-[#141820]">Fecha y hora: </span>
                  {fmtFechaHoraLocal(detail.scheduled_at)}
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
