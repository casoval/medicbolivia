'use client'
// src/app/professional/appointments/page.tsx
// Vista dedicada: TODAS las citas agendadas del profesional, pasadas y futuras,
// en un solo lugar (separado de las consultas inmediatas).

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, SectionTitle, Alert } from '@/components/ui'
import { consultationsAPI, professionalsAPI, getErrorMessage } from '@/lib/api'
import type { PatientLink } from '@/lib/api'
import { outcomeLabel, cancelledByLabel, fmtFechaHora, fmtFechaHoraLocal, wasActuallyRefunded } from '@/lib/consultationHistory'
import { PatientHistoryPanel } from '@/components/professional/PatientHistoryPanel'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { CreatorBadge } from '@/components/shared/CreatorBadge'
import { PaymentBadge } from '@/components/shared/ConsultationBadges'
import { SpanishDateTimePicker } from '@/components/ui/SpanishDateTimePicker'
import { AppointmentsCalendar } from '@/components/shared/AppointmentsCalendar'
import { ProfessionalScheduleModal } from '@/components/professional/ProfessionalScheduleModal'
import { groupByPatient, hasEffectiveLink, linkForSchedule } from '@/lib/patientGrouping'

function patientNameOf(c: any): string | null {
  return c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : null
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

  // Para el botón "+ Nueva cita" del calendario (agendamiento directo por
  // membresía) — mismos datos y misma regla de vínculo efectivo que usa
  // "Mis pacientes" (ver lib/patientGrouping.ts).
  const { data: links = [] } = useQuery({
    queryKey: ['my-linked-patients'],
    queryFn: professionalsAPI.getMyPatients,
    staleTime: 30_000,
  })
  const { data: membership } = useQuery({
    queryKey: ['my-membership'],
    queryFn: professionalsAPI.getMyMembership,
    staleTime: 30_000,
  })
  const { data: profile } = useQuery({
    queryKey: ['professional-profile'],
    queryFn: professionalsAPI.getMyProfile,
    staleTime: 60_000,
  })
  const membershipActive = !!membership?.active
  const defaultAmount = profile ? parseFloat((profile as any).price_general || '0') : 0

  const [showPatientPicker, setShowPatientPicker] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [pickedLink, setPickedLink] = useState<PatientLink | null>(null)

  const effectivePatients = useMemo(() => {
    const groups = groupByPatient(consultations as any[], links as PatientLink[])
    return groups.filter(hasEffectiveLink)
  }, [consultations, links])

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase()
    if (!q) return effectivePatients
    return effectivePatients.filter((p) => p.name.toLowerCase().includes(q))
  }, [effectivePatients, patientSearch])

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
                          <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} />
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
                          <div className="flex flex-col items-end gap-1">
                            <StatusBadge status={c.status} createdByRole={c.created_by_role} />
                            <CreatorBadge createdByRole={c.created_by_role} viewerRole="PROFESSIONAL" />
                            <PaymentBadge consultation={c} viewerRole="PROFESSIONAL" />
                          </div>
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
                        <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} colorClasses="bg-[#F5F6FA] text-[#6B738A]" />
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
                        <div className="flex flex-col items-end gap-1">
                          <StatusBadge status={c.status} createdByRole={c.created_by_role} />
                          <CreatorBadge createdByRole={c.created_by_role} viewerRole="PROFESSIONAL" />
                          <PaymentBadge consultation={c} viewerRole="PROFESSIONAL" />
                        </div>
                      </div>
                    )
                  })}
                </div>
            )}
          </div>
        ) : (
          <div className="card">
            <div className="flex items-center justify-between gap-2 mb-1">
              <SectionTitle>Calendario de citas agendadas</SectionTitle>
              {membershipActive && (
                <button
                  onClick={() => { setPatientSearch(''); setShowPatientPicker(true) }}
                  className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                >
                  + Nueva cita
                </button>
              )}
            </div>
            <AppointmentsCalendar consultations={scheduled} role="PROFESSIONAL" membershipActive={membershipActive} />
          </div>
        )}
      </div>

      {/* Picker de paciente para "+ Nueva cita" — solo pacientes con vínculo
          efectivo (ver lib/patientGrouping.ts::hasEffectiveLink). */}
      {showPatientPicker && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowPatientPicker(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold mb-1">¿A quién le agendas la cita?</h2>
            <p className="text-xs text-[#6B738A] mb-3">Solo aparecen tus pacientes vinculados (por consulta previa o vínculo manual).</p>
            <input
              autoFocus
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Buscar por nombre…"
              className="w-full px-3 py-1.5 border border-[#DDE1EE] rounded-lg text-sm mb-3"
            />
            <div className="overflow-y-auto flex-1 -mx-1 px-1">
              {filteredPatients.length === 0 ? (
                <p className="text-xs text-[#6B738A] text-center py-6">
                  {effectivePatients.length === 0 ? 'Todavía no tienes pacientes vinculados.' : 'Sin resultados.'}
                </p>
              ) : (
                <div className="divide-y divide-[#ECEEF5]">
                  {filteredPatients.map((p) => (
                    <button
                      key={p.patientId}
                      onClick={() => { setPickedLink(linkForSchedule(p)); setShowPatientPicker(false) }}
                      className="w-full flex items-center gap-2 text-left px-1 py-2.5 hover:bg-[#F9FAFC]"
                    >
                      <PatientAvatar firstName={p.firstName} lastName={p.lastName} photoUrl={p.photoUrl} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{p.name}</span>
                        <span className="block text-[11px] text-[#A0A8BF]">
                          {p.completed} consulta{p.completed === 1 ? '' : 's'} completada{p.completed === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowPatientPicker(false)} className="btn-secondary text-xs py-1.5 px-3 mt-3 self-end">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {pickedLink && (
        <ProfessionalScheduleModal
          link={pickedLink}
          defaultAmount={defaultAmount}
          onClose={() => setPickedLink(null)}
        />
      )}
    </DashboardLayout>
  )
}