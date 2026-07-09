'use client'
// src/app/professional/appointments/page.tsx
// Vista dedicada: TODAS las citas agendadas del profesional, pasadas y futuras,
// en un solo lugar (separado de las consultas inmediatas).

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, SectionTitle, Alert } from '@/components/ui'
import { consultationsAPI, getErrorMessage } from '@/lib/api'
import { outcomeLabel, cancelledByLabel, fmtFechaHora, fmtFechaHoraLocal, wasActuallyRefunded } from '@/lib/consultationHistory'
import { PatientHistoryPanel } from '@/components/professional/PatientHistoryPanel'
import { SpanishDateTimePicker } from '@/components/ui/SpanishDateTimePicker'
import { AppointmentsCalendar } from '@/components/shared/AppointmentsCalendar'

function patientNameOf(c: any): string | null {
  return c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : null
}
function patientInitials(c: any): string {
  const fn = c.patient_first_name?.[0] || ''
  const ln = c.patient_last_name?.[0] || ''
  return (fn + ln).toUpperCase() || 'P'
}

// Cuenta regresiva para aceptar/rechazar una cita agendada. El plazo real
// es el MENOR entre "24h desde que se pidió" y "30 minutos antes de la
// hora de la cita" (mismo cálculo que usa el backend al crear la consulta).
const PROFESSIONAL_RESPONSE_CUTOFF_BEFORE_APPOINTMENT_MINUTES = 30
function ScheduledAcceptDeadlineTimer({ createdAt, scheduledAt }: { createdAt: string; scheduledAt?: string | null }) {
  const [secs, setSecs] = useState(0)
  const [limitedByAppointment, setLimitedByAppointment] = useState(false)
  useEffect(() => {
    const responseDeadline = new Date((createdAt.endsWith('Z') ? createdAt : createdAt + 'Z')).getTime() + 24 * 60 * 60 * 1000
    const appointmentCutoff = scheduledAt
      ? new Date(scheduledAt).getTime() - PROFESSIONAL_RESPONSE_CUTOFF_BEFORE_APPOINTMENT_MINUTES * 60 * 1000
      : null
    const deadline = appointmentCutoff !== null && appointmentCutoff < responseDeadline ? appointmentCutoff : responseDeadline
    setLimitedByAppointment(appointmentCutoff !== null && appointmentCutoff < responseDeadline)
    const tick = () => setSecs(Math.max(0, Math.floor((deadline - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [createdAt, scheduledAt])

  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const isUrgent = secs > 0 && secs <= 3600

  if (secs <= 0) {
    return (
      <span className="text-xs text-[#A0A8BF] ml-12">
        {limitedByAppointment ? 'Cita muy próxima — ya no se puede responder' : 'Plazo vencido'}
      </span>
    )
  }

  return (
    <span className={`text-xs font-mono font-bold ml-12 ${isUrgent ? 'text-[#E24B4A]' : 'text-[#854F0B]'}`}>
      Plazo: {days > 0 && `${days}d `}{hours.toString().padStart(2, '0')}h {mins.toString().padStart(2, '0')}m {s.toString().padStart(2, '0')}s
    </span>
  )
}

export default function ProfessionalAppointmentsPage() {
  const qc = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'calendar'>(
    searchParams.get('tab') === 'calendar' ? 'calendar' : 'upcoming'
  )
  const [reschedulingId, setReschedulingId] = useState<string | null>(null)
  const [newDateTime, setNewDateTime] = useState('')

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    refetchInterval: 15000,
  })

  const scheduled = consultations.filter((c: any) => c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP')
  const upcoming = scheduled.filter((c: any) =>
    !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(c.status)
  ).sort((a: any, b: any) => new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime())
  const past = scheduled.filter((c: any) =>
    ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(c.status)
  ).sort((a: any, b: any) => new Date(b.scheduled_at || 0).getTime() - new Date(a.scheduled_at || 0).getTime())

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
  const startVideoMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.startVideo(id),
    onSuccess: (data, id) => {
      const url = `/professional/video?token=${encodeURIComponent(data.token)}&lk=${encodeURIComponent(data.livekit_url)}&room=${encodeURIComponent(data.room_name)}&cid=${id}`
      router.push(url)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })
  const respondRescheduleMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'ACCEPT' | 'REJECT' }) =>
      consultationsAPI.respondReschedule(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })
  const proposeRescheduleMutation = useMutation({
    mutationFn: ({ id, newScheduledAt }: { id: string; newScheduledAt: string }) =>
      consultationsAPI.proposeReschedule(id, newScheduledAt),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      setReschedulingId(null)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })
  const noShowPatientMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.reportPatientNoShow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/appointments" role="PROFESSIONAL">
      <div className={activeTab === 'calendar' ? 'max-w-5xl' : 'max-w-3xl'}>
        <div className="mb-4">
          <h1 className="text-base font-semibold">Citas agendadas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Todas tus citas con horario fijo, pasadas y futuras</p>
        </div>

        {error && <div className="mb-4"><Alert type="error" message={error} /></div>}

        {/* Tabs */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'upcoming'
                ? 'bg-white text-[#141820] border border-[#DDE1EE]'
                : 'text-[#6B738A]'
            }`}
          >
            Próximas {upcoming.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#185FA5] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {upcoming.length}
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
            Historial {past.length > 0 && (
              <span className="ml-1 w-4 h-4 bg-[#6B738A] text-white text-[10px] rounded-full inline-flex items-center justify-center">
                {past.length}
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
          <LoadingScreen />
        ) : activeTab === 'upcoming' ? (
          <div className="card">
            <SectionTitle>Próximas ({upcoming.length})</SectionTitle>
            {upcoming.length === 0 ? (
              <EmptyState title="No tienes citas agendadas próximas" />
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {upcoming.map((c: any) => {
                    const scheduledAt = c.scheduled_at ? new Date(c.scheduled_at) : null
                    const graceOk = scheduledAt ? Date.now() - scheduledAt.getTime() >= 10 * 60 * 1000 : false
                    const timeArrived = scheduledAt ? Date.now() >= scheduledAt.getTime() : false
                    const hasProposalFromPatient = c.reschedule_proposed_at && c.reschedule_proposed_by === 'PATIENT'
                    const hasOwnPendingProposal = c.reschedule_proposed_at && c.reschedule_proposed_by === 'PROFESSIONAL'

                    return (
                      <div key={c.id} className="py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {patientInitials(c)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                            <p className="text-xs text-[#6B738A]">
                              {c.specialty ? `${c.specialty} · ` : ''}Bs. {parseFloat(c.amount).toFixed(2)}
                            </p>
                            {scheduledAt && (
                              <p className="text-xs text-[#185FA5] font-medium mt-0.5">
                                🗓 {scheduledAt.toLocaleString('es-BO', {
                                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                                })}
                              </p>
                            )}
                          </div>
                          <StatusBadge status={c.status} />
                        </div>

                        {c.chief_complaint && (
                          <div className="ml-12 mt-2 bg-[#F5F6FA] rounded-lg px-3 py-2">
                            <p className="text-xs text-[#A0A8BF] mb-0.5">Motivo de la consulta</p>
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

                        {/* Pendiente de aceptar */}
                        {c.status === 'WAITING_PROFESSIONAL' && (
                          <div className="mt-2">
                            <div className="flex gap-2 ml-12">
                              <button
                                onClick={() => acceptMutation.mutate(c.id)}
                                className="flex-1 py-1.5 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium rounded-lg"
                              >
                                ✓ Aceptar cita
                              </button>
                              <button
                                onClick={() => rejectMutation.mutate(c.id)}
                                className="py-1.5 px-4 bg-[#F5F6FA] hover:bg-[#DDE1EE] text-[#6B738A] text-xs font-medium rounded-lg"
                              >
                                Rechazar
                              </button>
                            </div>
                            <div className="mt-1.5">
                              <ScheduledAcceptDeadlineTimer createdAt={c.created_at} scheduledAt={c.scheduled_at} />
                            </div>
                          </div>
                        )}

                        {/* Pagada — iniciar / reprogramar / no-show */}
                        {c.status === 'PAYMENT_CONFIRMED' && (
                          <div className="ml-12 mt-2">
                            <button
                              onClick={() => startVideoMutation.mutate(c.id)}
                              disabled={startVideoMutation.isPending}
                              className="btn-primary text-xs py-1.5 px-3 mb-2"
                            >
                              {startVideoMutation.isPending ? 'Iniciando...' : '📹 Iniciar consulta'}
                            </button>

                            {hasProposalFromPatient && (
                              <div className="bg-[#FAEEDA] border border-[#F3D08A] rounded-lg px-3 py-2 mb-2">
                                <p className="text-xs text-[#854F0B] font-medium">
                                  El paciente propone cambiar la cita a{' '}
                                  {new Date(c.reschedule_proposed_at).toLocaleString('es-BO', {
                                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                                  })}
                                </p>
                                <div className="flex gap-2 mt-2">
                                  <button onClick={() => respondRescheduleMutation.mutate({ id: c.id, decision: 'ACCEPT' })} className="text-xs bg-[#1D9E75] text-white px-3 py-1 rounded-lg">
                                    Aceptar
                                  </button>
                                  <button onClick={() => respondRescheduleMutation.mutate({ id: c.id, decision: 'REJECT' })} className="text-xs bg-white border border-[#DDE1EE] text-[#6B738A] px-3 py-1 rounded-lg">
                                    Rechazar
                                  </button>
                                </div>
                              </div>
                            )}
                            {hasOwnPendingProposal && (
                              <p className="text-xs text-[#A0A8BF] mb-2">Propusiste otro horario — esperando respuesta del paciente.</p>
                            )}

                            {!c.reschedule_proposed_at && (
                              <div className="flex items-center gap-3 flex-wrap">
                                {!c.reschedule_used && (
                                  reschedulingId === c.id ? (
                                    <div className="flex items-center gap-2">
                                      <SpanishDateTimePicker
                                        value={newDateTime}
                                        onChange={setNewDateTime}
                                      />
                                      <button
                                        onClick={() => newDateTime && proposeRescheduleMutation.mutate({ id: c.id, newScheduledAt: newDateTime })}
                                        disabled={!newDateTime}
                                        className="text-xs text-[#185FA5] font-medium disabled:opacity-50"
                                      >
                                        Enviar
                                      </button>
                                      <button onClick={() => setReschedulingId(null)} className="text-xs text-[#6B738A]">Cancelar</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => { setReschedulingId(c.id); setNewDateTime('') }} className="text-xs text-[#185FA5] font-medium">
                                      Proponer otro horario
                                    </button>
                                  )
                                )}
                                {timeArrived && (
                                  <button
                                    onClick={() => noShowPatientMutation.mutate(c.id)}
                                    disabled={!graceOk}
                                    title={!graceOk ? 'Disponible 10 min después de la hora de la cita' : ''}
                                    className="text-xs text-[#A32D2D] disabled:opacity-40"
                                  >
                                    El paciente no llegó
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        ) : activeTab === 'history' ? (
          <div className="card">
            <SectionTitle>Historial de citas agendadas ({past.length})</SectionTitle>
            {past.length === 0 ? (
              <EmptyState title="Todavía no tienes citas agendadas pasadas" />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                  {past.map((c: any) => {
                    const isCancelled = c.status === 'CANCELLED' || c.status === 'REFUNDED'
                    const who = isCancelled ? cancelledByLabel(c) : null
                    const wasRefunded = wasActuallyRefunded(c)
                    return (
                      <div key={c.id} className="py-3 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#F5F6FA] text-[#6B738A] flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {patientInitials(c)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{patientNameOf(c) || c.specialty || 'Cita'}</p>
                          <p className="text-xs text-[#6B738A] truncate">
                            {c.scheduled_at ? `Cita para ${fmtFechaHoraLocal(c.scheduled_at)}` : ''}
                            {' · '}Bs. {parseFloat(c.professional_earning || c.amount).toFixed(2)}
                          </p>
                          {!isCancelled && c.chief_complaint && (
                            <p className="text-xs text-[#A0A8BF] mt-0.5 truncate" title={c.chief_complaint}>
                              Motivo: {c.chief_complaint}
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
            <SectionTitle>Calendario de citas agendadas</SectionTitle>
            <AppointmentsCalendar consultations={scheduled} role="PROFESSIONAL" />
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}