'use client'
// src/app/patient/dashboard/page.tsx

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { useAuthStore } from '@/lib/store'
import { consultationsAPI, prescriptionsAPI, clinicalNotesAPI, getErrorMessage, buildPrescriptionVerifyUrl } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'
import { getGreeting } from '@/lib/greeting'
import { ModalityBadge, PaymentBadge } from '@/components/shared/ConsultationBadges'
import { useLanguage } from '@/lib/i18n/LanguageContext'

function StatusBadge({ status, createdByRole }: { status: string; createdByRole?: string | null }) {
  const map: Record<string, { cls: string; label: string }> = {
    COMPLETED:            { cls: 'badge-green', label: 'Completada' },
    IN_PROGRESS:          { cls: 'badge-blue',  label: 'En curso' },
    WAITING_PAYMENT:      { cls: 'badge-amber', label: 'Esperando pago' },
    PAYMENT_CONFIRMED:    { cls: 'badge-blue',  label: createdByRole === 'PROFESSIONAL' ? 'Cita confirmada' : 'Pago confirmado' },
    WAITING_PROFESSIONAL: { cls: 'badge-blue',  label: 'Buscando profesional' },
    CANCELLED:            { cls: 'badge-gray',  label: 'Cancelada' },
    REFUNDED:             { cls: 'badge-gray',  label: 'Reembolsada' },
    AGENT_TRIAGING:       { cls: 'badge-blue',  label: 'Con agente IA' },
  }
  const { cls, label } = map[status] || { cls: 'badge-gray', label: status }
  return <span className={cls}>{label}</span>
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

const IconClose = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>

// ── Modal Ver Receta ──────────────────────────────────
function PrescriptionModal({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const { t } = useLanguage()
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
              <p className="text-xs text-[#6B738A]">{t('Dr./Dra.')}</p>
              <p className="font-semibold text-sm">{rx.professional_name || 'Médico'}</p>
              {rx.professional_specialty && <p className="text-xs text-[#6B738A]">{rx.professional_specialty}</p>}
              {rx.cmb_matricula && <p className="text-xs text-[#6B738A]">Mat. CMB: {rx.cmb_matricula}</p>}
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
        <button onClick={onClose} className="btn-secondary w-full mt-2">{t('Cerrar')}</button>
      </div>
    </div>,
    document.body
  )
}

// ── Modal Ver Historia clínica ────────────────────────
function ClinicalNoteModal({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const { t } = useLanguage()
  const { data: note, isLoading } = useQuery({
    queryKey: ['clinical-note-by-consultation', consultationId],
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
            <p className="text-sm text-[#6B738A]">{t('No hay historia clínica para esta consulta')}</p>
          </div>
        )}
        {note && (
          <>
            {(note.professional_name || note.professional_specialty) && (
              <div className="border-b border-[#DDE1EE] pb-3 mb-3">
                <p className="text-xs text-[#6B738A]">{t('Dr./Dra.')}</p>
                <p className="font-semibold text-sm">{note.professional_name || 'Médico'}</p>
                {note.professional_specialty && <p className="text-xs text-[#6B738A]">{note.professional_specialty}</p>}
              </div>
            )}
            {field('Motivo de consulta (Subjetivo)', note.subjective)}
            {field('Hallazgos (Objetivo)', note.objective)}
            {field('Diagnóstico (Evaluación)', note.assessment)}
            {field('Plan / Indicaciones', note.plan)}
            {!note.subjective && !note.objective && !note.assessment && !note.plan && (
              <p className="text-sm text-[#6B738A] text-center py-4">{t('El médico aún no completó el detalle.')}</p>
            )}
          </>
        )}
        <button onClick={onClose} className="btn-secondary w-full mt-4">{t('Cerrar')}</button>
      </div>
    </div>,
    document.body
  )
}

export default function PatientDashboard() {
  const { t } = useLanguage()
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [cancelError, setCancelError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [rxConsultationId, setRxConsultationId] = useState<string | null>(null)
  const [noteConsultationId, setNoteConsultationId] = useState<string | null>(null)

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'patient'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    enabled: !!user,
    refetchInterval: 10000,
    staleTime: 0,
    refetchOnMount: true,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations', 'patient'] })
      setConfirmCancel(false)
      setCancelError('')
    },
    onError: (err) => setCancelError(getErrorMessage(err)),
  })

  const recent = consultations.slice(0, 3)
  const recentCompleted = recent.filter((c: any) => c.status === 'COMPLETED')

  const { data: prescriptionsByConsultation = {} } = useQuery({
    queryKey: ['rx-check', recentCompleted.map((c: any) => c.id).join(',')],
    enabled: recentCompleted.length > 0,
    queryFn: async () => {
      try {
        const all = await prescriptionsAPI.getMyPatient() as any[]
        const map: Record<string, boolean> = {}
        recentCompleted.forEach((c: any) => { map[c.id] = all.some((rx: any) => rx.consultation_id === c.id) })
        return map
      } catch { return {} }
    },
  })

  const { data: notesByConsultation = {} } = useQuery({
    queryKey: ['clinical-note-check', recentCompleted.map((c: any) => c.id).join(',')],
    enabled: recentCompleted.length > 0,
    queryFn: async () => {
      try {
        const all = await clinicalNotesAPI.getMyHistory().then(r => r.data)
        const map: Record<string, boolean> = {}
        recentCompleted.forEach((c: any) => { map[c.id] = all.some((n: ClinicalNote) => n.consultation_id === c.id) })
        return map
      } catch { return {} }
    },
  })

  const hasReceta = (id: string) => prescriptionsByConsultation[id] === true
  const hasHistoria = (id: string) => notesByConsultation[id] === true
  const activeConsultations = consultations.filter((c: any) =>
    ['WAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'WAITING_PROFESSIONAL', 'IN_PROGRESS'].includes(c.status)
  )
  const activeConsultation = activeConsultations[Math.min(activeTab, activeConsultations.length - 1)] ?? null

  const activeLabel: Record<string, string> = {
    WAITING_PAYMENT:      'Pendiente de pago QR',
    PAYMENT_CONFIRMED:    'Pago confirmado',
    WAITING_PROFESSIONAL: 'Esperando confirmación del profesional',
    IN_PROGRESS:          'Tu consulta está en progreso',
  }

  const typeLabel = (c: any) =>
    c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP'
      ? `🗓 ${c.consultation_type === 'FOLLOW_UP' ? 'Seguimiento' : 'Cita agendada'}${c.scheduled_at ? ' · ' + new Date(c.scheduled_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`
      : '⚡ Consulta inmediata'

  // Solo se puede cancelar antes del pago confirmado
  const canCancel = activeConsultation &&
    ['WAITING_PAYMENT', 'WAITING_PROFESSIONAL'].includes(activeConsultation.status)

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/dashboard" role="PATIENT">
      <div className="max-w-3xl">

        <div className="mb-5">
          <h1 className="text-lg font-semibold text-[#141820]">
            {getGreeting()}{user?.first_name ? `, ${user.first_name}` : ''} 👋
          </h1>
          <p className="text-sm text-[#6B738A] mt-0.5">{t('¿Cómo te sientes hoy?')}</p>
        </div>

        {/* Banner consultas activas — pestañas si hay más de una */}
        {activeConsultations.length > 0 && (
          <div className="bg-[#E6F1FB] border border-[#85B7EB] rounded-xl p-4 mb-5">

            {/* Pestañas — solo se muestran si hay más de una activa */}
            {activeConsultations.length > 1 && (
              <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                {activeConsultations.map((c: any, i: number) => (
                  <button
                    key={c.id}
                    onClick={() => { setActiveTab(i); setConfirmCancel(false); setCancelError('') }}
                    className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                      activeTab === i
                        ? 'bg-[#185FA5] text-white'
                        : 'bg-white text-[#185FA5] border border-[#85B7EB] hover:bg-[#d4e8f7]'
                    }`}
                  >
                    {c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP'
                      ? `🗓 ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short' }) : 'Cita'}`
                      : '⚡ Inmediata'}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#0C447C]">
                  {activeConsultations.length > 1 ? `${activeConsultations.length} consultas activas` : 'Tienes una consulta en curso'}
                </p>
                <p className="text-xs text-[#185FA5] mt-0.5">
                  {typeLabel(activeConsultation)} · {activeLabel[activeConsultation.status] || ''}
                  {activeConsultation.specialty ? ` · ${activeConsultation.specialty}` : ''}
                </p>
              </div>
              <Link
                href={
                  activeConsultation.status === 'IN_PROGRESS'
                    ? `/patient/video?cid=${activeConsultation.id}`
                    : `/patient/waiting-room?consultationId=${activeConsultation.id}`
                }
                className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap flex-shrink-0"
              >
                {activeConsultation.status === 'IN_PROGRESS' ? '📹 Volver a llamada' : 'Continuar →'}
              </Link>
            </div>

            {/* Cancelar */}
            {canCancel && (
              <div className="mt-3 pt-3 border-t border-[#85B7EB]">
                {cancelError && (
                  <p className="text-xs text-[#A32D2D] mb-2">{cancelError}</p>
                )}
                {!confirmCancel ? (
                  <button
                    onClick={() => setConfirmCancel(true)}
                    className="text-xs text-[#A32D2D] hover:underline"
                  >
                    {t('Cancelar esta consulta')}
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-[#A32D2D] font-medium">{t('¿Seguro que quieres cancelar?')}</p>
                    <button
                      onClick={() => cancelMutation.mutate(activeConsultation.id)}
                      disabled={cancelMutation.isPending}
                      className="text-xs bg-[#A32D2D] text-white px-3 py-1 rounded-lg hover:bg-[#7a1f1f] disabled:opacity-60"
                    >
                      {cancelMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
                    </button>
                    <button
                      onClick={() => { setConfirmCancel(false); setCancelError('') }}
                      className="text-xs text-[#6B738A] hover:underline"
                    >
                      {t('No, volver')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Acciones rápidas — solo si no hay consulta activa */}
        {!activeConsultation && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <Link href="/patient/agent" className="block">
              <div className="bg-[#185FA5] rounded-xl p-4 hover:bg-[#0C447C] transition-colors">
                <p className="text-white/70 text-xs mb-1">{t('No sé qué especialista necesito')}</p>
                <p className="text-white font-semibold text-sm mb-3">{t('Consultar con el Agente IA')}</p>
                <div className="bg-white/15 rounded-full px-3 py-1.5 w-fit">
                  <p className="text-white text-xs">{t('Hablar con Medi →')}</p>
                </div>
              </div>
            </Link>
            <Link href="/patient/search" className="block">
              <div className="bg-[#0F6E56] rounded-xl p-4 hover:bg-[#085041] transition-colors">
                <p className="text-white/70 text-xs mb-1">{t('Ya sé qué necesito')}</p>
                <p className="text-white font-semibold text-sm mb-3">{t('Buscar profesional directo')}</p>
                <div className="bg-white/15 rounded-full px-3 py-1.5 w-fit">
                  <p className="text-white text-xs">{t('Ver disponibles →')}</p>
                </div>
              </div>
            </Link>
          </div>
        )}

        {/* Acceso directo al calendario de citas */}
        <Link
          href="/patient/history?tab=calendar"
          className="flex items-center justify-between bg-white border border-[#DDE1EE] rounded-xl p-3 mb-5 hover:bg-[#F9FAFC] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-[#E6F1FB] flex items-center justify-center text-base flex-shrink-0">
              🗓️
            </span>
            <div>
              <p className="text-xs font-semibold text-[#141820]">{t('Calendario de citas agendadas')}</p>
              <p className="text-[11px] text-[#6B738A]">{t('Mira tus citas agendadas por día, semana o mes')}</p>
            </div>
          </div>
          <span className="text-[#185FA5] text-xs font-medium">{t('Abrir →')}</span>
        </Link>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{consultations.length}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('Consultas totales')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#1D9E75]">
              {consultations.filter((c) => c.status === 'COMPLETED').length}
            </p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('Completadas')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">
              {consultations.filter((c) => c.status === 'WAITING_PAYMENT').length}
            </p>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('Pendientes')}</p>
          </div>
        </div>

        {/* Consultas recientes */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{t('Consultas recientes')}</h2>
            <Link href="/patient/history" className="text-xs text-[#185FA5] hover:underline">
              {t('Ver todas →')}
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-14 bg-[#F5F6FA] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-[#6B738A]">{t('Aún no tienes consultas')}</p>
              <Link href="/patient/agent" className="btn-primary inline-block mt-3 text-xs">
                {t('Hacer mi primera consulta')}
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[#DDE1EE]">
              {recent.map((c) => {
                const doctorName = c.professional_first_name
                  ? `Dr. ${c.professional_first_name} ${c.professional_last_name || ''}`.trim()
                  : null
                return (
                  <div key={c.id} className="py-3 flex items-center gap-3">
                    <DoctorAvatar
                      firstName={c.professional_first_name}
                      lastName={c.professional_last_name}
                      photoUrl={c.professional_photo_url}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {doctorName || c.specialty || 'Consulta médica'}
                      </p>
                      <p className="text-xs text-[#6B738A] mt-0.5 truncate">
                        {doctorName && c.specialty ? `${c.specialty} · ` : ''}
                        {new Date(c.created_at).toLocaleDateString('es-BO', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                        {' · '}Bs. {parseFloat(c.amount).toFixed(2)}
                      </p>
                      {(c.professional_department || (c.professional_sub_specialties && c.professional_sub_specialties.length > 0)) && (
                        <p className="text-xs text-[#A0A8BF] mt-0.5 truncate">
                          {c.professional_department || ''}
                          {c.professional_department && c.professional_sub_specialties?.length ? ' · ' : ''}
                          {c.professional_sub_specialties?.join(', ') || ''}
                        </p>
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
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <StatusBadge status={c.status} createdByRole={c.created_by_role} />
                      {c.created_by_role === 'PROFESSIONAL' && <ModalityBadge consultation={c} />}
                      <PaymentBadge consultation={c} viewerRole="PATIENT" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
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