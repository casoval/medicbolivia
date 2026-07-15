'use client'
// src/components/professional/ProfessionalScheduleModal.tsx
//
// El profesional (con membresía activa) agenda directamente a un paciente
// ya vinculado, sin límite de horario disponible. El cobro es SIEMPRE
// directo entre el profesional y el paciente — la plataforma no genera QR
// ni procesa ese pago, solo registra el monto para las estadísticas del
// profesional. Por eso esta cita se puede cancelar o reprogramar después
// las veces que sea, sin flujo de reembolso (ver
// ProfessionalScheduleRequest en el backend).

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
  const [amount, setAmount] = useState(String(defaultAmount))
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const patientName = `${link.patient_first_name || ''} ${link.patient_last_name || ''}`.trim() || 'Paciente'

  const scheduleMutation = useMutation({
    mutationFn: () => {
      const parsedAmount = amount.trim() === '' ? undefined : Number(amount)
      return consultationsAPI.professionalSchedule({
        patient_id: link.patient_id,
        scheduled_at: scheduledAt,
        chief_complaint: chiefComplaint || undefined,
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
    scheduleMutation.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold mb-1">Agendar cita a {patientName}</h2>
        <p className="text-xs text-[#6B738A] mb-4">
          Sin límite de horario disponible — sí se revisa que no choque con otra cita tuya.
        </p>

        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

        <div className="space-y-3" style={pickerOpen ? { marginBottom: 300 } : undefined}>
          <div>
            <label className="block text-xs text-[#6B738A] mb-1">Fecha y hora</label>
            <SpanishDateTimePicker value={scheduledAt} onChange={setScheduledAt} onOpenChange={setPickerOpen} />
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

          <div className="bg-[#F5F6FA] rounded-lg px-3 py-2.5">
            <p className="text-[11px] text-[#6B738A]">
              El cobro es directo entre tú y el paciente — la plataforma no genera QR ni participa
              en este pago, solo lo registra para tus estadísticas. Por eso puedes cancelar o
              reprogramar esta cita después las veces que necesites, sin trámites de reembolso.
            </p>
          </div>

          <div>
            <label className="block text-xs text-[#6B738A] mb-1">Monto que cobrarás (Bs.)</label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            />
            <p className="text-[10px] text-[#A0A8BF] mt-1">Puedes poner 0 (ej. consulta de cortesía).</p>
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
