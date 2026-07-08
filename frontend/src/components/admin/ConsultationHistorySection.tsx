'use client'
// src/components/admin/ConsultationHistorySection.tsx
//
// Historial detallado de consultas para el panel de admin: se usa tanto
// dentro de la ficha de un profesional como dentro de la ficha de un
// paciente. Muestra TODO sin restricciones de privacidad (recetas,
// historia clínica completa, pagos, calificación) porque es para que
// soporte/admin pueda resolver quejas o pedidos de información — esas
// restricciones de privacidad son entre paciente y profesional, no
// aplican a este panel.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface PaymentInfo {
  status: string
  paid_at: string | null
  bank_tx_id: string | null
  refunded_at: string | null
  refund_note: string | null
}

interface PrescriptionItem {
  id: string
  medications: { name: string; dosage?: string; frequency?: string; duration?: string; notes?: string }[]
  instructions: string | null
  status: string
  signed_at: string | null
  void_reason: string | null
  pdf_url: string | null
}

interface ClinicalNoteInfo {
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  is_visible_to_patient: boolean
  shared_with_professionals: boolean
  created_at: string
  updated_at: string
}

interface RatingInfo {
  score: number
  comment: string | null
  created_at: string
}

interface HistoryItem {
  id: string
  consultation_type: string
  status: string
  specialty: string | null
  chief_complaint: string | null
  outcome_note: string | null
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  duration_minutes: number | null
  created_at: string
  amount: number
  patient_name?: string
  professional_name?: string
  payment: PaymentInfo | null
  prescriptions: PrescriptionItem[]
  clinical_note: ClinicalNoteInfo | null
  rating: RatingInfo | null
}

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completada', IN_PROGRESS: 'En curso', WAITING_PAYMENT: 'Esperando pago',
  PAYMENT_CONFIRMED: 'Pago confirmado', WAITING_PROFESSIONAL: 'Buscando profesional',
  CANCELLED: 'Cancelada', REFUNDED: 'Reembolsada', AGENT_TRIAGING: 'Con agente IA',
  PROFESSIONAL_ACCEPTED: 'Aceptada por profesional',
}
const STATUS_CLASS: Record<string, string> = {
  COMPLETED: 'bg-[#E1F5EE] text-[#0F6E56] border-[#9FE1CB]',
  IN_PROGRESS: 'bg-[#E6F1FB] text-[#185FA5] border-[#85B7EB]',
  CANCELLED: 'bg-[#F0F1F5] text-[#6B738A] border-[#DDE1EE]',
  REFUNDED: 'bg-[#F0F1F5] text-[#6B738A] border-[#DDE1EE]',
}
const TYPE_LABELS: Record<string, string> = { IMMEDIATE: 'Inmediata', SCHEDULED: 'Programada', FOLLOW_UP: 'Seguimiento' }
const OUTCOME_LABELS: Record<string, string> = {
  PROFESSIONAL_NO_SHOW: '⚠ El profesional no asistió',
  PATIENT_NO_SHOW: '⚠ El paciente no asistió',
  REJECTED_BY_PROFESSIONAL: '⚠ Rechazada por el profesional',
  AUTO_TIMEOUT_PROFESSIONAL: '⚠ El profesional no respondió a tiempo',
  AUTO_TIMEOUT_PROFESSIONAL_PAID: '⚠ El profesional no respondió a tiempo (ya pagada)',
  PROFESSIONAL_CANCELLED_WITH_REFUND: '⚠ Cancelada por el profesional, con reembolso',
  CANCELLED_24H_NOTICE: 'Cancelada con aviso de 24h',
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-BO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ConsultationRow({ item, counterpartName }: { item: HistoryItem; counterpartName: string }) {
  const [open, setOpen] = useState(false)
  const hasClinicalNote = !!item.clinical_note
  const hasRx = item.prescriptions.length > 0

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-[#F5F6FA] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{counterpartName}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_CLASS[item.status] || 'bg-[#F0F1F5] text-[#6B738A] border-[#DDE1EE]'}`}>
              {STATUS_LABELS[item.status] || item.status}
            </span>
            <span className="text-[10px] text-[#A0A8BF]">{TYPE_LABELS[item.consultation_type] || item.consultation_type}</span>
          </div>
          <p className="text-xs text-[#6B738A] mt-0.5">
            {fmtDateTime(item.scheduled_at || item.created_at)}
            {item.specialty && ` · ${item.specialty}`}
            {item.duration_minutes ? ` · ${item.duration_minutes} min` : ''}
          </p>
          {item.outcome_note && OUTCOME_LABELS[item.outcome_note] && (
            <p className="text-xs text-[#A32D2D] mt-1">{OUTCOME_LABELS[item.outcome_note]}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasRx && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E6F1FB] text-[#185FA5]" title="Tiene receta">💊</span>}
          {hasClinicalNote && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E1F5EE] text-[#0F6E56]" title="Tiene historia clínica">📋</span>}
          {item.rating && <span className="text-[10px] text-[#EF9F27]">★ {item.rating.score}</span>}
          <span className="text-sm font-semibold text-[#185FA5]">Bs. {item.amount}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="2" className={`transition-transform ${open ? 'rotate-90' : ''}`}>
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>
      </button>

      {open && (
        <div className="p-3 border-t border-[#DDE1EE] bg-[#FAFBFC] space-y-3">
          {item.chief_complaint && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] uppercase tracking-wide mb-1">Motivo de consulta</p>
              <p className="text-xs text-[#3A4155]">{item.chief_complaint}</p>
            </div>
          )}

          {item.payment && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] uppercase tracking-wide mb-1">Pago</p>
              <div className="text-xs text-[#3A4155] bg-white rounded-lg border border-[#DDE1EE] p-2 space-y-0.5">
                <p>Estado: <span className="font-medium">{item.payment.status}</span></p>
                {item.payment.paid_at && <p>Pagado: {fmtDateTime(item.payment.paid_at)}</p>}
                {item.payment.bank_tx_id && <p>Referencia bancaria: {item.payment.bank_tx_id}</p>}
                {item.payment.refunded_at && <p className="text-[#A32D2D]">Reembolsado: {fmtDateTime(item.payment.refunded_at)} — {item.payment.refund_note}</p>}
              </div>
            </div>
          )}

          {hasRx && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] uppercase tracking-wide mb-1">Receta{item.prescriptions.length > 1 ? 's' : ''}</p>
              <div className="space-y-2">
                {item.prescriptions.map((rx) => (
                  <div key={rx.id} className="text-xs bg-white rounded-lg border border-[#DDE1EE] p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-medium ${rx.status === 'VOIDED' ? 'text-[#A32D2D] line-through' : 'text-[#141820]'}`}>
                        {rx.status === 'VOIDED' ? 'Anulada' : 'Activa'} · {fmtDateTime(rx.signed_at)}
                      </span>
                      {rx.pdf_url && <a href={rx.pdf_url} target="_blank" rel="noreferrer" className="text-[#185FA5] hover:underline">Ver PDF</a>}
                    </div>
                    <ul className="list-disc list-inside text-[#3A4155]">
                      {rx.medications.map((m, i) => (
                        <li key={i}>{m.name} — {m.dosage} {m.frequency ? `· ${m.frequency}` : ''} {m.duration ? `· ${m.duration}` : ''}</li>
                      ))}
                    </ul>
                    {rx.instructions && <p className="text-[#6B738A] mt-1">Indicaciones: {rx.instructions}</p>}
                    {rx.void_reason && <p className="text-[#A32D2D] mt-1">Motivo de anulación: {rx.void_reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasClinicalNote && item.clinical_note && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] uppercase tracking-wide mb-1">Historia clínica (SOAP)</p>
              <div className="text-xs bg-white rounded-lg border border-[#DDE1EE] p-2 space-y-1.5">
                {item.clinical_note.subjective && <p><span className="font-medium">S:</span> {item.clinical_note.subjective}</p>}
                {item.clinical_note.objective && <p><span className="font-medium">O:</span> {item.clinical_note.objective}</p>}
                {item.clinical_note.assessment && <p><span className="font-medium">A:</span> {item.clinical_note.assessment}</p>}
                {item.clinical_note.plan && <p><span className="font-medium">P:</span> {item.clinical_note.plan}</p>}
                <p className="text-[10px] text-[#A0A8BF] pt-1 border-t border-[#DDE1EE]">
                  {item.clinical_note.is_visible_to_patient ? 'Visible para el paciente' : 'Nota interna (no visible para el paciente)'}
                  {' · '}
                  {item.clinical_note.shared_with_professionals ? 'Compartida con otros profesionales' : 'No compartida con otros profesionales'}
                </p>
              </div>
            </div>
          )}

          {item.rating && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] uppercase tracking-wide mb-1">Calificación del paciente</p>
              <div className="text-xs bg-white rounded-lg border border-[#DDE1EE] p-2">
                <p className="text-[#EF9F27] font-medium">{'★'.repeat(item.rating.score)}{'☆'.repeat(5 - item.rating.score)} ({item.rating.score}/5)</p>
                {item.rating.comment && <p className="text-[#3A4155] mt-1">"{item.rating.comment}"</p>}
              </div>
            </div>
          )}

          {!item.chief_complaint && !hasRx && !hasClinicalNote && !item.rating && !item.payment && (
            <p className="text-xs text-[#A0A8BF]">Sin más detalles registrados para esta consulta.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ConsultationHistorySection({
  endpoint,
  counterpartField,
}: {
  endpoint: string
  counterpartField: 'patient_name' | 'professional_name'
}) {
  const { data: history = [], isLoading, isError } = useQuery({
    queryKey: ['admin', 'history', endpoint],
    queryFn: () => api.get(endpoint).then((r) => r.data as HistoryItem[]),
  })

  if (isLoading) {
    return <p className="text-xs text-[#6B738A] py-4 text-center">Cargando historial...</p>
  }
  if (isError) {
    return <p className="text-xs text-[#A32D2D] py-4 text-center">No se pudo cargar el historial.</p>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">Historial detallado</p>
        <span className="text-[10px] text-[#A0A8BF]">{history.length} consulta{history.length !== 1 ? 's' : ''}</span>
      </div>

      {history.length === 0 ? (
        <p className="text-sm text-[#6B738A] bg-[#F5F6FA] rounded-xl p-3 text-center">
          Todavía no hay consultas registradas
        </p>
      ) : (
        <div className="space-y-2">
          {history.map((item) => (
            <ConsultationRow key={item.id} item={item} counterpartName={item[counterpartField] || 'N/D'} />
          ))}
        </div>
      )}
    </div>
  )
}
