'use client'
// src/app/professional/dashboard/page.tsx

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { Alert } from '@/components/ui'
import { ModalityBadge, PaymentBadge } from '@/components/shared/ConsultationBadges'
import { useAuthStore } from '@/lib/store'
import { professionalsAPI, consultationsAPI, ratingsAPI, prescriptionsAPI, clinicalNotesAPI, getErrorMessage } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'
import { getGreeting } from '@/lib/greeting'
import { PatientRecordSummary } from '@/components/professional/PatientRecordSummary'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { outcomeLabel, cancelledByLabel, fmtFechaHora, wasActuallyRefunded } from '@/lib/consultationHistory'
import { SpanishDateTimePicker } from '@/components/ui/SpanishDateTimePicker'
import type { AvailabilityMode } from '@/types'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { professionalTitle } from '@/lib/professionalTitle'

// Timer cuenta regresiva para solicitudes entrantes
function RequestTimer({ createdAt }: { createdAt: string }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(createdAt + 'Z').getTime()) / 1000)
      const left = Math.max(0, 300 - elapsed)
      setSecs(left)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [createdAt])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  const isUrgent = secs <= 30
  return (
    <span className={`text-xs font-mono font-bold ${isUrgent ? 'text-[#E24B4A]' : 'text-[#854F0B]'}`}>
      {m}:{s.toString().padStart(2, '0')}
    </span>
  )
}

// Cuenta regresiva para aceptar/rechazar una CITA AGENDADA. El plazo real
// es el MENOR entre "24h desde que se pidió" y "30 minutos antes de la
// hora de la cita" (mismo cálculo que usa el backend al crear la consulta:
// nunca debe quedar margen menor a 30 min entre la respuesta y la cita,
// porque el paciente todavía necesita pagar el QR y ambos prepararse).
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
  const isUrgent = secs > 0 && secs <= 3600 // última hora

  if (secs <= 0) {
    return (
      <span className="text-xs text-[#64748B] flex-shrink-0">
        {limitedByAppointment ? 'Cita muy próxima — ya no se puede responder' : 'Plazo vencido'}
      </span>
    )
  }

  return (
    <span className={`text-xs font-mono font-bold flex-shrink-0 ${isUrgent ? 'text-[#E24B4A]' : 'text-[#854F0B]'}`}>
      {days > 0 && `${days}d `}{hours.toString().padStart(2, '0')}h {mins.toString().padStart(2, '0')}m {s.toString().padStart(2, '0')}s
    </span>
  )
}

