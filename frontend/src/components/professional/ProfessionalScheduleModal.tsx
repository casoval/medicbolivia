'use client'
// src/components/professional/ProfessionalScheduleModal.tsx
//
// El profesional (con membresía activa) agenda directamente a un paciente
// ya vinculado, sin límite de horario disponible. Dos formas de cobro:
// - PLATFORM_QR: se le manda un QR al paciente (plazo dinámico: hasta 1h
//   antes si hay tiempo, 10 min antes si se agenda con poca anticipación).
// - CASH: el profesional reporta el monto cobrado (acepta 0).

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SpanishDateTimePicker } from '@/components/ui/SpanishDateTimePicker'
import { Alert } from '@/components/ui'
import { consultationsAPI, getErrorMessage } from '@/lib/api'
import type { PatientLink } from '@/lib/api'

interface Props {
  link: PatientLink
  defaultAmount: number
  onClose: () => void
}

export function ProfessionalScheduleModal({ link, defaultAmount, onClose }: Props) {
  const qc = useQueryClient()
  const [scheduledAt, setScheduledAt] = useState('')
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [channel, setChannel] = useState<'PLATFORM_QR' | 'CASH'>('PLATFORM_QR')
  const [amount, setAmount] = useState(String(defaultAmount))
  const [error, setError] = useState('')

  const patientName = `${link.patient_first_name || ''} ${link.patient_last_name || ''}`.trim() || 'Paciente'

  const scheduleMutation = useMutation({
    mutationFn: () => {
      const parsedAmount = amount.trim() === '' ? undefined : Number(amount)
      return consultationsAPI.professionalSchedule({
        patient_id: link.patient_id,
        scheduled_at: scheduledAt,
        chief_complaint: chiefComplaint || undefined,
        payment_channel: channel,
        amount: parsedAmount,
      })
    },
    onMutate: () => setError(''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professional-appointments'] })
      qc.invalidateQueries({ queryKey: ['consultations'] })
      onClose()
    },
    onError: (err: any) => setError(getErrorMessage(err)),
  })

  function submit() {
    if (!scheduledAt) {
      setError('Elige la fecha y hora de la cita')
      return
    }
    if (channel === 'CASH' && amount.trim() === '') {
      setError('Indica el monto cobrado (puedes poner 0)')
      return
    }
    scheduleMutation.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold mb-1">Agendar cita a {patientName}</h2>
        <p className="text-xs text-[#6B738A] mb-4">
          Sin límite de horario disponible — sí se revisa que no choque con otra cita tuya.
        </p>

        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#6B738A] mb-1">Fecha y hora</label>
            <SpanishDateTimePicker value={scheduledAt} onChange={setScheduledAt} />
          </div>

          <div>
            <label className="block text-xs text-[#6B738A] mb-1">Motivo de consulta (opcional)</label>
            <input
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="Ej. Control mensual"
              className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-[#6B738A] mb-1">Cobro</label>
            <div className="flex rounded-lg overflow-hidden border border-[#DDE1EE] text-xs">
              <button
                type="button"
                onClick={() => { setChannel('PLATFORM_QR'); setAmount(String(defaultAmount)) }}
                className={`flex-1 py-1.5 ${channel === 'PLATFORM_QR' ? 'bg-[#185FA5] text-white' : 'bg-white text-[#6B738A]'}`}
              >
                QR por plataforma
              </button>
              <button
                type="button"
                onClick={() => { setChannel('CASH'); setAmount('') }}
                className={`flex-1 py-1.5 ${channel === 'CASH' ? 'bg-[#185FA5] text-white' : 'bg-white text-[#6B738A]'}`}
              >
                Efectivo
              </button>
            </div>
            <p className="text-[10px] text-[#A0A8BF] mt-1">
              {channel === 'PLATFORM_QR'
                ? 'Se le envía un QR al paciente para pagar. Puede pagar hasta 1h antes de la cita (10 min si la agendas con poca anticipación).'
                : 'Registra cuánto cobraste fuera de la plataforma. Puedes poner 0 (ej. consulta de cortesía).'}
            </p>
          </div>

          <div>
            <label className="block text-xs text-[#6B738A] mb-1">
              Monto (Bs.) {channel === 'PLATFORM_QR' && '— déjalo con tu precio general o edítalo'}
            </label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary text-xs py-1.5 px-3">Cancelar</button>
          <button
            onClick={submit}
            disabled={scheduleMutation.isPending}
            className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60"
          >
            {scheduleMutation.isPending ? 'Agendando…' : 'Agendar cita'}
          </button>
        </div>
      </div>
    </div>
  )
}
