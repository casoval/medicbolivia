'use client'
// src/components/patient/BookAppointmentModal.tsx

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { scheduleAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import { Alert } from '@/components/ui'
import type { Professional } from '@/types'

interface BookAppointmentModalProps {
  professional: Professional
  onClose: () => void
}

const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

function toISO(d: Date) {
  return d.toISOString().slice(0, 10)
}

function todayLocal() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function formatSlotTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
}

// Genera la cuadrícula del calendario, empezando en lunes
function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  // día semana en base lunes (0=Lu ... 6=Do)
  const startOffset = (firstDay.getDay() + 6) % 7
  const days: (Date | null)[] = []
  for (let i = 0; i < startOffset; i++) days.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d))
  return days
}

function MiniCalendar({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (iso: string) => void
}) {
  const today = todayLocal()
  const initDate = selected ? new Date(selected + 'T00:00:00') : today
  const [view, setView] = useState({ year: initDate.getFullYear(), month: initDate.getMonth() })

  const days = buildCalendarDays(view.year, view.month)

  function prevMonth() {
    setView(v => {
      const d = new Date(v.year, v.month - 1, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }
  function nextMonth() {
    setView(v => {
      const d = new Date(v.year, v.month + 1, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  return (
    <div className="border border-[#DDE1EE] rounded-xl p-3 mb-4 select-none">
      {/* Header mes/año */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="text-[#6B738A] hover:text-[#185FA5] p-1 rounded">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="text-sm font-semibold text-[#3C4257]">
          {MESES[view.month]} {view.year}
        </span>
        <button onClick={nextMonth} className="text-[#6B738A] hover:text-[#185FA5] p-1 rounded">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      {/* Encabezados días */}
      <div className="grid grid-cols-7 mb-1">
        {DIAS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-[#A0A8BF]">{d}</div>
        ))}
      </div>
      {/* Días */}
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />
          const iso = toISO(day)
          const isPast = day < today
          const isSelected = iso === selected
          const isToday = iso === toISO(today)
          return (
            <button
              key={iso}
              disabled={isPast}
              onClick={() => onSelect(iso)}
              className={`h-7 w-full rounded-lg text-xs transition-colors ${
                isPast
                  ? 'text-[#DDE1EE] cursor-not-allowed'
                  : isSelected
                  ? 'bg-[#185FA5] text-white font-semibold'
                  : isToday
                  ? 'border border-[#185FA5] text-[#185FA5] font-semibold hover:bg-[#F0F5FB]'
                  : 'text-[#3C4257] hover:bg-[#F0F5FB]'
              }`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BookAppointmentModal({ professional, onClose }: BookAppointmentModalProps) {
  const router = useRouter()
  const [date, setDate] = useState(toISO(todayLocal()))
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [error, setError] = useState('')
  const [consultationType, setConsultationType] = useState<'SCHEDULED' | 'FOLLOW_UP'>('SCHEDULED')

  // El paciente solo puede pedir "seguimiento" si ya tuvo una consulta
  // COMPLETED con este mismo profesional. Se verifica contra su propio
  // historial (el backend igual lo revalida al crear la consulta).
  const { data: myConsultations } = useQuery({
    queryKey: ['my-consultations-for-followup'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    staleTime: 60_000,
  })
  const eligibleForFollowUp = !!myConsultations?.some(
    (c) => c.professional_id === professional.id && c.status === 'COMPLETED'
  )

  const activePrice = consultationType === 'FOLLOW_UP' ? professional.price_follow_up : professional.price_general

  const { data: slotsData, isLoading: loadingSlots } = useQuery({
    queryKey: ['available-slots', professional.id, date],
    queryFn: () => scheduleAPI.getAvailableSlots(professional.id, date),
  })

  const slots = slotsData?.slots || []

  const createMutation = useMutation({
    mutationFn: () =>
      consultationsAPI.create({
        professional_id: professional.id,
        consultation_type: consultationType,
        specialty: professional.specialty,
        chief_complaint: chiefComplaint || undefined,
        scheduled_at: selectedSlot!,
      }),
    onSuccess: (res) => {
      router.push(`/patient/waiting-room?consultationId=${res.data.id}`)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  function handleTypeSelect(type: 'SCHEDULED' | 'FOLLOW_UP') {
    setConsultationType(type)
    setSelectedSlot(null)
    setError('')
  }

  function handleDateSelect(iso: string) {
    setDate(iso)
    setSelectedSlot(null)
  }

  // Formato legible de la fecha seleccionada
  const [year, month, day] = date.split('-').map(Number)
  const dateLabel = `${day} de ${MESES[month - 1]} de ${year}`

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold">Agendar cita</h3>
          <button onClick={onClose} className="text-[#A0A8BF] hover:text-[#6B738A] text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-[#6B738A] mb-4">
          Con {professional.first_name} {professional.last_name} · {professional.specialty}
        </p>

        {error && (
          <div className="mb-3">
            <Alert type="error" message={error} />
          </div>
        )}

        {eligibleForFollowUp && (
          <div className="flex gap-2 mb-4 bg-[#F5F6FA] p-1 rounded-lg">
            <button
              onClick={() => handleTypeSelect('SCHEDULED')}
              className={`flex-1 text-xs py-2 rounded-md font-medium transition-colors ${
                consultationType === 'SCHEDULED' ? 'bg-white shadow-sm text-[#185FA5]' : 'text-[#6B738A]'
              }`}
            >
              Cita nueva · Bs. {parseFloat(professional.price_general).toFixed(0)}
            </button>
            <button
              onClick={() => handleTypeSelect('FOLLOW_UP')}
              className={`flex-1 text-xs py-2 rounded-md font-medium transition-colors ${
                consultationType === 'FOLLOW_UP' ? 'bg-white shadow-sm text-[#0F6E56]' : 'text-[#6B738A]'
              }`}
            >
              Seguimiento · Bs. {parseFloat(professional.price_follow_up).toFixed(0)}
            </button>
          </div>
        )}
        {!eligibleForFollowUp && (
          <p className="text-sm font-semibold text-[#185FA5] mb-4">
            Bs. {parseFloat(activePrice).toFixed(0)} · consulta agendada
          </p>
        )}

        <label className="block text-xs font-medium text-[#6B738A] mb-2">Fecha</label>
        <MiniCalendar selected={date} onSelect={handleDateSelect} />
        <p className="text-xs text-[#185FA5] font-medium -mt-2 mb-4">{dateLabel}</p>

        <label className="block text-xs font-medium text-[#6B738A] mb-2">Horarios disponibles</label>
        {loadingSlots ? (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-9 bg-[#F5F6FA] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <p className="text-sm text-[#6B738A] mb-4">
            No hay horarios disponibles ese día. Prueba otra fecha.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 mb-4 max-h-48 overflow-y-auto">
            {slots.map((slot) => (
              <button
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`py-2 rounded-lg text-sm border transition-colors ${
                  selectedSlot === slot
                    ? 'bg-[#185FA5] border-[#185FA5] text-white font-medium'
                    : 'bg-white border-[#DDE1EE] text-[#3C4257] hover:border-[#185FA5]'
                }`}
              >
                {formatSlotTime(slot)}
              </button>
            ))}
          </div>
        )}

        <label className="block text-xs font-medium text-[#6B738A] mb-1">
          Motivo de consulta (opcional)
        </label>
        <textarea
          value={chiefComplaint}
          onChange={(e) => setChiefComplaint(e.target.value)}
          rows={2}
          placeholder="Ej. control de presión, dolor de cabeza recurrente..."
          className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none mb-4"
        />

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 btn-secondary text-sm py-2">
            Cancelar
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!selectedSlot || createMutation.isPending}
            className="flex-1 btn-primary text-sm py-2 disabled:opacity-50"
          >
            {createMutation.isPending
              ? 'Solicitando...'
              : consultationType === 'FOLLOW_UP'
              ? 'Solicitar seguimiento'
              : 'Solicitar cita'}
          </button>
        </div>
        <p className="text-[10px] text-[#A0A8BF] mt-2 text-center">
          El profesional debe confirmar tu solicitud antes de pagar.
        </p>
      </div>
    </div>
  )
}