// Timer de espera post-pago — alerta al profesional si tarda en iniciar
function PaymentTimer({ confirmedAt }: { confirmedAt: string }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(confirmedAt + 'Z').getTime()) / 1000)
      setSecs(Math.max(0, elapsed))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [confirmedAt])

  const mins = Math.floor(secs / 60)
  const s = secs % 60
  const isWarning = secs >= 180  // 3 min — naranja
  const isUrgent  = secs >= 300  // 5 min — rojo

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-bold
      ${isUrgent  ? 'bg-[#FCEBEB] text-[#E24B4A] animate-pulse' :
        isWarning ? 'bg-[#FAEEDA] text-[#854F0B]' :
                    'bg-[#E6F1FB] text-[#185FA5]'}`}>
      <span>{isUrgent ? '🔴' : isWarning ? '⚠️' : '⏱'}</span>
      <span>{mins}:{s.toString().padStart(2, '0')}</span>
    </div>
  )
}

// Cuenta regresiva para que el paciente pague
// - Inmediata: 5 min (desde que el profesional aceptó)
// - Agendada:  30 min (desde que el paciente creó la cita)
function AwaitingPatientPaymentTimer({ acceptedAt, isScheduled }: { acceptedAt: string; isScheduled?: boolean }) {
  const { t } = useLanguage()
  const PAYMENT_TIMEOUT_SECS = isScheduled ? 30 * 60 : 5 * 60
  const [secsLeft, setSecsLeft] = useState(PAYMENT_TIMEOUT_SECS)
  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(acceptedAt + 'Z').getTime()) / 1000)
      setSecsLeft(Math.max(0, PAYMENT_TIMEOUT_SECS - elapsed))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [acceptedAt, PAYMENT_TIMEOUT_SECS])

  const mins = Math.floor(secsLeft / 60)
  const s = secsLeft % 60
  const isUrgent  = secsLeft <= 60
  const isWarning = isScheduled ? secsLeft <= 300 : secsLeft <= 120

  if (secsLeft === 0) return (
    <span className="text-xs text-[#E24B4A] font-semibold">{t('Tiempo de pago agotado')}</span>
  )
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono font-bold
      ${isUrgent  ? 'bg-[#FCEBEB] text-[#E24B4A] animate-pulse' :
        isWarning ? 'bg-[#FAEEDA] text-[#854F0B]' :
                    'bg-[#FFF8EC] text-[#B97A00]'}`}>
      <span>{isUrgent ? '🔴' : '⏳'}</span>
      <span>{mins}:{s.toString().padStart(2, '0')}</span>
      <span className="font-normal opacity-75">{t('para pagar')}</span>
    </div>
  )
}

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
          <button onClick={onClose} className="text-[#475569] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        {isLoading && <p className="text-sm text-[#475569] text-center py-6">{t('Cargando recetas...')}</p>}
        {data && data.length === 0 && (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">💊</p>
            <p className="text-sm text-[#475569]">{t('No hay recetas para esta consulta')}</p>
          </div>
        )}
        {data && data.map((rx: any) => (
          <div key={rx.id} className="border border-[#DDE1EE] rounded-xl p-4 mb-3">
            <div className="border-b border-[#DDE1EE] pb-3 mb-3">
              <p className="text-xs text-[#475569]">{t('Paciente')}</p>
              <p className="font-semibold text-sm">{rx.patient_name || 'Paciente'}</p>
              {rx.patient_age != null && <p className="text-xs text-[#475569]">{rx.patient_age} años{rx.patient_ci ? ` · CI ${rx.patient_ci}` : ''}</p>}
            </div>
            <p className="text-xs font-semibold text-[#475569] uppercase tracking-wide mb-2">{t('Medicamentos')}</p>
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
        <p className="text-xs font-semibold text-[#475569] uppercase tracking-wide mb-1">{label}</p>
        <p className="text-sm whitespace-pre-wrap">{value}</p>
      </div>
    ) : null
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">{t('Historia clínica de esta consulta')}</h3>
          <button onClick={onClose} className="text-[#475569] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        {isLoading && <p className="text-sm text-[#475569] text-center py-6">{t('Cargando historia clínica...')}</p>}
        {!isLoading && !note && (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm text-[#475569]">{t('Aún no registraste historia clínica para esta consulta')}</p>
          </div>
        )}
        {note && (
          <>
            {note.patient_name && (
              <div className="border-b border-[#DDE1EE] pb-3 mb-3">
                <p className="text-xs text-[#475569]">{t('Paciente')}</p>
                <p className="font-semibold text-sm">{note.patient_name}</p>
              </div>
            )}
            {field('Motivo de consulta (Subjetivo)', note.subjective)}
            {field('Hallazgos (Objetivo)', note.objective)}
            {field('Diagnóstico (Evaluación)', note.assessment)}
            {field('Plan / Indicaciones', note.plan)}
            {!note.subjective && !note.objective && !note.assessment && !note.plan && (
              <p className="text-sm text-[#475569] text-center py-4">{t('Aún no completaste el detalle.')}</p>
            )}
          </>
        )}
        <button onClick={onClose} className="btn-secondary w-full mt-4">{t('Cerrar')}</button>
      </div>
    </div>,
    document.body
  )
}

// ── Modal: Historial del paciente ─────────────────────
// Para que el médico repase los antecedentes ANTES de atender: sus
// propias recetas e historias clínicas con ese paciente, y — si el
// paciente está "activo" (tiene una consulta lista/agendada conmigo) —
// también las historias clínicas que el paciente decidió compartir con
// OTROS médicos de la plataforma. El contenido vive en un componente
// compartido (PatientRecordSummary) que también usa /professional/patients.
function PatientHistoryModal({
  patientId,
  patientName,
  showSharedFromOthers,
  onClose,
}: {
  patientId: string
  patientName: string
  showSharedFromOthers: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold">🗂️ Historial de {patientName}</h3>
          <button onClick={onClose} className="text-[#475569] hover:text-[#1C2133]"><IconClose /></button>
        </div>
        <p className="text-xs text-[#475569] mb-4">{t('Antecedentes para revisar antes de atender.')}</p>

        <PatientRecordSummary patientId={patientId} showSharedFromOthers={showSharedFromOthers} />

        <button onClick={onClose} className="btn-secondary w-full mt-4">{t('Cerrar')}</button>
      </div>
    </div>,
    document.body
  )
}

export default function ProfessionalDashboard() {
  const { t } = useLanguage()
  const { user } = useAuthStore()
  const router = useRouter()
  const qc = useQueryClient()
  const [availError, setAvailError] = useState('')
  const [reschedulingId, setReschedulingId] = useState<string | null>(null)
  const [newDateTime, setNewDateTime] = useState('')
  const [cancelTarget, setCancelTarget] = useState<{ id: string; patientName: string; scheduledAt: Date | null } | null>(null)
  const [rxConsultationId, setRxConsultationId] = useState<string | null>(null)
  const [noteConsultationId, setNoteConsultationId] = useState<string | null>(null)
  const [historyPatient, setHistoryPatient] = useState<{ id: string; name: string } | null>(null)

  const { data: myProfile } = useQuery({
    queryKey: ['professional-me'],
    queryFn: () => professionalsAPI.getMyProfile(),
    enabled: !!user,
  })

  const { data: ratingsData } = useQuery({
    queryKey: ['ratings', 'my'],
    queryFn: () => ratingsAPI.getMy().then(r => r.data),
    enabled: !!user,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  })

  const { data: consultations = [] } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
    enabled: !!user,
    refetchInterval: 5000,
  })

  // ── Aviso de paciente nuevo (sonido + parpadeo de pestaña) ──────────
  // El dashboard hace polling cada 5s, pero si el profesional tiene la
  // pestaña de fondo (revisando una receta, en otra app) no se entera de
  // que llegó alguien hasta que vuelve a mirar. Esto avisa aunque no esté
  // mirando la pantalla en ese momento.
  const seenIncomingIdsRef = useRef<Set<string> | null>(null) // null = todavía no se cargó la primera vez
  const titleFlashRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const originalTitleRef = useRef<string>('')
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    setNotifPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  }, [])

  function stopTitleFlash() {
    if (titleFlashRef.current) {
      clearInterval(titleFlashRef.current)
      titleFlashRef.current = null
    }
    if (originalTitleRef.current && typeof document !== 'undefined') {
      document.title = originalTitleRef.current
    }
  }

  function playNewPatientBeep() {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.6)
    } catch {
      // Autoplay bloqueado por el navegador u otro error de audio — no es
      // crítico, el parpadeo del título sigue funcionando igual.
    }
  }

  useEffect(() => {
    const incomingNow: any[] = consultations.filter((c: any) => c.status === 'WAITING_PROFESSIONAL')
    const currentIds = new Set(incomingNow.map((c: any) => c.id))

    if (seenIncomingIdsRef.current === null) {
      // Primera carga de la página: solo registramos lo que ya había
      // esperando, sin sonar por algo que no es nuevo.
      seenIncomingIdsRef.current = currentIds
      return
    }

    const hasNew = incomingNow.some((c: any) => !seenIncomingIdsRef.current!.has(c.id))
    if (hasNew) {
      playNewPatientBeep()
      if (typeof document !== 'undefined') {
        if (!originalTitleRef.current) originalTitleRef.current = document.title
        if (titleFlashRef.current) clearInterval(titleFlashRef.current)
        let flashOn = false
        titleFlashRef.current = setInterval(() => {
          document.title = flashOn ? originalTitleRef.current : '🔔 Nuevo paciente esperando'
          flashOn = !flashOn
        }, 1000)
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Nuevo paciente esperando', {
          body: 'Un paciente está esperando que aceptes su consulta.',
        })
      }
    }

    if (currentIds.size === 0) stopTitleFlash()
    seenIncomingIdsRef.current = currentIds
  }, [consultations])

  // El parpadeo se corta apenas el profesional vuelve a mirar la pestaña.
  useEffect(() => {
    const onFocus = () => stopTitleFlash()
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      stopTitleFlash()
    }
  }, [])

  const recentCompleted = consultations.slice(0, 5).filter((c: any) => c.status === 'COMPLETED')

  const { data: prescriptionsByConsultation = {} } = useQuery({
    queryKey: ['rx-check-pro', recentCompleted.map((c: any) => c.id).join(',')],
    enabled: recentCompleted.length > 0,
    queryFn: async () => {
      try {
        const all = await prescriptionsAPI.getMy() as any[]
        const map: Record<string, boolean> = {}
        recentCompleted.forEach((c: any) => { map[c.id] = all.some((rx: any) => rx.consultation_id === c.id) })
        return map
      } catch { return {} }
    },
  })

  const { data: notesByConsultation = {} } = useQuery({
    queryKey: ['clinical-note-check-pro', recentCompleted.map((c: any) => c.id).join(',')],
    enabled: recentCompleted.length > 0,
    queryFn: async () => {
      try {
        const all = await clinicalNotesAPI.getMyWrittenNotes().then(r => r.data)
        const map: Record<string, boolean> = {}
        recentCompleted.forEach((c: any) => { map[c.id] = all.some((n: ClinicalNote) => n.consultation_id === c.id) })
        return map
      } catch { return {} }
    },
  })

  const hasReceta = (id: string) => prescriptionsByConsultation[id] === true
  const hasHistoria = (id: string) => notesByConsultation[id] === true

  // Antes eran 2 mutaciones separadas (auto y manual), lo que obligaba a
  // desactivar "Automático" en un click aparte antes de poder elegir
  // "Disponible ahora" / "No disponible" — el backend siempre soportó
  // mandar los dos campos juntos en un solo PATCH (ver AvailabilityUpdateRequest
  // en schemas.py), así que se unifica en una sola mutación que cambia de
  // modo de un solo click, sin importar en qué modo se esté parado.
  const setModeMutation = useMutation({
    mutationFn: (data: { availability?: AvailabilityMode; auto_availability?: boolean }) =>
      professionalsAPI.updateAvailability(data),
    onSuccess: (_, data) => {
      qc.setQueryData(['professional-me'], (old: any) => ({ ...old, ...data }))
      qc.invalidateQueries({ queryKey: ['professional-me'] })
    },
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const acceptMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.acceptConsultation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.rejectConsultation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      consultationsAPI.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
  })

  const startVideoMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.startVideo(id),
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      const url = `/professional/video?token=${encodeURIComponent(data.token)}&lk=${encodeURIComponent(data.livekit_url)}&room=${encodeURIComponent(data.room_name)}&cid=${id}`
      router.push(url)
    },
  })

  const rejoinVideoMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.rejoinVideo(id),
    onSuccess: (data, id) => {
      const url = `/professional/video?token=${encodeURIComponent(data.token)}&lk=${encodeURIComponent(data.livekit_url)}&room=${encodeURIComponent(data.room_name)}&cid=${id}`
      router.push(url)
    },
  })

  const respondRescheduleMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'ACCEPT' | 'REJECT' }) =>
      consultationsAPI.respondReschedule(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const proposeRescheduleMutation = useMutation({
    mutationFn: ({ id, newScheduledAt }: { id: string; newScheduledAt: string }) =>
      consultationsAPI.proposeReschedule(id, newScheduledAt),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      setReschedulingId(null)
    },
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const noShowPatientMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.reportPatientNoShow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const completeInPersonMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.completeInPerson(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consultations'] }),
    onError: (err) => setAvailError(getErrorMessage(err)),
  })

  const cancelByProfessionalMutation = useMutation({
    mutationFn: (id: string) => consultationsAPI.cancelByProfessional(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consultations'] })
      alert('Cita cancelada. El dinero fue reembolsado al paciente.')
    },
    onError: (err) => alert(getErrorMessage(err)),
  })

  const currentAvailability = myProfile?.availability ?? null
  const autoAvailability = myProfile?.auto_availability ?? false

  // Contador regresivo en tiempo real para citas agendadas
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  function getCountdown(scheduledAt: Date | null): { canStart: boolean; label: string } {
    if (!scheduledAt) return { canStart: true, label: '' }
    const diff = scheduledAt.getTime() - Date.now()
    if (diff <= 0) return { canStart: true, label: '' }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const secs = Math.floor((diff % (1000 * 60)) / 1000)
    const parts = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0 || days > 0) parts.push(`${hours}h`)
    if (mins > 0 || hours > 0 || days > 0) parts.push(`${mins}m`)
    parts.push(`${secs}s`)
    return { canStart: false, label: parts.join(' ') }
  }

  // Solicitudes nuevas esperando aceptación
  const incoming = consultations.filter((c: any) => c.status === 'WAITING_PROFESSIONAL')
  const incomingImmediate = incoming.filter((c: any) => c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP')
  const incomingScheduled = incoming.filter((c: any) => c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP')
  // Consultas con pago confirmado listas para atender
  const waitingPayment = consultations.filter((c: any) => c.status === 'WAITING_PAYMENT')
  const readyToAttend = consultations.filter((c: any) => c.status === 'PAYMENT_CONFIRMED')
  const readyImmediate = readyToAttend.filter((c: any) => c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP')
  const readyScheduled = readyToAttend.filter((c: any) => c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP')
  const active = consultations.filter((c: any) => c.status === 'IN_PROGRESS')
  const completed = consultations.filter((c: any) => c.status === 'COMPLETED')

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/dashboard" role="PROFESSIONAL">
      <div className="max-w-3xl">

        <div className="mb-5">
          <h1 className="text-lg font-semibold text-[#141820]">
            {getGreeting()}{user?.first_name ? `, ${professionalTitle(user.gender)} ${user.first_name}` : ''} 👋
          </h1>
          <p className="text-sm text-[#475569] mt-0.5">
            {t('Vista general de tu actividad, citas y consultas del día')}
          </p>
        </div>

        {/* Activar notificaciones del navegador — opcional, refuerza el
            sonido/parpadeo cuando el profesional ni siquiera tiene la
            pestaña abierta. Solo se muestra si el navegador lo soporta y
            todavía no se le preguntó. */}
        {notifPermission === 'default' && (
          <div className="mb-4 p-3 rounded-lg border bg-[#E6F1FB] border-[#85B7EB] text-[#0C447C] text-xs flex items-center justify-between gap-3">
            <span>{t('Activa las notificaciones del navegador para enterarte al instante cuando llegue un paciente nuevo, incluso si no tienes esta pestaña abierta.')}</span>
            <button
              onClick={async () => {
                try {
                  const perm = await Notification.requestPermission()
                  setNotifPermission(perm)
                } catch {
                  setNotifPermission('unsupported')
                }
              }}
              className="whitespace-nowrap font-semibold underline shrink-0"
            >
              {t('Activar')}
            </button>
          </div>
        )}

        {/* Disponibilidad */}
        <div className="card mb-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold">{t('Tu disponibilidad ahora')}</p>
              <p className="text-xs text-[#475569] mt-0.5">
                {autoAvailability
                  ? 'Modo automático: se calcula según tu horario semanal'
                  : 'El agente IA te asignará pacientes cuando estés disponible'}
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setModeMutation.mutate({ auto_availability: !autoAvailability })}
                disabled={setModeMutation.isPending}
                className={`text-xs py-1.5 px-3 rounded-lg border transition-colors disabled:opacity-40 ${
                  autoAvailability
                    ? 'bg-[#E6F1FB] border-[#185FA5] text-[#185FA5] font-medium'
                    : 'bg-white border-[#DDE1EE] text-[#475569]'
                }`}
              >
                {autoAvailability ? '✓ Automático' : 'Automático'}
              </button>
              <button
                onClick={() => setModeMutation.mutate({ auto_availability: false, availability: 'ONLINE_NOW' })}
                disabled={setModeMutation.isPending}
                className={`text-xs py-1.5 px-3 btn-primary disabled:opacity-40 ${currentAvailability === 'ONLINE_NOW' && !autoAvailability ? 'ring-2 ring-offset-1 ring-[#185FA5]' : 'opacity-60'}`}
              >
                {currentAvailability === 'ONLINE_NOW' && !autoAvailability ? '✓ Disponible ahora' : 'Disponible ahora'}
              </button>
              <button
                onClick={() => setModeMutation.mutate({ auto_availability: false, availability: 'OFFLINE' })}
                disabled={setModeMutation.isPending}
                className={`text-xs py-1.5 px-3 btn-secondary disabled:opacity-40 ${currentAvailability === 'OFFLINE' && !autoAvailability ? 'ring-2 ring-offset-1 ring-[#A0A8BF]' : 'opacity-60'}`}
              >
                {currentAvailability === 'OFFLINE' && !autoAvailability ? '✓ No disponible' : 'No disponible'}
              </button>
            </div>
          </div>

          {/* Qué hace cada botón — siempre visible (no solo la primera vez),
              porque es la palanca que decide si te llegan pacientes o no.
              El modo activo se resalta para reforzar "esto es lo que está
              pasando ahora mismo". */}
          <div className="mt-3 pt-3 border-t border-[#EEF1F8] space-y-1.5">
            <p className={`text-xs flex gap-1.5 ${autoAvailability ? 'text-[#185FA5] font-medium' : 'text-[#64748B]'}`}>
              <span>{autoAvailability ? '●' : '○'}</span>
              <span><span className="font-medium">{t('Automático:')}</span> {t('el sistema te muestra disponible o no según los bloques de horario que configuraste en "Horarios" — no tienes que acordarte de activarlo ni desactivarlo cada día.')}</span>
            </p>
            <p className={`text-xs flex gap-1.5 ${!autoAvailability && currentAvailability === 'ONLINE_NOW' ? 'text-[#185FA5] font-medium' : 'text-[#64748B]'}`}>
              <span>{!autoAvailability && currentAvailability === 'ONLINE_NOW' ? '●' : '○'}</span>
              <span><span className="font-medium">{t('Disponible ahora:')}</span> {t('recibes pacientes ya mismo, sin importar tu horario configurado — útil si quieres atender fuera de tu horario habitual. Se mantiene así hasta que elijas otro modo.')}</span>
            </p>
            <p className={`text-xs flex gap-1.5 ${!autoAvailability && currentAvailability === 'OFFLINE' ? 'text-[#185FA5] font-medium' : 'text-[#64748B]'}`}>
              <span>{!autoAvailability && currentAvailability === 'OFFLINE' ? '●' : '○'}</span>
              <span><span className="font-medium">{t('No disponible:')}</span> {t('no te llega ningún paciente nuevo, sin importar tu horario configurado — útil si necesitas pausar por completo aunque tengas horario activo (viaje, descanso, etc.).')}</span>
            </p>
          </div>

          {autoAvailability && (
            <p className="text-xs text-[#64748B] mt-2">
              {t('Define tus bloques en')} <a href="/professional/schedule" className="text-[#185FA5] hover:underline">{t('Horarios')}</a> {t('para que el modo automático funcione bien.')}
            </p>
          )}
          {availError && <div className="mt-2"><Alert type="error" message={availError} /></div>}
        </div>

        {/* Recordatorio persistente en modo "No disponible" — el toggle de
            arriba se puede perder de vista al hacer scroll, y es fácil
            olvidarse de que se dejó activado (por ejemplo tras un viaje o
            descanso), perdiendo pacientes sin darse cuenta. */}
        {!autoAvailability && currentAvailability === 'OFFLINE' && (
          <div className="mb-4 p-3 rounded-lg border bg-[#F5F6FA] border-[#A0A8BF] text-[#475569] text-xs flex items-center justify-between gap-3">
            <span>⏸️ {t('Estás en modo "No disponible": no te está llegando ningún paciente nuevo ahora mismo.')}</span>
          </div>
        )}

        {/* Métricas rápidas */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">{consultations.length}</p>
            <p className="text-xs text-[#475569] mt-0.5">{t('Total')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">{incoming.length}</p>
            <p className="text-xs text-[#475569] mt-0.5">{t('Pendientes')}</p>
          </div>
          <div className="bg-[#F5F6FA] rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">{completed.length}</p>
            <p className="text-xs text-[#475569] mt-0.5">{t('Completadas')}</p>
          </div>
          <a href="/professional/ratings" className="bg-[#F5F6FA] rounded-lg p-3 text-center hover:bg-[#EEF0F7] transition-colors">
            <p className="text-xl font-bold text-[#F5A623]">
              {(ratingsData?.average ?? 0) > 0 ? ratingsData!.average.toFixed(1) : '—'}
            </p>
            <p className="text-xs text-[#475569] mt-0.5">
              ★ {(ratingsData?.total ?? 0) > 0 ? `${ratingsData!.total} opiniones` : 'Sin calificaciones'}
            </p>
          </a>
        </div>

        {/* Acceso directo al calendario de citas agendadas */}
        <a
          href="/professional/appointments?tab=calendar"
          className="flex items-center justify-between bg-white border border-[#DDE1EE] rounded-xl p-3 mb-5 hover:bg-[#F9FAFC] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-[#E6F1FB] flex items-center justify-center text-base flex-shrink-0">
              🗓️
            </span>
            <div>
              <p className="text-xs font-semibold text-[#141820]">{t('Calendario de citas agendadas')}</p>
              <p className="text-[11px] text-[#475569]">{t('Mira tu agenda por día, semana o mes')}</p>
            </div>
          </div>
          <span className="text-[#185FA5] text-xs font-medium">{t('Abrir →')}</span>
        </a>

        {/* ── Solicitudes entrantes INMEDIATAS — requieren aceptar/rechazar en 5 min ── */}
        {incomingImmediate.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#E24B4A', borderWidth: 2 }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#E24B4A] animate-ping" />
              <h2 className="text-sm font-semibold text-[#E24B4A]">
                {incomingImmediate.length} solicitud{incomingImmediate.length > 1 ? 'es' : ''} inmediata{incomingImmediate.length > 1 ? 's' : ''}
              </h2>
            </div>
            {incomingImmediate.map((c: any) => (
              <div key={c.id} className="py-3 border-b border-[#DDE1EE] last:border-0">
                <div className="flex items-center gap-3">
                  <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-9 h-9" colorClasses="bg-[#FCEBEB] text-[#E24B4A]" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                    <p className="text-xs text-[#475569]">
                      {c.specialty || 'Consulta general'} · Bs. {parseFloat(c.amount).toFixed(2)} · {new Date(c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-[#FAEEDA] px-2 py-1 rounded-lg">
                    <span className="text-xs text-[#854F0B]">⏱</span>
                    <RequestTimer createdAt={c.created_at} />
                  </div>
                </div>
                <div className="flex gap-2 mt-2 ml-12">
                  <button
                    onClick={() => acceptMutation.mutate(c.id)}
                    disabled={acceptMutation.isPending}
                    className="flex-1 py-2 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    {t('✓ Aceptar consulta')}
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(c.id)}
                    disabled={rejectMutation.isPending}
                    className="py-2 px-4 bg-[#F5F6FA] hover:bg-[#DDE1EE] text-[#475569] text-xs font-medium rounded-lg transition-colors"
                  >
                    {t('Rechazar')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Solicitudes de CITAS AGENDADAS — tienes 24h para responder, sin presión de tiempo ── */}
        {incomingScheduled.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#185FA5', borderWidth: 1.5 }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📅</span>
              <h2 className="text-sm font-semibold text-[#185FA5]">
                {incomingScheduled.length} solicitud{incomingScheduled.length > 1 ? 'es' : ''} de cita agendada
              </h2>
            </div>
            {incomingScheduled.map((c: any) => (
              <div key={c.id} className="py-3 border-b border-[#DDE1EE] last:border-0">
                <div className="flex items-center gap-3">
                  <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-9 h-9" colorClasses="bg-[#E6F1FB] text-[#185FA5]" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                    <p className="text-xs text-[#475569]">
                      {c.specialty || 'Consulta general'} · Bs. {parseFloat(c.amount).toFixed(2)}
                    </p>
                    {c.scheduled_at && (
                      <p className="text-xs text-[#185FA5] font-medium mt-0.5">
                        🗓 {new Date(c.scheduled_at).toLocaleString('es-BO', {
                          weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    )}
                  </div>
                  <ScheduledAcceptDeadlineTimer createdAt={c.created_at} scheduledAt={c.scheduled_at} />
                </div>
                {c.chief_complaint && (
                  <div className="ml-12 mt-2 bg-[#F5F6FA] rounded-lg px-3 py-2">
                    <p className="text-xs text-[#64748B] mb-0.5">{t('Motivo de la consulta')}</p>
                    <p className="text-xs text-[#141820]">{c.chief_complaint}</p>
                  </div>
                )}
                <div className="flex gap-2 mt-2 ml-12">
                  <button
                    onClick={() => acceptMutation.mutate(c.id)}
                    disabled={acceptMutation.isPending}
                    className="flex-1 py-2 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    {t('✓ Aceptar cita')}
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(c.id)}
                    disabled={rejectMutation.isPending}
                    className="py-2 px-4 bg-[#F5F6FA] hover:bg-[#DDE1EE] text-[#475569] text-xs font-medium rounded-lg transition-colors"
                  >
                    {t('Rechazar')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Esperando pago del paciente (WAITING_PAYMENT) ── */}
        {waitingPayment.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#B97A00', borderWidth: 1.5 }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#B97A00] animate-pulse" />
              <h2 className="text-sm font-semibold text-[#B97A00]">
                ⏳ {waitingPayment.length} paciente{waitingPayment.length > 1 ? 's' : ''} esperando pago
              </h2>
            </div>
            {waitingPayment.map((c: any) => (
              <div key={c.id} className="py-2.5 border-b border-[#DDE1EE] last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-7 h-7" colorClasses="bg-[#F5E6C8] text-[#B97A00]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1B2B5E] truncate">
                      {patientNameOf(c) || 'Paciente'}
                    </p>
                    <p className="text-xs text-[#888FAE]">{c.specialty || 'Consulta general'}</p>
                  </div>
                  {c.updated_at && <AwaitingPatientPaymentTimer acceptedAt={c.updated_at} isScheduled={c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP'} />}
                </div>
                <div className="ml-9 mt-1 px-2 py-1.5 bg-[#FFF8EC] rounded-lg border border-[#F5E6C8]">
                  <p className="text-xs text-[#B97A00]">
                    {c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP'
                      ? `💳 El paciente está completando el pago. La videollamada iniciará en la hora agendada${c.scheduled_at ? ': ' + new Date(c.scheduled_at).toLocaleString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}.`
                      : '💳 El paciente está completando el pago. La consulta comenzará automáticamente cuando se confirme.'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Pagos confirmados — INMEDIATAS, listas para atender ya ── */}
        {readyImmediate.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#185FA5', borderWidth: 1.5 }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#185FA5] animate-pulse" />
              <h2 className="text-sm font-semibold text-[#185FA5]">
                {readyImmediate.length} paciente{readyImmediate.length > 1 ? 's' : ''} listo{readyImmediate.length > 1 ? 's' : ''} — pago confirmado
              </h2>
            </div>
            {readyImmediate.map((c: any) => {
              const paidAt = c.payment_confirmed_at || c.updated_at || c.created_at
              const elapsed = Math.floor((Date.now() - new Date(paidAt + 'Z').getTime()) / 1000)
              const isOverdue = elapsed >= 300

              return (
                <div key={c.id} className="py-2.5 border-b border-[#DDE1EE] last:border-0">
                  {isOverdue && (
                    <div className="flex items-start gap-2 bg-[#FCEBEB] border border-[#F5BEBE] rounded-lg px-3 py-2 mb-2.5">
                      <span className="text-base leading-none mt-0.5">🔴</span>
                      <div>
                        <p className="text-xs font-semibold text-[#E24B4A]">{t('¡El paciente lleva más de 5 minutos esperando!')}</p>
                        <p className="text-xs text-[#C03A39] mt-0.5">{t('Ya realizó su pago. Iniciá la videollamada lo antes posible para no afectar tu calificación.')}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-9 h-9" colorClasses="bg-[#E6F1FB] text-[#185FA5]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                      <p className="text-xs text-[#475569]">
                        {c.specialty || 'Consulta general'} · Bs. {parseFloat(c.amount).toFixed(2)} · Pagó a las {new Date(paidAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <button
                        onClick={() => setHistoryPatient({ id: c.patient_id, name: patientNameOf(c) || 'el paciente' })}
                        className="text-xs text-[#185FA5] font-medium mt-0.5"
                      >
                        {t('🗂️ Ver historial del paciente')}
                      </button>
                    </div>
                    <PaymentTimer confirmedAt={paidAt} />
                    <button
                      onClick={() => startVideoMutation.mutate(c.id)}
                      disabled={startVideoMutation.isPending}
                      className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
                    >
                      {startVideoMutation.isPending ? 'Iniciando...' : '📹 Iniciar consulta'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── CITAS AGENDADAS confirmadas — con reprogramar y reportar inasistencia ── */}
        {readyScheduled.length > 0 && (
          <div className="card mb-4" style={{ borderColor: '#185FA5', borderWidth: 1.5 }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📅</span>
              <h2 className="text-sm font-semibold text-[#185FA5]">
                {readyScheduled.length} cita{readyScheduled.length > 1 ? 's' : ''} agendada{readyScheduled.length > 1 ? 's' : ''} confirmada{readyScheduled.length > 1 ? 's' : ''}
              </h2>
            </div>
            {readyScheduled.map((c: any) => {
              const scheduledAt = c.scheduled_at ? new Date(c.scheduled_at) : null
              const graceOk = scheduledAt ? Date.now() - scheduledAt.getTime() >= 10 * 60 * 1000 : false
              const hasProposalFromPatient = c.reschedule_proposed_at && c.reschedule_proposed_by === 'PATIENT'
              const hasOwnPendingProposal = c.reschedule_proposed_at && c.reschedule_proposed_by === 'PROFESSIONAL'

              return (
                <div key={c.id} className="py-3 border-b border-[#DDE1EE] last:border-0">
                  <div className="flex items-center gap-3">
                    <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-9 h-9" colorClasses="bg-[#E6F1FB] text-[#185FA5]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                      <p className="text-xs text-[#475569]">
                        {c.specialty || 'Consulta general'} · Bs. {parseFloat(c.amount).toFixed(2)}
                      </p>
                      {scheduledAt && (
                        <p className="text-xs text-[#185FA5] font-medium mt-0.5">
                          🗓 {scheduledAt.toLocaleString('es-BO', {
                            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                          })}
                        </p>
                      )}
                    </div>
{(() => {
                      const { canStart, label } = getCountdown(scheduledAt)
                      if (!canStart) {
                        return (
                          <div className="flex-shrink-0 text-right">
                            <p className="text-[10px] text-[#64748B] mb-0.5">{t('Inicia en')}</p>
                            <p className="text-xs font-mono font-semibold text-[#185FA5]">{label}</p>
                          </div>
                        )
                      }
                      if (c.modality === 'IN_PERSON') {
                        return (
                          <button
                            onClick={() => completeInPersonMutation.mutate(c.id)}
                            disabled={completeInPersonMutation.isPending}
                            className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
                          >
                            {completeInPersonMutation.isPending ? 'Guardando...' : '✅ Completar'}
                          </button>
                        )
                      }
                      return (
                        <button
                          onClick={() => startVideoMutation.mutate(c.id)}
                          disabled={startVideoMutation.isPending}
                          className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
                        >
                          {startVideoMutation.isPending ? 'Iniciando...' : '📹 Iniciar'}
                        </button>
                      )
                    })()}
                  </div>

                  {/* Historial del paciente — antecedentes para revisar antes de atender */}
                  <div className="ml-12 mt-1.5">
                    <button
                      onClick={() => setHistoryPatient({ id: c.patient_id, name: patientNameOf(c) || 'el paciente' })}
                      className="text-xs text-[#185FA5] font-medium"
                    >
                      {t('🗂️ Ver historial del paciente')}
                    </button>
                  </div>

                  {/* Propuesta de reprogramación del paciente — debo responder */}
                  {hasProposalFromPatient && (
                    <div className="ml-12 mt-2 bg-[#FAEEDA] border border-[#F3D08A] rounded-lg px-3 py-2">
                      <p className="text-xs text-[#854F0B] font-medium">
                        El paciente propone cambiar la cita a{' '}
                        {new Date(c.reschedule_proposed_at).toLocaleString('es-BO', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => respondRescheduleMutation.mutate({ id: c.id, decision: 'ACCEPT' })}
                          className="text-xs bg-[#1D9E75] text-white px-3 py-1 rounded-lg"
                        >
                          {t('Aceptar')}
                        </button>
                        <button
                          onClick={() => respondRescheduleMutation.mutate({ id: c.id, decision: 'REJECT' })}
                          className="text-xs bg-white border border-[#DDE1EE] text-[#475569] px-3 py-1 rounded-lg"
                        >
                          {t('Rechazar')}
                        </button>
                      </div>
                    </div>
                  )}

                  {hasOwnPendingProposal && (
                    <p className="ml-12 mt-2 text-xs text-[#64748B]">
                      {t('Propusiste cambiar el horario — esperando respuesta del paciente.')}
                    </p>
                  )}

                  {/* Acciones: reprogramar / reportar inasistencia */}
                  {!c.reschedule_proposed_at && (
                    <div className="ml-12 mt-2 flex items-center gap-3 flex-wrap">
                      {!c.reschedule_used && c.created_by_role !== 'PROFESSIONAL' && (
                        reschedulingId === c.id ? (
                          <div className="flex items-center gap-2">
                            <SpanishDateTimePicker
                              value={newDateTime}
                              onChange={setNewDateTime}
                            />
                            <button
                              onClick={() => newDateTime && proposeRescheduleMutation.mutate({ id: c.id, newScheduledAt: newDateTime })}
                              disabled={!newDateTime || proposeRescheduleMutation.isPending}
                              className="text-xs text-[#185FA5] font-medium disabled:opacity-50"
                            >
                              {t('Enviar propuesta')}
                            </button>
                            <button onClick={() => setReschedulingId(null)} className="text-xs text-[#475569]">
                              {t('Cancelar')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setReschedulingId(c.id); setNewDateTime('') }}
                            className="text-xs text-[#185FA5] font-medium"
                          >
                            {t('Proponer otro horario')}
                          </button>
                        )
                      )}
                      {c.created_by_role !== 'PROFESSIONAL' && (
                        <button
                          onClick={() => noShowPatientMutation.mutate(c.id)}
                          disabled={!graceOk || noShowPatientMutation.isPending}
                          title={!graceOk ? 'Disponible 10 min después de la hora de la cita' : ''}
                          className="text-xs text-[#A32D2D] disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('El paciente no llegó')}
                        </button>
                      )}
                      <button
                        onClick={() => setCancelTarget({
                          id: c.id,
                          patientName: patientNameOf(c) || 'el paciente',
                          scheduledAt: scheduledAt,
                        })}
                        disabled={cancelByProfessionalMutation.isPending}
                        className="text-xs text-[#A32D2D] font-medium border border-[#A32D2D] px-2 py-1 rounded-lg disabled:opacity-40"
                      >
                        {t('Cancelar cita')}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── En curso ── */}
        {active.length > 0 && (
          <div className="card mb-4">
            <h2 className="text-sm font-semibold mb-3">{t('En curso ahora')}</h2>
            {active.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5 border-b border-[#DDE1EE] last:border-0">
                <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-9 h-9" colorClasses="bg-[#E1F5EE] text-[#0F6E56]" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{patientNameOf(c) || 'Paciente'}</p>
                  <p className="text-xs text-[#475569]">
                    {c.specialty || 'Consulta general'} · Iniciada {new Date(c.started_at || c.created_at).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <button
                    onClick={() => setHistoryPatient({ id: c.patient_id, name: patientNameOf(c) || 'el paciente' })}
                    className="text-xs text-[#185FA5] font-medium mt-0.5"
                  >
                    {t('🗂️ Ver historial del paciente')}
                  </button>
                </div>
                <button
                  onClick={() => updateMutation.mutate({ id: c.id, status: 'COMPLETED' })}
                  className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] text-xs px-3 py-1.5 rounded-lg"
                >
                  {t('Finalizar')}
                </button>
                <button
                  onClick={() => rejoinVideoMutation.mutate(c.id)}
                  disabled={rejoinVideoMutation.isPending}
                  className="btn-primary text-xs py-1.5 px-3"
                >
                  {rejoinVideoMutation.isPending ? 'Conectando...' : '📹 Volver a llamada'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Historial reciente */}
        <div className="card">
          <h2 className="text-sm font-semibold mb-3">{t('Consultas recientes')}</h2>
          {consultations.length === 0 ? (
            <p className="text-sm text-[#475569] text-center py-4">{t('Aún no tienes consultas')}</p>
          ) : (
            <div className="divide-y divide-[#DDE1EE]">
              {consultations.slice(0, 5).map((c: any) => {
                const isCancelled = c.status === 'CANCELLED' || c.status === 'REFUNDED'
                const who = isCancelled ? cancelledByLabel(c) : null
                const wasRefunded = wasActuallyRefunded(c)
                return (
                  <div key={c.id} className="py-2.5 flex items-start gap-3">
                    <PatientAvatar firstName={c.patient_first_name} lastName={c.patient_last_name} photoUrl={c.patient_photo_url} size="w-8 h-8" colorClasses="bg-[#F5F6FA] text-[#475569]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{patientNameOf(c) || c.specialty || 'Consulta'}</p>
                      <p className="text-xs text-[#475569] truncate">
                        {c.specialty ? `${c.specialty} · ` : ''}
                        {new Date(c.created_at + (c.created_at?.endsWith('Z') ? '' : 'Z')).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' })} · Bs. {parseFloat(c.professional_earning).toFixed(2)}
                      </p>
                      {isCancelled && (
                        <>
                          <p className="text-xs text-[#475569] mt-0.5 truncate">
                            {outcomeLabel(c, 'PROFESSIONAL')}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {who && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#475569]">
                                {who}
                              </span>
                            )}
                            {c.updated_at && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F5F6FA] text-[#475569]">
                                {fmtFechaHora(c.updated_at)}
                              </span>
                            )}
                          </div>
                          {wasRefunded && (
                            <p className="text-[11px] text-emerald-600 mt-1 truncate">
                              💸 Reembolsada{c.payment_refunded_at ? ` el ${fmtFechaHora(c.payment_refunded_at)}` : ''}
                            </p>
                          )}
                        </>
                      )}
                      {!isCancelled && c.payment_status === 'DISPUTED' && (
                        <p className="text-[11px] text-[#A32D2D] font-medium mt-1">
                          {t('⚠️ El paciente reportó un problema — en revisión')}
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
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        c.status === 'COMPLETED'           ? 'badge-green' :
                        c.status === 'IN_PROGRESS'         ? 'badge-blue'  :
                        c.status === 'WAITING_PROFESSIONAL'? 'badge-amber' :
                        c.status === 'PAYMENT_CONFIRMED'   ? 'badge-blue'  : 'badge-gray'
                      }`}>
                        {c.status === 'COMPLETED'            ? 'Completada' :
                         c.status === 'IN_PROGRESS'          ? 'En curso' :
                         c.status === 'WAITING_PROFESSIONAL' ? 'Solicitud' :
                         c.status === 'PAYMENT_CONFIRMED'    ? (c.created_by_role === 'PROFESSIONAL' ? 'Cita confirmada' : 'Pago confirmado') :
                         c.status === 'CANCELLED'            ? 'Cancelada' :
                         c.status === 'REFUNDED'             ? 'Reembolsada' : 'Pendiente'}
                      </span>
                      {!isCancelled && (
                        <div className="flex flex-col items-end gap-1">
                          <PaymentBadge consultation={c} viewerRole="PROFESSIONAL" />
                          {c.created_by_role === 'PROFESSIONAL' && <ModalityBadge consultation={c} />}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {/* ── Modal de confirmación de cancelación ── */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            {/* Icono */}
            <div className="w-14 h-14 rounded-full bg-[#FCEBEB] flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C03A39" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>

            <h3 className="text-base font-semibold text-center text-[#1C2340] mb-1">
              {t('¿Cancelar esta cita?')}
            </h3>
            <p className="text-xs text-center text-[#475569] mb-1">
              {t('Paciente:')} <span className="font-medium text-[#3C4257]">{cancelTarget.patientName}</span>
            </p>
            {cancelTarget.scheduledAt && (
              <p className="text-xs text-center text-[#475569] mb-4">
                {t('Fecha:')} <span className="font-medium text-[#3C4257]">
                  {cancelTarget.scheduledAt.toLocaleString('es-BO', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </p>
            )}

            <div className="bg-[#FFF8EC] border border-[#FAC775] rounded-xl px-4 py-3 mb-5">
              <p className="text-xs text-[#854F0B] font-medium mb-1">{t('💰 Reembolso automático')}</p>
              <p className="text-xs text-[#6B4A1A]">
                {t('Si el paciente ya realizó el pago, el dinero le será devuelto automáticamente al cancelar.')}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#DDE1EE] text-sm text-[#475569] hover:bg-[#F5F6FA] transition-colors"
              >
                {t('Volver')}
              </button>
              <button
                onClick={() => {
                  cancelByProfessionalMutation.mutate(cancelTarget.id)
                  setCancelTarget(null)
                }}
                disabled={cancelByProfessionalMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-[#C03A39] text-white text-sm font-medium hover:bg-[#A32D2D] transition-colors disabled:opacity-50"
              >
                {cancelByProfessionalMutation.isPending ? 'Cancelando...' : 'Sí, cancelar cita'}
              </button>
            </div>
          </div>
        </div>
      )}
      {rxConsultationId && (
        <PrescriptionModal consultationId={rxConsultationId} onClose={() => setRxConsultationId(null)} />
      )}
      {noteConsultationId && (
        <ClinicalNoteModal consultationId={noteConsultationId} onClose={() => setNoteConsultationId(null)} />
      )}
      {historyPatient && (
        <PatientHistoryModal
          patientId={historyPatient.id}
          patientName={historyPatient.name}
          showSharedFromOthers={true}
          onClose={() => setHistoryPatient(null)}
        />
      )}
    </DashboardLayout>
  )
}