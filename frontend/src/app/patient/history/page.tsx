'use client'
// src/app/patient/history/page.tsx
// Historial de consultas del paciente con calificación post-consulta

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { StatusBadge, Stars, StarPicker, LoadingScreen, EmptyState, Alert, SectionTitle } from '@/components/ui'
import { consultationsAPI, ratingsAPI, getErrorMessage } from '@/lib/api'
import type { Consultation } from '@/types'

const IconHome   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconBot    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconClock  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>

const NAV = [
  { label: 'Inicio',         href: '/patient/dashboard',    icon: <IconHome /> },
  { label: 'Buscar médico',  href: '/patient/search',       icon: <IconSearch /> },
  { label: 'Agente IA',      href: '/patient/agent',        icon: <IconBot /> },
  { label: 'Sala de espera', href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas',  href: '/patient/history',      icon: <IconFile /> },
]

// ── Modal de calificación ─────────────────────────────
function RatingModal({ consultation, onClose, onSave }: {
  consultation: Consultation
  onClose: () => void
  onSave: (score: number, comment: string) => void
}) {
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-fade-up">
        <h3 className="text-base font-semibold mb-1">Califica tu consulta</h3>
        <p className="text-xs text-[#6B738A] mb-4">
          {new Date(consultation.created_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'long' })}
          {' · '}Bs. {parseFloat(consultation.amount).toFixed(2)}
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
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => onSave(score, comment)}
            disabled={score === 0}
            className="btn-primary flex-1"
          >
            Enviar calificación
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HistoryPage() {
  const qc = useQueryClient()
  const [ratingConsultation, setRatingConsultation] = useState<Consultation | null>(null)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'patient'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
  })

  const ratingMutation = useMutation({
    mutationFn: ({ id, score, comment }: { id: string; score: number; comment: string }) =>
      ratingsAPI.create(id, score, comment),
    onSuccess: () => {
      setSuccess('¡Gracias por tu calificación!')
      setRatingConsultation(null)
      qc.invalidateQueries({ queryKey: ['consultations'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const totalSpent = consultations
    .filter((c) => c.status === 'COMPLETED')
    .reduce((sum, c) => sum + parseFloat(c.amount), 0)

  const completed = consultations.filter((c) => c.status === 'COMPLETED')
  const active = consultations.filter((c) => !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(c.status))

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/history" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Mis consultas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Historial completo de atenciones médicas</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

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

        {isLoading ? (
          <LoadingScreen text="Cargando historial..." />
        ) : consultations.length === 0 ? (
          <EmptyState
            title="Aún no tienes consultas"
            description="Cuando hagas tu primera consulta aparecerá aquí"
            action={<a href="/patient/agent" className="btn-primary text-xs">Hacer mi primera consulta</a>}
          />
        ) : (
          <div className="space-y-3">
            {/* Activas primero */}
            {active.length > 0 && (
              <div className="card">
                <SectionTitle>En curso o pendientes</SectionTitle>
                <div className="divide-y divide-[#DDE1EE]">
                  {active.map((c) => (
                    <div key={c.id} className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{c.specialty || 'Consulta médica'}</p>
                        <p className="text-xs text-[#6B738A] mt-0.5">
                          {new Date(c.created_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                        </p>
                      </div>
                      <StatusBadge status={c.status} />
                      {c.status === 'WAITING_PAYMENT' && (
                        <a href={`/patient/waiting-room?consultationId=${c.id}`} className="btn-primary text-xs py-1 px-2">
                          Pagar
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historial completo */}
            <div className="card">
              <SectionTitle>Historial</SectionTitle>
              {completed.length === 0 ? (
                <p className="text-sm text-[#6B738A] text-center py-3">No hay consultas completadas aún</p>
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {completed.map((c) => (
                    <div key={c.id} className="py-3">
                      <div className="flex items-start gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{c.specialty || 'Consulta médica'}</p>
                          <p className="text-xs text-[#6B738A] mt-0.5">
                            {new Date(c.created_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' })}
                            {c.duration_minutes && ` · ${c.duration_minutes} min`}
                            {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                          </p>
                        </div>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button className="btn-secondary text-xs py-1 px-2">Ver resumen</button>
                        <button className="btn-secondary text-xs py-1 px-2">Ver receta</button>
                        <button
                          onClick={() => setRatingConsultation(c)}
                          className="text-xs text-[#185FA5] hover:underline ml-auto"
                        >
                          Calificar →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal de calificación */}
      {ratingConsultation && (
        <RatingModal
          consultation={ratingConsultation}
          onClose={() => setRatingConsultation(null)}
          onSave={(score, comment) =>
            ratingMutation.mutate({ id: ratingConsultation.id, score, comment })
          }
        />
      )}
    </DashboardLayout>
  )
}
