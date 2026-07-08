'use client'
// src/app/patient/history/page.tsx

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { StatusBadge, Stars, StarPicker, LoadingScreen, EmptyState, Alert, SectionTitle } from '@/components/ui'
import { consultationsAPI, ratingsAPI, prescriptionsAPI, clinicalNotesAPI, getErrorMessage, buildPrescriptionVerifyUrl } from '@/lib/api'
import type { ClinicalNote, DisputeCategory } from '@/lib/api'
import { outcomeLabel, cancelledByLabel, fmtFechaHora, fmtFechaHoraLocal, fmtHora, wasActuallyRefunded } from '@/lib/consultationHistory'
import type { Consultation, Rating } from '@/types'
import { AppointmentsCalendar } from '@/components/shared/AppointmentsCalendar'

const IconClose  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>

// Formatea fecha desde UTC correctamente
function fmtFecha(iso: string) {
  // Las fechas del backend vienen sin 'Z', agregarla para parsear como UTC
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz'
  })
}

// Avatar chico para listas de consultas: foto del doctor si existe, si no iniciales.
function DoctorAvatar({ firstName, lastName, photoUrl }: {
  firstName?: string | null
  lastName?: string | null
  photoUrl?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?'

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={`${firstName || ''} ${lastName || ''}`.trim() || 'Profesional'}
        onError={() => setFailed(true)}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-[#F5F6FA]"
      />
    )
  }
  return (
    <div className="w-9 h-9 rounded-full bg-[#185FA5]/10 text-[#185FA5] text-xs font-semibold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  )
}

function doctorNameOf(c: Consultation) {
  return c.professional_first_name
    ? `Dr. ${c.professional_first_name} ${c.professional_last_name || ''}`.trim()
    : null
}

// ── Modal de calificación ─────────────────────────────
function RatingModal({ consultation, onClose, onSave, loading }: {
  consultation: Consultation
  onClose: () => void
  onSave: (score: number, comment: string) => void
  loading?: boolean
}) {
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold">Califica tu consulta</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        <p className="text-xs text-[#6B738A] mb-4">
          {fmtFecha(consultation.created_at)} · Bs. {parseFloat(consultation.amount).toFixed(2)}
        </p>
        <div className="mb-4">
          <p className="text-xs text-[#6B738A] mb-2">¿Cómo fue tu experiencia?</p>
          <StarPicker value={score} onChange={setScore} />
        </div>
        <div className="mb-5">
          <label className="label">Comentario (opcional)</label>
          <textarea
            className="input resize-none"
            rows={3}
            placeholder="Cuéntanos cómo estuvo la atención..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
          />
          <p className="text-xs text-[#A0A8BF] mt-1 text-right">{comment.length}/500</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1" disabled={loading}>Calificar luego</button>
          <button
            onClick={() => onSave(score, comment)}
            disabled={score === 0 || loading}
            className="btn-primary flex-1"
          >
            {loading ? 'Enviando...' : 'Enviar calificación'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Modal de detalle de calificación ya puesta ────────
function RatingDetailModal({ rating, onClose }: {
  rating: Rating
  onClose: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold">Tu calificación</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        <p className="text-xs text-[#6B738A] mb-4">{fmtFecha(rating.created_at)}</p>
        <div className="mb-4">
          <Stars score={rating.score} size="lg" />
        </div>
        <div className="bg-[#F5F6FA] rounded-xl p-3 mb-5">
          <p className="text-xs text-[#6B738A] mb-1">Comentario</p>
          <p className="text-sm">{rating.comment || 'Sin comentario'}</p>
        </div>
        <button onClick={onClose} className="btn-secondary w-full">Cerrar</button>
      </div>
    </div>,
    document.body
  )
}

// ── Categorías de disputa (deben calzar con el backend: DisputeCreateRequest) ──
const DISPUTE_CATEGORIES: { value: DisputeCategory; label: string }[] = [
  { value: 'NO_SHOW',      label: 'El profesional no llegó a la consulta' },
  { value: 'MALA_CALIDAD', label: 'Mala calidad de la atención' },
  { value: 'TECNICO',      label: 'Problema técnico (video, audio, conexión)' },
  { value: 'OTRO',         label: 'Otro motivo' },
]

// Ventana para reportar un problema tras finalizar la consulta. Coincide con
// PAYMENT_HOLD_MINUTES del backend (config.py) — el backend es la fuente de
// verdad real; esto solo evita mostrar el botón cuando ya sabemos que vencerá.
const DISPUTE_WINDOW_MINUTES = 60

function disputeDeadline(consultation: Consultation): Date | null {
  if (!consultation.ended_at) return null
  const ended = new Date(consultation.ended_at.endsWith('Z') ? consultation.ended_at : consultation.ended_at + 'Z')
  return new Date(ended.getTime() + DISPUTE_WINDOW_MINUTES * 60_000)
}

function canDispute(consultation: Consultation): boolean {
  if (consultation.payment_status !== 'CONFIRMED') return false
  const deadline = disputeDeadline(consultation)
  if (!deadline) return false
  return new Date() < deadline
}

// Texto discreto con el tiempo que le queda al paciente para reportar un
// problema (p. ej. "Puedes reportar un problema por 42 min más"). No usa
// colores de alerta a propósito — es solo informativo, no algo urgente.
function timeLeftToDisputeLabel(deadline: Date, now: Date): string | null {
  const msLeft = deadline.getTime() - now.getTime()
  if (msLeft <= 0) return null
  const minutesLeft = Math.ceil(msLeft / 60_000)
  if (minutesLeft >= 60) {
    const hours = Math.floor(minutesLeft / 60)
    const mins = minutesLeft % 60
    return `Puedes reportar un problema por ${hours}h${mins ? ` ${mins}min` : ''} más`
  }
  return `Puedes reportar un problema por ${minutesLeft} min más`
}

// ── Modal "Reportar un problema" ──────────────────────
function DisputeModal({ consultation, onClose, onSave, loading, error }: {
  consultation: Consultation
  onClose: () => void
  onSave: (category: DisputeCategory, reason: string) => void
  loading?: boolean
  error?: string
}) {
  const [category, setCategory] = useState<DisputeCategory>('MALA_CALIDAD')
  const [reason, setReason] = useState('')
  const deadline = disputeDeadline(consultation)

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold">Reportar un problema</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        <p className="text-xs text-[#6B738A] mb-4">
          Esto congela el pago (Bs. {parseFloat(consultation.amount).toFixed(2)}) mientras un
          administrador revisa tu caso. El profesional no puede decidir esto por su cuenta.
          {deadline && (
            <> Tienes hasta las {deadline.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} para reportarlo.</>
          )}
        </p>

        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

        <div className="mb-4">
          <label className="label">¿Qué pasó?</label>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as DisputeCategory)}
          >
            {DISPUTE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div className="mb-5">
          <label className="label">Cuéntanos más (mínimo 10 caracteres)</label>
          <textarea
            className="input resize-none"
            rows={4}
            placeholder="Describe lo que ocurrió con el mayor detalle posible..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
          />
          <p className="text-xs text-[#A0A8BF] mt-1 text-right">{reason.length}/1000</p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1" disabled={loading}>Cancelar</button>
          <button
            onClick={() => onSave(category, reason)}
            disabled={reason.trim().length < 10 || loading}
            className="flex-1 bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Reportar problema'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function SummaryModal({ consultation, onClose }: {
  consultation: Consultation
  onClose: () => void
}) {
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">Resumen de consulta</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        <div className="space-y-3 text-sm">
          {doctorNameOf(consultation) && (
            <div className="bg-[#F5F6FA] rounded-xl p-3 flex items-center gap-3">
              <DoctorAvatar
                firstName={consultation.professional_first_name}
                lastName={consultation.professional_last_name}
                photoUrl={consultation.professional_photo_url}
              />
              <div>
                <p className="text-xs text-[#6B738A] mb-0.5">Médico</p>
                <p className="font-medium">{doctorNameOf(consultation)}</p>
              </div>
            </div>
          )}
          <div className="bg-[#F5F6FA] rounded-xl p-3">
            <p className="text-xs text-[#6B738A] mb-1">Especialidad</p>
            <p className="font-medium">{consultation.specialty || 'Consulta médica general'}</p>
          </div>
          {consultation.professional_sub_specialties && consultation.professional_sub_specialties.length > 0 && (
            <div className="bg-[#F5F6FA] rounded-xl p-3">
              <p className="text-xs text-[#6B738A] mb-1">Subespecialidad</p>
              <p className="font-medium">{consultation.professional_sub_specialties.join(', ')}</p>
            </div>
          )}
          {consultation.professional_department && (
            <div className="bg-[#F5F6FA] rounded-xl p-3">
              <p className="text-xs text-[#6B738A] mb-1">Departamento</p>
              <p className="font-medium">{consultation.professional_department}</p>
            </div>
          )}
          <div className="bg-[#F5F6FA] rounded-xl p-3">
            <p className="text-xs text-[#6B738A] mb-1">
              {consultation.consultation_type === 'SCHEDULED' ? 'Fecha de la cita' : 'Fecha'}
            </p>
            <p className="font-medium">
              {consultation.consultation_type === 'SCHEDULED' && (consultation as any).scheduled_at
                ? new Date((consultation as any).scheduled_at).toLocaleString('es-BO', {
                    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
                  })
                : fmtFecha(consultation.created_at)}
            </p>
          </div>
          {(consultation as any).outcome_note && (
            <div className="bg-[#F5F6FA] rounded-xl p-3">
              <p className="text-xs text-[#6B738A] mb-1">Detalle</p>
              <p className="font-medium text-xs">
                {outcomeLabel(consultation, 'PATIENT')}
              </p>
            </div>
          )}
          {!!consultation.duration_minutes && (
            <div className="bg-[#F5F6FA] rounded-xl p-3">
              <p className="text-xs text-[#6B738A] mb-1">Duración</p>
              <p className="font-medium">{consultation.duration_minutes} minutos</p>
            </div>
          )}
          <div className="bg-[#F5F6FA] rounded-xl p-3">
            <p className="text-xs text-[#6B738A] mb-1">Monto pagado</p>
            <p className="font-medium text-[#0F6E56]">Bs. {parseFloat(consultation.amount).toFixed(2)}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-xl p-3">
            <p className="text-xs text-[#6B738A] mb-1">Estado</p>
            <StatusBadge status={consultation.status} />
          </div>
          {(consultation as any).notes && (
            <div className="bg-[#F5F6FA] rounded-xl p-3">
              <p className="text-xs text-[#6B738A] mb-1">Notas del médico</p>
              <p className="text-sm">{(consultation as any).notes}</p>
            </div>
          )}
        </div>
        <button onClick={onClose} className="btn-secondary w-full mt-4">Cerrar</button>
      </div>
    </div>,
    document.body
  )
}

// ── Modal Ver Receta ──────────────────────────────────
function PrescriptionModal({ consultationId, onClose }: {
  consultationId: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['rx-by-consultation', consultationId],
    queryFn: async () => {
      const res = await prescriptionsAPI.getMyPatient()
      return (res as any[]).filter((p: any) => p.consultation_id === consultationId)
    },
  })

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">Recetas de esta consulta</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        {isLoading && <p className="text-sm text-[#6B738A] text-center py-6">Cargando recetas...</p>}
        {data && data.length === 0 && (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">💊</p>
            <p className="text-sm text-[#6B738A]">No hay recetas para esta consulta</p>
          </div>
        )}
        {data && data.map((rx: any) => (
          <div key={rx.id} className="border border-[#DDE1EE] rounded-xl p-4 mb-3">
            <div className="border-b border-[#DDE1EE] pb-3 mb-3">
              <p className="text-xs text-[#6B738A]">Dr./Dra.</p>
              <p className="font-semibold text-sm">{rx.professional_name || 'Médico'}</p>
              {rx.professional_specialty && <p className="text-xs text-[#6B738A]">{rx.professional_specialty}</p>}
              {rx.cmb_matricula && <p className="text-xs text-[#6B738A]">Mat. CMB: {rx.cmb_matricula}</p>}
            </div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Medicamentos</p>
            <div className="space-y-2 mb-3">
              {rx.medications?.map((m: any, i: number) => (
                <div key={i} className="bg-[#F5F6FA] rounded-lg p-2">
                  <p className="text-sm font-medium">{m.name}</p>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {m.dosage    && <span className="text-[10px] bg-[#185FA5]/10 text-[#185FA5] px-2 py-0.5 rounded-full">{m.dosage}</span>}
                    {m.frequency && <span className="text-[10px] bg-[#0F6E56]/10 text-[#0F6E56] px-2 py-0.5 rounded-full">{m.frequency}</span>}
                    {m.duration  && <span className="text-[10px] bg-[#854F0B]/10 text-[#854F0B] px-2 py-0.5 rounded-full">{m.duration}</span>}
                  </div>
                </div>
              ))}
            </div>
            {rx.instructions && (
              <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-2 mb-3">
                <p className="text-xs font-medium text-[#854F0B] mb-1">Indicaciones</p>
                <p className="text-xs">{rx.instructions}</p>
              </div>
            )}
            <div className="text-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(buildPrescriptionVerifyUrl(rx.qr_verify_code))}`}
                alt="QR Receta"
                className="mx-auto rounded-lg mb-1"
              />
              <p className="text-[10px] text-[#6B738A] font-mono">{rx.qr_verify_code}</p>
            </div>
          </div>
        ))}
        <button onClick={onClose} className="btn-secondary w-full mt-2">Cerrar</button>
      </div>
    </div>,
    document.body
  )
}

// ── Modal Ver Historia clínica ────────────────────────
function ClinicalNoteModal({ consultationId, onClose }: {
  consultationId: string
  onClose: () => void
}) {
  const { data: note, isLoading } = useQuery({
    queryKey: ['clinical-note-by-consultation', consultationId],
    queryFn: async () => {
      try {
        const res = await clinicalNotesAPI.getByConsultation(consultationId)
        return res.data
      } catch {
        return null
      }
    },
  })

  const field = (label: string, value?: string | null) =>
    value ? (
      <div className="bg-[#F5F6FA] rounded-xl p-3 mb-3">
        <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-1">{label}</p>
        <p className="text-sm whitespace-pre-wrap">{value}</p>
      </div>
    ) : null

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">Historia clínica de esta consulta</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        {isLoading && <p className="text-sm text-[#6B738A] text-center py-6">Cargando historia clínica...</p>}
        {!isLoading && !note && (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm text-[#6B738A]">No hay historia clínica para esta consulta</p>
          </div>
        )}
        {note && (
          <>
            {(note.professional_name || note.professional_specialty) && (
              <div className="border-b border-[#DDE1EE] pb-3 mb-3">
                <p className="text-xs text-[#6B738A]">Dr./Dra.</p>
                <p className="font-semibold text-sm">{note.professional_name || 'Médico'}</p>
                {note.professional_specialty && <p className="text-xs text-[#6B738A]">{note.professional_specialty}</p>}
              </div>
            )}
            {field('Motivo de consulta (Subjetivo)', note.subjective)}
            {field('Hallazgos (Objetivo)', note.objective)}
            {field('Diagnóstico (Evaluación)', note.assessment)}
            {field('Plan / Indicaciones', note.plan)}
            {!note.subjective && !note.objective && !note.assessment && !note.plan && (
              <p className="text-sm text-[#6B738A] text-center py-4">El médico aún no completó el detalle.</p>
            )}
            <p className="text-xs text-[#A0A8BF] mt-2">
              Registrada el {fmtFecha(note.created_at)}
            </p>
          </>
        )}
        <button onClick={onClose} className="btn-secondary w-full mt-4">Cerrar</button>
      </div>
    </div>,
    document.body
  )
}

// ── Página principal ──────────────────────────────────
export default function HistoryPage() {
  const qc = useQueryClient()
  const [ratingConsultation, setRatingConsultation]     = useState<Consultation | null>(null)
  const [viewRating, setViewRating]                     = useState<Rating | null>(null)
  const [summaryConsultation, setSummaryConsultation]   = useState<Consultation | null>(null)
  const [rxConsultationId, setRxConsultationId]         = useState<string | null>(null)
  const [noteConsultationId, setNoteConsultationId]     = useState<string | null>(null)
  // Reloj que se actualiza cada minuto, solo para refrescar el aviso
  // discreto de "tiempo restante para reportar" sin recargar nada más.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const [disputeConsultation, setDisputeConsultation]   = useState<Consultation | null>(null)
  const [disputeError, setDisputeError]                 = useState('')
  const [disputedIds, setDisputedIds]                   = useState<Record<string, boolean>>({})
  const [localRated, setLocalRated]                     = useState<Record<string, Rating>>({})
  const [success, setSuccess] = useState('')
  const [error, setError]     = useState('')
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'cancelled' | 'calendar'>('active')

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'patient'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
  })

  const completed = consultations.filter((c) => c.status === 'COMPLETED')
  const active    = consultations.filter((c) => !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(c.status))
  const cancelledOrRefunded = consultations.filter((c) => ['CANCELLED', 'REFUNDED'].includes(c.status))

  // Verificar calificaciones existentes para todas las consultas completadas
  // (guarda el rating completo, no solo el booleano, para poder mostrar las estrellas puestas)
  const { data: ratingChecks = {} } = useQuery({
    queryKey: ['rating-checks', completed.map(c => c.id).join(',')],
    enabled: completed.length > 0,
    queryFn: async () => {
      const results: Record<string, Rating | null> = {}
      await Promise.all(
        completed.map(async (c) => {
          try {
            const res = await ratingsAPI.check(c.id)
            results[c.id] = res.data.rating
          } catch {
            results[c.id] = null
          }
        })
      )
      return results
    },
  })

  // Verificar recetas disponibles para consultas completadas
  const { data: prescriptionsByConsultation = {} } = useQuery({
    queryKey: ['rx-check', completed.map(c => c.id).join(',')],
    enabled: completed.length > 0,
    queryFn: async () => {
      try {
        const all = await prescriptionsAPI.getMyPatient() as any[]
        const map: Record<string, boolean> = {}
        completed.forEach(c => {
          map[c.id] = all.some((rx: any) => rx.consultation_id === c.id)
        })
        return map
      } catch {
        return {}
      }
    },
  })

  // Verificar historia clínica disponible (visible al paciente) para consultas completadas
  const { data: notesByConsultation = {} } = useQuery({
    queryKey: ['clinical-note-check', completed.map(c => c.id).join(',')],
    enabled: completed.length > 0,
    queryFn: async () => {
      try {
        const all = await clinicalNotesAPI.getMyHistory().then(r => r.data)
        const map: Record<string, boolean> = {}
        completed.forEach(c => {
          map[c.id] = all.some((n: ClinicalNote) => n.consultation_id === c.id)
        })
        return map
      } catch {
        return {}
      }
    },
  })

  const ratingMutation = useMutation({
    mutationFn: ({ id, score, comment }: { id: string; score: number; comment: string }) =>
      ratingsAPI.create(id, score, comment),
    onSuccess: (res, vars) => {
      setSuccess('¡Gracias por tu calificación!')
      setRatingConsultation(null)
      setLocalRated(prev => ({ ...prev, [vars.id]: res.data }))
      qc.invalidateQueries({ queryKey: ['rating-checks'] })
      setTimeout(() => setSuccess(''), 4000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const disputeMutation = useMutation({
    mutationFn: ({ id, category, reason }: { id: string; category: DisputeCategory; reason: string }) =>
      consultationsAPI.dispute(id, category, reason),
    onSuccess: (_res, vars) => {
      setSuccess('Reportado. Un administrador revisará tu caso antes de liberar el pago.')
      setDisputedIds(prev => ({ ...prev, [vars.id]: true }))
      setDisputeConsultation(null)
      setDisputeError('')
      qc.invalidateQueries({ queryKey: ['consultations', 'patient'] })
      setTimeout(() => setSuccess(''), 5000)
    },
    onError: (err) => setDisputeError(getErrorMessage(err)),
  })

  const getRating = (id: string): Rating | null => localRated[id] || ratingChecks[id] || null
  const isRated   = (id: string) => !!getRating(id)
  const hasReceta = (id: string) => prescriptionsByConsultation[id] === true
  const hasHistoria = (id: string) => notesByConsultation[id] === true
  const isDisputed = (c: Consultation) => disputedIds[c.id] === true || c.payment_status === 'DISPUTED'

  const totalSpent = completed.reduce((sum, c) => sum + parseFloat(c.amount), 0)

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/history" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Mis consultas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Todas tus consultas y citas agendadas, en un solo lugar</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error" message={error} /></div>}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{consultations.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Total</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">{completed.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Completadas</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">Bs. {totalSpent.toFixed(0)}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Total gastado</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'active'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            En curso {active.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#E24B4A] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {active.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            Completadas {completed.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#0F6E56] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {completed.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('cancelled')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'cancelled'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            Canceladas {cancelledOrRefunded.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#6B738A] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {cancelledOrRefunded.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'calendar'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            🗓 Calendario
          </button>
        </div>

        {isLoading ? (
          <LoadingScreen text="Cargando historial..." />
        ) : consultations.length === 0 ? (
          <EmptyState
            title="Aún no tienes consultas"
            description="Cuando hagas tu primera consulta aparecerá aquí"
            action={<a href="/patient/agent" className="btn-primary text-xs">Hacer mi primera consulta</a>}
          />
        ) : activeTab === 'active' ? (
          <div className="card">
            <SectionTitle>En curso o pendientes</SectionTitle>
            {active.length === 0 ? (
              <EmptyState title="No tienes consultas activas en este momento" />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                  {active.map((c) => {
                    const doctorName = doctorNameOf(c)
                    const isScheduled = c.consultation_type === 'SCHEDULED'
                    const hasProposalPending = !!c.reschedule_proposed_at
                    return (
                      <div key={c.id} className="py-3 flex items-center gap-3">
                        <DoctorAvatar
                          firstName={c.professional_first_name}
                          lastName={c.professional_last_name}
                          photoUrl={c.professional_photo_url}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doctorName || c.specialty || 'Consulta médica'}</p>
                          <p className="text-xs text-[#6B738A] mt-0.5 truncate">
                            {doctorName && c.specialty ? `${c.specialty} · ` : ''}
                            {isScheduled && c.scheduled_at ? (
                              <>🗓 {new Date(c.scheduled_at).toLocaleString('es-BO', {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                              })}</>
                            ) : (
                              fmtFecha(c.created_at)
                            )}
                            {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                          </p>
                          {(c.professional_department || (c.professional_sub_specialties && c.professional_sub_specialties.length > 0)) && (
                            <p className="text-xs text-[#A0A8BF] mt-0.5 truncate">
                              {c.professional_department || ''}
                              {c.professional_department && c.professional_sub_specialties?.length ? ' · ' : ''}
                              {c.professional_sub_specialties?.join(', ') || ''}
                            </p>
                          )}
                          {hasProposalPending && (
                            <p className="text-xs text-[#854F0B] mt-0.5 truncate">
                              {c.reschedule_proposed_by === 'PROFESSIONAL'
                                ? 'El profesional propone otro horario — debes responder'
                                : 'Propusiste otro horario — esperando respuesta'}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={c.status} />
                        {c.status === 'WAITING_PAYMENT' && (
                          <a href={`/patient/waiting-room?consultationId=${c.id}`} className="btn-primary text-xs py-1 px-2">
                            Pagar
                          </a>
                        )}
                        {isScheduled && c.status !== 'WAITING_PAYMENT' && (
                          <a href={`/patient/waiting-room?consultationId=${c.id}`} className="btn-secondary text-xs py-1 px-2">
                            Gestionar cita
                          </a>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        ) : activeTab === 'history' ? (
          <div className="card">
            <SectionTitle>Historial de consultas completadas</SectionTitle>
            {completed.length === 0 ? (
              <p className="text-sm text-[#6B738A] text-center py-3">No hay consultas completadas aún</p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                  {completed.map((c) => {
                    const doctorName = doctorNameOf(c)
                    return (
                      <div key={c.id} className="py-3">
                        <div className="flex items-start gap-3 mb-2">
                          <DoctorAvatar
                            firstName={c.professional_first_name}
                            lastName={c.professional_last_name}
                            photoUrl={c.professional_photo_url}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{doctorName || c.specialty || 'Consulta médica'}</p>
                            <p className="text-xs text-[#6B738A] mt-0.5 truncate">
                              {doctorName && c.specialty ? `${c.specialty} · ` : ''}
                              {fmtFecha(c.created_at)}
                              {c.duration_minutes ? ` · ${c.duration_minutes} min` : ''}
                              {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                            </p>
                            {(c.started_at || c.ended_at) && (
                              <p className="text-xs text-[#A0A8BF] mt-0.5 truncate">
                                {c.started_at ? `Inició ${fmtHora(c.started_at)}` : ''}
                                {c.started_at && c.ended_at ? ' · ' : ''}
                                {c.ended_at ? `Finalizó ${fmtHora(c.ended_at)}` : ''}
                              </p>
                            )}
                            {c.chief_complaint && (
                              <p className="text-xs text-[#A0A8BF] mt-0.5 truncate" title={c.chief_complaint}>
                                Motivo: {c.chief_complaint}
                              </p>
                            )}
                            {c.outcome_note === 'PATIENT_NO_SHOW' && (
                              <p className="text-xs text-amber-600 mt-0.5 truncate">
                                {outcomeLabel(c, 'PATIENT')}
                              </p>
                            )}
                            {(c.professional_department || (c.professional_sub_specialties && c.professional_sub_specialties.length > 0)) && (
                              <p className="text-xs text-[#A0A8BF] mt-0.5 truncate">
                                {c.professional_department || ''}
                                {c.professional_department && c.professional_sub_specialties?.length ? ' · ' : ''}
                                {c.professional_sub_specialties?.join(', ') || ''}
                              </p>
                            )}
                          </div>
                          <StatusBadge status={c.status} />
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Ver resumen — siempre visible */}
                          <button
                            onClick={() => setSummaryConsultation(c)}
                            className="btn-secondary text-xs py-1 px-3"
                          >
                            📋 Ver resumen
                          </button>

                          {/* Ver receta — solo si tiene receta */}
                          {hasReceta(c.id) && (
                            <button
                              onClick={() => setRxConsultationId(c.id)}
                              className="btn-secondary text-xs py-1 px-3"
                            >
                              💊 Ver receta
                            </button>
                          )}

                          {/* Ver historia clínica — solo si tiene historia visible */}
                          {hasHistoria(c.id) && (
                            <button
                              onClick={() => setNoteConsultationId(c.id)}
                              className="btn-secondary text-xs py-1 px-3"
                            >
                              📋 Ver historia clínica
                            </button>
                          )}

                          {/* Reportar un problema — solo dentro de la ventana y si el pago sigue disponible */}
                          {isDisputed(c) ? (
                            <span className="text-xs text-[#A32D2D] font-medium">⚠️ En disputa</span>
                          ) : canDispute(c) ? (
                            <span className="flex items-center gap-2">
                              <button
                                onClick={() => { setDisputeError(''); setDisputeConsultation(c) }}
                                className="text-xs text-[#A32D2D] hover:underline font-medium"
                              >
                                ⚠️ Reportar un problema
                              </button>
                              {(() => {
                                const deadline = disputeDeadline(c)
                                const label = deadline ? timeLeftToDisputeLabel(deadline, now) : null
                                return label ? (
                                  <span className="text-[11px] text-[#A0A8BF]">· {label}</span>
                                ) : null
                              })()}
                            </span>
                          ) : null}

                          {/* Calificar — si ya calificó, mostrar estrellas puestas (clickeable) */}
                          {isRated(c.id) ? (
                            <button
                              onClick={() => setViewRating(getRating(c.id))}
                              className="ml-auto flex items-center gap-1 hover:opacity-75"
                              title="Ver tu calificación"
                            >
                              <Stars score={getRating(c.id)?.score || 0} />
                            </button>
                          ) : (
                            <button
                              onClick={() => setRatingConsultation(c)}
                              className="ml-auto text-xs text-[#185FA5] hover:underline font-medium"
                            >
                              ⭐ Calificar →
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        ) : activeTab === 'cancelled' ? (
          <div className="card">
            <SectionTitle>Canceladas o reembolsadas</SectionTitle>
            {cancelledOrRefunded.length === 0 ? (
              <EmptyState title="No tienes consultas canceladas" />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                  {cancelledOrRefunded.map((c) => {
                    const doctorName = doctorNameOf(c)
                    const who = cancelledByLabel(c)
                    const wasRefunded = wasActuallyRefunded(c)
                    return (
                      <div key={c.id} className="py-3 flex items-start gap-3">
                        <DoctorAvatar
                          firstName={c.professional_first_name}
                          lastName={c.professional_last_name}
                          photoUrl={c.professional_photo_url}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doctorName || c.specialty || 'Consulta médica'}</p>
                          <p className="text-xs text-[#6B738A] mt-0.5 truncate">
                            {c.consultation_type === 'SCHEDULED' && c.scheduled_at
                              ? `Cita agendada para ${fmtFechaHoraLocal(c.scheduled_at)}`
                              : `Solicitada ${fmtFecha(c.created_at)}`}
                            {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                          </p>
                          <p className="text-xs text-[#6B738A] mt-0.5 truncate">
                            {outcomeLabel(c, 'PATIENT')}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            {who && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#6B738A]">
                                {who}
                              </span>
                            )}
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#6B738A]">
                              {c.updated_at ? `Cancelada ${fmtFechaHora(c.updated_at)}` : ''}
                            </span>
                          </div>
                          {wasRefunded && (
                            <p className="text-xs text-emerald-600 mt-1 truncate">
                              💸 Dinero devuelto{c.payment_refunded_at ? ` el ${fmtFechaHora(c.payment_refunded_at)}` : ''}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={c.status} />
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        ) : (
          <div className="card">
            <SectionTitle>Calendario de citas</SectionTitle>
            <AppointmentsCalendar consultations={consultations} role="PATIENT" />
          </div>
        )}
      </div>

      {/* Modales */}
      {ratingConsultation && (
        <RatingModal
          consultation={ratingConsultation}
          onClose={() => setRatingConsultation(null)}
          onSave={(score, comment) =>
            ratingMutation.mutate({ id: ratingConsultation.id, score, comment })
          }
          loading={ratingMutation.isPending}
        />
      )}
      {viewRating && (
        <RatingDetailModal
          rating={viewRating}
          onClose={() => setViewRating(null)}
        />
      )}
      {disputeConsultation && (
        <DisputeModal
          consultation={disputeConsultation}
          onClose={() => { setDisputeConsultation(null); setDisputeError('') }}
          onSave={(category, reason) =>
            disputeMutation.mutate({ id: disputeConsultation.id, category, reason })
          }
          loading={disputeMutation.isPending}
          error={disputeError}
        />
      )}
      {summaryConsultation && (
        <SummaryModal
          consultation={summaryConsultation}
          onClose={() => setSummaryConsultation(null)}
        />
      )}
      {rxConsultationId && (
        <PrescriptionModal
          consultationId={rxConsultationId}
          onClose={() => setRxConsultationId(null)}
        />
      )}
      {noteConsultationId && (
        <ClinicalNoteModal
          consultationId={noteConsultationId}
          onClose={() => setNoteConsultationId(null)}
        />
      )}
    </DashboardLayout>
  )
}