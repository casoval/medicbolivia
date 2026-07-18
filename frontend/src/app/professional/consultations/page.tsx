'use client'
// src/app/professional/consultations/page.tsx
// Lista de consultas del profesional

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, SectionTitle, Alert } from '@/components/ui'
import { PaymentBadge } from '@/components/shared/ConsultationBadges'
import { PatientHistoryPanel } from '@/components/professional/PatientHistoryPanel'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { consultationsAPI, prescriptionsAPI, clinicalNotesAPI, getErrorMessage } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'
import { outcomeLabel, cancelledByLabel, fmtFechaHora, fmtFechaHoraLocal, fmtHora, wasActuallyRefunded } from '@/lib/consultationHistory'
import { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// Nombre e iniciales del paciente, para que el profesional tenga registro de quién fue cada consulta
function patientNameOf(c: any): string | null {
  return c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : null
}

const IconClose = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>

// ── Modal Ver Receta (emitida por mí) ─────────────────
function PrescriptionModal({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const { t } = useLanguage()
  const { data, isLoading } = useQuery({
    queryKey: ['rx-by-consultation-pro', consultationId],
    queryFn: async () => {
      const res = await prescriptionsAPI.getMy()
      return (res as any[]).filter((p: any) => p.consultation_id === consultationId)
    },
  })
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">{t('Recetas de esta consulta')}</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        {isLoading && <p className="text-sm text-[#6B738A] text-center py-6">{t('Cargando recetas...')}</p>}
        {data && data.length === 0 && (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">💊</p>
            <p className="text-sm text-[#6B738A]">{t('No hay recetas para esta consulta')}</p>
          </div>
        )}
        {data && data.map((rx: any) => (
          <div key={rx.id} className="border border-[#DDE1EE] rounded-xl p-4 mb-3">
            <div className="border-b border-[#DDE1EE] pb-3 mb-3">
              <p className="text-xs text-[#6B738A]">{t('Paciente')}</p>
              <p className="font-semibold text-sm">{rx.patient_name || 'Paciente'}</p>
              {rx.patient_age != null && <p className="text-xs text-[#6B738A]">{rx.patient_age} años{rx.patient_ci ? ` · CI ${rx.patient_ci}` : ''}</p>}
            </div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">{t('Medicamentos')}</p>
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
                <p className="text-xs font-medium text-[#854F0B] mb-1">{t('Indicaciones')}</p>
                <p className="text-xs">{rx.instructions}</p>
              </div>
            )}
            {rx.status === 'VOIDED' && (
              <p className="text-xs text-[#A32D2D] font-medium">Receta anulada{rx.void_reason ? `: ${rx.void_reason}` : ''}</p>
            )}
          </div>
        ))}
        <button onClick={onClose} className="btn-secondary w-full mt-2">{t('Cerrar')}</button>
      </div>
    </div>,
    document.body
  )
}

// ── Modal Ver Historia clínica (escrita por mí) ───────
function ClinicalNoteModal({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const { t } = useLanguage()
  const { data: note, isLoading } = useQuery({
    queryKey: ['clinical-note-by-consultation-pro', consultationId],
    queryFn: async () => {
      try {
        const res = await clinicalNotesAPI.getByConsultation(consultationId)
        return res.data
      } catch { return null }
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
          <h3 className="text-base font-semibold">{t('Historia clínica de esta consulta')}</h3>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        {isLoading && <p className="text-sm text-[#6B738A] text-center py-6">{t('Cargando historia clínica...')}</p>}
        {!isLoading && !note && (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm text-[#6B738A]">{t('Aún no registraste historia clínica para esta consulta')}</p>
          </div>
        )}
        {note && (
          <>
            {note.patient_name && (
              <div className="border-b border-[#DDE1EE] pb-3 mb-3">
                <p className="text-xs text-[#6B738A]">{t('Paciente')}</p>
                <p className="font-semibold text-sm">{note.patient_name}</p>
              </div>
            )}
            {field('Motivo de consulta (Subjetivo)', note.subjective)}
            {field('Hallazgos (Objetivo)', note.objective)}
            {field('Diagnóstico (Evaluación)', note.assessment)}
            {field('Plan / Indicaciones', note.plan)}
            {!note.subjective && !note.objective && !note.assessment && !note.plan && (
              <p className="text-sm text-[#6B738A] text-center py-4">{t('Aún no completaste el detalle.')}</p>
            )}
          </>
        )}
        <button onClick={onClose} className="btn-secondary w-full mt-4">{t('Cerrar')}</button>
      </div>
    </div>,
    document.body
  )
}

function AwaitingPatientPaymentTimer({ acceptedAt }: { acceptedAt: string }) {
  const { t } = useLanguage()
  const PAYMENT_TIMEOUT_SECS = 5 * 60
  const [secsLeft, setSecsLeft] = useState(PAYMENT_TIMEOUT_SECS)
  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(acceptedAt + 'Z').getTime()) / 1000)
      setSecsLeft(Math.max(0, PAYMENT_TIMEOUT_SECS - elapsed))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [acceptedAt])

  const mins = Math.floor(secsLeft / 60)
  const s = secsLeft % 60
  const isUrgent  = secsLeft <= 60
  const isWarning = secsLeft <= 120

  if (secsLeft === 0) return <span className="text-xs text-[#E24B4A] font-semibold">{t('Tiempo agotado')}</span>
  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold
      ${isUrgent ? 'bg-[#FCEBEB] text-[#E24B4A] animate-pulse' :
        isWarning ? 'bg-[#FAEEDA] text-[#854F0B]' :
                    'bg-[#FFF8EC] text-[#B97A00]'}`}>
      <span>{isUrgent ? '🔴' : '⏳'}</span>
      <span>{mins}:{s.toString().padStart(2, '0')}</span>
    </div>
  )
}

export default function ConsultationsPage() {
  const { t } = useLanguage()
  const qc = useQueryClient()
  const router = useRouter()
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending')
  const [rxConsultationId, setRxConsultationId] = useState<string | null>(null)
  const [noteConsultationId, setNoteConsultationId] = useState<string | null>(null)

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    refetchInterval: 10000,
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.acceptConsultation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.rejectConsultation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      consultationsAPI.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  const startVideoMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.startVideo(id),
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      const url = `/professional/video?token=${encodeURIComponent(data.token)}&lk=${encodeURIComponent(data.livekit_url)}&room=${encodeURIComponent(data.room_name)}&cid=${id}`
      router.push(url)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const incomingImmediate = consultations.filter((c: any) =>
    c.status === 'WAITING_PROFESSIONAL' && c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP'
  )
  const readyImmediate = consultations.filter((c: any) =>
    c.status === 'PAYMENT_CONFIRMED' && c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP'
  )
  const waitingPayment = consultations.filter((c: any) =>
    c.status === 'WAITING_PAYMENT' && c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP'
  )
  const active = consultations.filter((c) => c.status === 'IN_PROGRESS' && (c as any).consultation_type !== 'SCHEDULED' && (c as any).consultation_type !== 'FOLLOW_UP')
  const pending = [...incomingImmediate, ...waitingPayment, ...readyImmediate]
  // Historial separado: las citas agendadas tienen su propio historial en "Citas agendadas".
  const history = consultations.filter((c: any) =>
    ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(c.status) &&
    c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP'
  )
  const completedHistory = history.filter((c: any) => c.status === 'COMPLETED')
  const cancelledHistory = history.filter((c: any) => c.status !== 'COMPLETED')

  const { data: prescriptionsByConsultation = {} } = useQuery({
    queryKey: ['rx-check-pro', completedHistory.map((c: any) => c.id).join(',')],
    enabled: completedHistory.length > 0,
    queryFn: async () => {
      try {
        const all = await prescriptionsAPI.getMy() as any[]
        const map: Record<string, boolean> = {}
        completedHistory.forEach((c: any) => { map[c.id] = all.some((rx: any) => rx.consultation_id === c.id) })
        return map
      } catch { return {} }
    },
  })

  const { data: notesByConsultation = {} } = useQuery({
    queryKey: ['clinical-note-check-pro', completedHistory.map((c: any) => c.id).join(',')],
    enabled: completedHistory.length > 0,
    queryFn: async () => {
      try {
        const all = await clinicalNotesAPI.getMyWrittenNotes().then(r => r.data)
        const map: Record<string, boolean> = {}
        completedHistory.forEach((c: any) => { map[c.id] = all.some((n: ClinicalNote) => n.consultation_id === c.id) })
        return map
      } catch { return {} }
    },
  })

  const hasReceta = (id: string) => prescriptionsByConsultation[id] === true
  const hasHistoria = (id: string) => notesByConsultation[id] === true

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/consultations" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Consultas inmediatas')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">{t('Solicitudes bajo demanda, activas e historial. Las citas agendadas se gestionan en "Citas agendadas"')}</p>
        </div>

        {error && (
          <div className="mb-4">
            <Alert type="error" message={error} />
          </div>
        )}

        {/* Stats rápidas */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#E24B4A]">{pending.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('En espera')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{active.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('En curso')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">{completedHistory.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('Completadas')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#6B738A]">{cancelledHistory.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('Canceladas')}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'pending'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            Pendientes {pending.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#E24B4A] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {pending.length}
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
            {t('Historial')}
          </button>
        </div>

        {isLoading ? (
          <LoadingScreen text="Cargando consultas..." />
        ) : activeTab === 'pending' ? (
          <div className="card">
            {/* Activas */}
            {active.length > 0 && (
              <>
                <SectionTitle>{t('En curso ahora')}</SectionTitle>
                <div className="divide-y divide-[#DDE1EE] mb-4">
                  {active.map((c) => (
                    <div key={c.id} className="py-3 flex items-center gap-3">
                      <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                        <p className="text-xs text-[#6B738A]">
                          {c.specialty ? `${c.specialty} · ` : ''}
                          Iniciada {new Date(c.started_at || c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                          {' · '}Bs. {parseFloat(c.professional_earning).toFixed(2)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={c.status} createdByRole={c.created_by_role} />
                        <PaymentBadge consultation={c} viewerRole="PROFESSIONAL" />
                      </div>
                      <button
                        onClick={() => updateMutation.mutate({ id: c.id, status: 'COMPLETED' })}
                        className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] text-xs px-3 py-1.5 rounded-lg"
                      >
                        {t('Finalizar')}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Solicitudes inmediatas esperando aceptar/rechazar */}
            {incomingImmediate.length > 0 && (
              <>
                <SectionTitle>{t('Solicitudes inmediatas nuevas')}</SectionTitle>
                <div className="divide-y divide-[#DDE1EE] mb-4">
                  {incomingImmediate.map((c) => (
                    <div key={c.id} className="py-3">
                      <div className="flex items-center gap-3">
                        <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} colorClasses="bg-[#FCEBEB] text-[#E24B4A]" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                          <p className="text-xs text-[#6B738A]">
                            {c.specialty ? `${c.specialty} · ` : ''}Bs. {parseFloat(c.amount).toFixed(2)}
                          </p>
                        </div>
                        <span className="badge-amber text-[10px]">{t('Tienes 2 min')}</span>
                      </div>
                      {c.chief_complaint && (
                        <div className="ml-12 mt-2 bg-[#F5F6FA] rounded-lg px-3 py-2">
                          <p className="text-xs text-[#A0A8BF] mb-0.5">{t('Motivo de la consulta')}</p>
                          <p className="text-xs text-[#141820]">{c.chief_complaint}</p>
                        </div>
                      )}
                      {c.patient_id && (
                        <PatientHistoryPanel
                          patientId={c.patient_id}
                          patientName={patientNameOf(c)}
                          currentConsultationId={c.id}
                        />
                      )}
                      <div className="flex gap-2 mt-2 ml-12">
                        <button
                          onClick={() => acceptMutation.mutate(c.id)}
                          disabled={acceptMutation.isPending}
                          className="flex-1 py-1.5 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                        >
                          {t('✓ Aceptar')}
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(c.id)}
                          disabled={rejectMutation.isPending}
                          className="py-1.5 px-4 bg-[#F5F6FA] hover:bg-[#DDE1EE] text-[#6B738A] text-xs font-medium rounded-lg transition-colors"
                        >
                          {t('Rechazar')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Esperando pago del paciente */}
            {waitingPayment.length > 0 && (
              <>
                <SectionTitle>{t('⏳ Esperando pago del paciente')}</SectionTitle>
                <div className="divide-y divide-[#DDE1EE] mb-4">
                  {waitingPayment.map((c: any) => (
                    <div key={c.id} className="py-3">
                      <div className="flex items-center gap-3">
                        <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} colorClasses="bg-[#F5E6C8] text-[#B97A00]" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                          <p className="text-xs text-[#6B738A]">
                            {c.specialty ? `${c.specialty} · ` : ''}Bs. {parseFloat(c.amount).toFixed(2)}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="badge-yellow text-[10px]">{t('Esperando pago')}</span>
                            {c.updated_at && <AwaitingPatientPaymentTimer acceptedAt={c.updated_at} />}
                          </div>
                          {c.chief_complaint && (
                            <p className="text-xs text-[#6B738A] mt-1 italic">"{c.chief_complaint}"</p>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#B97A00] mt-2 ml-12 bg-[#FFF8EC] rounded px-2 py-1.5">
                        {t('💳 El paciente está completando el pago QR. Recibirás una notificación cuando se confirme.')}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Pagadas — inmediatas listas para iniciar */}
            {readyImmediate.length > 0 && (
              <>
                <SectionTitle>{t('Listas para atender')}</SectionTitle>
                <div className="divide-y divide-[#DDE1EE] mb-4">
                  {readyImmediate.map((c) => (
                    <div key={c.id} className="py-3">
                      <div className="flex items-center gap-3">
                        <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                          <p className="text-xs text-[#6B738A]">
                            {c.specialty ? `${c.specialty} · ` : ''}
                            {new Date(c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                            {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                          </p>
                          <div className="flex gap-2 mt-1">
                            <span className="badge-green text-[10px]">{t('Pago confirmado')}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => startVideoMutation.mutate(c.id)}
                          disabled={startVideoMutation.isPending}
                          className="bg-[#185FA5] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#0C447C] transition-colors disabled:opacity-60"
                        >
                          {startVideoMutation.isPending ? 'Iniciando...' : '📹 Iniciar consulta'}
                        </button>
                      </div>
                      {c.chief_complaint && (
                        <div className="ml-12 mt-2 bg-[#F5F6FA] rounded-lg px-3 py-2">
                          <p className="text-xs text-[#A0A8BF] mb-0.5">{t('Motivo de la consulta')}</p>
                          <p className="text-xs text-[#141820]">{c.chief_complaint}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {active.length === 0 && incomingImmediate.length === 0 && waitingPayment.length === 0 && readyImmediate.length === 0 && (
              <EmptyState
                title="No hay consultas pendientes por ahora"
                description="Las solicitudes inmediatas de pacientes aparecerán aquí. Las citas agendadas se gestionan en 'Citas agendadas'."
              />
            )}
          </div>
        ) : (
          /* Historial */
          <div className="card">
            <SectionTitle>{t('Historial de consultas')}</SectionTitle>
            {history.length === 0 ? (
              <EmptyState
                title="No hay consultas completadas aún"
                description="Aparecerán aquí una vez que finalices tus primeras consultas"
              />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {history.map((c) => {
                  const isCancelled = c.status === 'CANCELLED' || c.status === 'REFUNDED'
                  const who = isCancelled ? cancelledByLabel(c) : null
                  const wasRefunded = wasActuallyRefunded(c)
                  return (
                    <div key={c.id} className="py-3 flex items-start gap-3">
                      <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} colorClasses="bg-[#F5F6FA] text-[#6B738A]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{patientNameOf(c) || c.specialty || 'Consulta'}</p>
                        <p className="text-xs text-[#6B738A] truncate">
                          {c.specialty ? `${c.specialty} · ` : ''}
                          {(c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP') && c.scheduled_at
                            ? fmtFechaHoraLocal(c.scheduled_at)
                            : new Date(c.created_at + (c.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString('es-BO', {
                                day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz'
                              })}
                          {!isCancelled && !!c.duration_minutes && ` · ${c.duration_minutes} min`}
                          {' · '}Bs. {parseFloat(c.professional_earning).toFixed(2)}
                        </p>
                        {!isCancelled && (c.started_at || c.ended_at) && (
                          <p className="text-xs text-[#A0A8BF] mt-0.5 truncate">
                            {c.started_at ? `Inició ${fmtHora(c.started_at)}` : ''}
                            {c.started_at && c.ended_at ? ' · ' : ''}
                            {c.ended_at ? `Finalizó ${fmtHora(c.ended_at)}` : ''}
                          </p>
                        )}
                        {!isCancelled && c.chief_complaint && (
                          <p className="text-xs text-[#A0A8BF] mt-0.5 truncate" title={c.chief_complaint}>
                            Motivo: {c.chief_complaint}
                          </p>
                        )}
                        {!isCancelled && c.payment_status === 'DISPUTED' && (
                          <p className="text-xs text-[#A32D2D] font-medium mt-1">
                            {t('⚠️ El paciente reportó un problema — un admin está revisando el pago')}
                          </p>
                        )}
                        {isCancelled && (
                          <>
                            <p className="text-xs text-[#6B738A] mt-0.5 truncate">
                              {outcomeLabel(c, 'PROFESSIONAL')}
                            </p>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              {who && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#6B738A]">
                                  {who}
                                </span>
                              )}
                              {c.updated_at && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#6B738A]">
                                  Cancelada {fmtFechaHora(c.updated_at)}
                                </span>
                              )}
                            </div>
                            {wasRefunded && (
                              <p className="text-xs text-emerald-600 mt-1 truncate">
                                💸 Reembolsada al paciente{c.payment_refunded_at ? ` el ${fmtFechaHora(c.payment_refunded_at)}` : ''}
                              </p>
                            )}
                          </>
                        )}
                        {(hasReceta(c.id) || hasHistoria(c.id)) && (
                          <div className="flex items-center gap-2 flex-wrap mt-1.5">
                            {hasReceta(c.id) && (
                              <button
                                onClick={() => setRxConsultationId(c.id)}
                                className="btn-secondary text-xs py-1 px-3"
                              >
                                {t('💊 Ver receta')}
                              </button>
                            )}
                            {hasHistoria(c.id) && (
                              <button
                                onClick={() => setNoteConsultationId(c.id)}
                                className="btn-secondary text-xs py-1 px-3"
                              >
                                {t('📋 Ver historia clínica')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={c.status} createdByRole={c.created_by_role} />
                        <PaymentBadge consultation={c} viewerRole="PROFESSIONAL" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {rxConsultationId && (
        <PrescriptionModal consultationId={rxConsultationId} onClose={() => setRxConsultationId(null)} />
      )}
      {noteConsultationId && (
        <ClinicalNoteModal consultationId={noteConsultationId} onClose={() => setNoteConsultationId(null)} />
      )}
    </DashboardLayout>
  )
}