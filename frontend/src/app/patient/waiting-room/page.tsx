'use client'
// src/app/patient/waiting-room/page.tsx

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { Alert } from '@/components/ui'
import { consultationsAPI, professionalsAPI, getErrorMessage } from '@/lib/api'
import type { Payment, ConsultationStatus, Consultation } from '@/types'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// Flujo INMEDIATA: médico acepta → paciente paga → videollamada
const STATUS_STEPS_IMMEDIATE = [
  { key: 'WAITING_PROFESSIONAL', label: 'Médico acepta',       sub: () => 'El médico tiene 5 minutos para aceptar' },
  { key: 'WAITING_PAYMENT',      label: 'Pago QR',             sub: () => 'Escanea el QR con tu app bancaria (5 min)' },
  { key: 'PAYMENT_CONFIRMED',    label: 'Pago confirmado',     sub: () => 'El médico iniciará la llamada en breve' },
  { key: 'IN_PROGRESS',          label: 'Videoconsulta',       sub: () => '' },
]

// Flujo AGENDADA: paciente paga → médico confirma → cita en fecha programada → videollamada
const STATUS_STEPS_SCHEDULED = [
  { key: 'WAITING_PAYMENT',      label: 'Pago QR',             sub: () => 'Confirmá tu cita pagando ahora (30 min)' },
  { key: 'WAITING_PROFESSIONAL', label: 'Médico confirma',     sub: () => 'El profesional tiene hasta la hora de la cita para confirmar' },
  { key: 'PAYMENT_CONFIRMED',    label: 'Cita confirmada',     sub: () => 'Tu cita está reservada — espera la fecha programada' },
  { key: 'IN_PROGRESS',          label: 'Videoconsulta',       sub: () => '' },
]

// Flujo AGENDADA POR EL PROFESIONAL: el profesional la agenda directamente
// (membresía) y queda confirmada de una — sin pago QR ni espera de
// confirmación, porque el cobro es directo entre ambos.
const STATUS_STEPS_PROFESSIONAL_SCHEDULED = [
  { key: 'PAYMENT_CONFIRMED', label: 'Cita confirmada', sub: () => 'Tu profesional agendó esta cita directamente para ti' },
  { key: 'IN_PROGRESS',       label: 'Consulta',         sub: () => '' },
]

// Helper para obtener los steps según el tipo de consulta
type WaitingRoomKind = 'IMMEDIATE' | 'PATIENT_SCHEDULED' | 'PROFESSIONAL_SCHEDULED'
const getSteps = (kind: WaitingRoomKind) => {
  if (kind === 'PROFESSIONAL_SCHEDULED') return STATUS_STEPS_PROFESSIONAL_SCHEDULED
  if (kind === 'PATIENT_SCHEDULED') return STATUS_STEPS_SCHEDULED
  return STATUS_STEPS_IMMEDIATE
}
function kindOf(c: { consultation_type?: string | null; created_by_role?: string | null } | null | undefined): WaitingRoomKind {
  if (!c) return 'IMMEDIATE'
  if (c.consultation_type !== 'SCHEDULED' && c.consultation_type !== 'FOLLOW_UP') return 'IMMEDIATE'
  return c.created_by_role === 'PROFESSIONAL' ? 'PROFESSIONAL_SCHEDULED' : 'PATIENT_SCHEDULED'
}

const ACTIVE_STATUSES = ['WAITING_PROFESSIONAL', 'WAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'IN_PROGRESS']

// Timer genérico con cuenta regresiva
function CountdownTimer({ seconds, label, onExpired }: { seconds: number; label: string; onExpired?: () => void }) {
  const [secs, setSecs] = useState(seconds)
  useEffect(() => {
    if (secs <= 0) { onExpired?.(); return }
    const id = setTimeout(() => setSecs(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [secs])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return (
    <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-full px-3 py-1 inline-flex items-center gap-2">
      <span className="text-[#854F0B] text-xs">{label}</span>
      <span className="text-[#854F0B] font-bold text-sm font-mono">{m}:{s.toString().padStart(2, '0')}</span>
    </div>
  )
}

// Cuenta regresiva para que el médico acepte/rechace una CITA AGENDADA.
// El plazo real es el MENOR entre "24h desde que se pidió" y "30 minutos
// antes de la hora de la cita" (mismo cálculo que usa el backend al crear
// la consulta: nunca debe quedar margen menor a 30 min entre la respuesta
// y la cita, porque después falta tiempo de pagar el QR y prepararse).
const PROFESSIONAL_RESPONSE_CUTOFF_BEFORE_APPOINTMENT_MINUTES = 30

// ── SlotPicker: selector de fecha + horarios disponibles del profesional ──────
// Muestra un calendario en español (lunes primero) y los slots del profesional
// como botones, igual que en el flujo de agendar cita.
const DAYS_ES  = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function SlotPicker({
  professionalId, value, onChange, onConfirm, onCancel,
}: {
  professionalId: string
  value: string
  onChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useLanguage()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [slots,    setSlots]    = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string>('')

  // Días del mes en cuadrícula lun→dom
  const firstDay = new Date(viewYear, viewMonth, 1)
  const startOffset = (firstDay.getDay() + 6) % 7  // 0=lun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  async function pickDate(day: number) {
    const d = new Date(viewYear, viewMonth, day)
    d.setHours(0, 0, 0, 0)
    if (d < today) return
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    console.log('[DEBUG pickDate] professionalId:', JSON.stringify(professionalId), 'iso:', iso)
    setSelectedDate(iso)
    setSelectedSlot('')
    onChange('')
    setLoadingSlots(true)
    try {
      console.log('[DEBUG pickDate] llamando getAvailableSlots...')
      const res = await professionalsAPI.getAvailableSlots(professionalId, iso)
      console.log('[DEBUG pickDate] respuesta:', res.data)
      setSlots(res.data.slots ?? [])
    } catch (err) {
      console.log('[DEBUG pickDate] ERROR:', err)
      setSlots([])
    } finally { setLoadingSlots(false) }
  }

  function pickSlot(slot: string) {
    setSelectedSlot(slot)
    // slot viene en hora Bolivia naive (ej. "2026-07-03T21:00:00"), igual que
    // scheduled_at en el resto del sistema — no se le agrega 'Z'.
    const local = slot.slice(0, 16) // "YYYY-MM-DDTHH:MM"
    onChange(local)
  }

  function fmtSlot(slot: string) {
    const [, hh, mm] = slot.match(/T(\d{2}):(\d{2})/) ?? []
    const h = parseInt(hh, 10)
    const ampm = h >= 12 ? 'p. m.' : 'a. m.'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${String(h12).padStart(2, '0')}:${mm} ${ampm}`
  }

  return (
    <div className="border border-[#DDE1EE] rounded-xl p-3 bg-[#F9FAFC] space-y-3">
      {/* Cabecera mes/año */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
          className="text-[#6B738A] hover:text-[#185FA5] px-2 py-1 text-sm"
        >‹</button>
        <span className="text-sm font-semibold text-[#1B2B5E]">
          {MONTHS_ES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={() => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
          className="text-[#6B738A] hover:text-[#185FA5] px-2 py-1 text-sm"
        >›</button>
      </div>

      {/* Cuadrícula días — Lun primero */}
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAYS_ES.map(d => (
          <div key={d} className="text-[10px] text-[#A0A8BF] font-medium py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const d = new Date(viewYear, viewMonth, day)
          const isPast = d < today
          const isoD = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isSelected = isoD === selectedDate
          return (
            <button
              key={i}
              disabled={isPast}
              onClick={() => pickDate(day)}
              className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                isSelected  ? 'bg-[#185FA5] text-white' :
                isPast      ? 'text-[#C8CCD8] cursor-not-allowed' :
                              'text-[#1B2B5E] hover:bg-[#E6F1FB]'
              }`}
            >{day}</button>
          )
        })}
      </div>

      {/* Slots del profesional */}
      {selectedDate && (
        <div>
          <p className="text-xs text-[#6B738A] mb-2 font-medium">
            Horarios disponibles — {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {loadingSlots ? (
            <div className="flex justify-center py-3">
              <div className="w-4 h-4 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : slots.length === 0 ? (
            <p className="text-xs text-[#A0A8BF] text-center py-2">{t('No hay horarios disponibles este día')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map(slot => (
                <button
                  key={slot}
                  onClick={() => pickSlot(slot)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                    selectedSlot === slot
                      ? 'bg-[#185FA5] text-white border-[#185FA5]'
                      : 'bg-white text-[#185FA5] border-[#C3D6EF] hover:bg-[#E6F1FB]'
                  }`}
                >{fmtSlot(slot)}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Botones acción */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onConfirm}
          disabled={!value}
          className="flex-1 py-2 bg-[#185FA5] text-white text-xs font-medium rounded-lg disabled:opacity-40 hover:bg-[#0d4a85] transition-colors"
        >
          {t('Enviar propuesta')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs text-[#6B738A] border border-[#DDE1EE] rounded-lg hover:bg-[#F5F6FA] transition-colors"
        >
          {t('Cancelar')}
        </button>
      </div>
    </div>
  )
}

function ScheduledAcceptDeadlineTimer({ createdAt, scheduledAt }: { createdAt: string; scheduledAt?: string | null }) {
  const { t } = useLanguage()
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
      <p className="text-xs text-[#A0A8BF] mb-3">
        {limitedByAppointment ? 'La cita ya está muy próxima — esperando respuesta del profesional' : 'El plazo de respuesta del profesional venció'}
      </p>
    )
  }

  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3 ${isUrgent ? 'bg-[#FBEAEA] border border-[#F3A6A5]' : 'bg-[#FAEEDA] border border-[#FAC775]'}`}>
      <span className={`text-xs ${isUrgent ? 'text-[#9B2C2B]' : 'text-[#854F0B]'}`}>{t('Plazo para confirmar')}</span>
      <span className={`font-bold text-sm font-mono ${isUrgent ? 'text-[#9B2C2B]' : 'text-[#854F0B]'}`}>
        {days > 0 && `${days}d `}{hours.toString().padStart(2, '0')}h {mins.toString().padStart(2, '0')}m {s.toString().padStart(2, '0')}s
      </span>
    </div>
  )
}

function QRTimer({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const { t } = useLanguage()
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const expiry = new Date(expiresAt.endsWith('Z') ? expiresAt : expiresAt + 'Z').getTime()
    const tick = () => {
      const left = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
      setSecs(left)
      if (left === 0) onExpired()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt, onExpired])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-full px-3 py-1 flex items-center gap-2">
        <span className="text-[#854F0B] text-xs">{t('Expira en')}</span>
        <span className="text-[#854F0B] font-bold text-sm font-mono">{m}:{s.toString().padStart(2, '0')}</span>
      </div>
      {secs === 0 && <span className="text-xs text-red-500 font-medium">{t('QR expirado')}</span>}
    </div>
  )
}

// Mensajes rotativos para entretener al paciente mientras espera
const WAITING_TIPS = [
  { icon: '💡', text: 'Prepará papel y lápiz por si necesitás anotar indicaciones del médico.' },
  { icon: '🎧', text: 'Usá auriculares para una mejor experiencia durante la videollamada.' },
  { icon: '💡', text: 'Buscá un lugar tranquilo y con buena iluminación para la consulta.' },
  { icon: '📶', text: 'Asegurate de tener buena conexión a internet para evitar interrupciones.' },
  { icon: '✅', text: 'Tu pago fue confirmado exitosamente. La consulta está garantizada.' },
  { icon: '🩺', text: 'El médico ya recibió la notificación y se está preparando para atenderte.' },
  { icon: '📋', text: 'Pensá en los síntomas que querés describir para aprovechar mejor el tiempo.' },
  { icon: '😌', text: 'Relajate, estás en buenas manos. El médico iniciará la llamada en breve.' },
]

function WaitingForDoctor({
  paymentPaidAt, onCancelNoVideo, cancelling, error, actionMessage,
}: {
  paymentPaidAt?: string | null
  onCancelNoVideo: () => void
  cancelling: boolean
  error: string
  actionMessage: string
}) {
  const { t } = useLanguage()
  const [tipIndex, setTipIndex]   = useState(0)
  const [fade, setFade]           = useState(true)
  const [elapsedSecs, setElapsed] = useState(0)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  const GRACE_MINUTES = 15

  // Rotar mensajes cada 6 segundos con fade
  useEffect(() => {
    const id = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setTipIndex(i => (i + 1) % WAITING_TIPS.length)
        setFade(true)
      }, 400)
    }, 6000)
    return () => clearInterval(id)
  }, [])

  // Contador de tiempo de espera
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const mins = Math.floor(elapsedSecs / 60)
  const secs = elapsedSecs % 60
  const tip  = WAITING_TIPS[tipIndex]

  // Tiempo transcurrido desde que se confirmó el pago — independiente del
  // contador visual de arriba, basado en el dato real del servidor.
  const elapsedSincePayment = paymentPaidAt
    ? (Date.now() - new Date(paymentPaidAt.endsWith('Z') ? paymentPaidAt : paymentPaidAt + 'Z').getTime()) / 60000
    : 0
  const canCancel = paymentPaidAt ? elapsedSincePayment >= GRACE_MINUTES : false
  const minsRemaining = Math.max(0, Math.ceil(GRACE_MINUTES - elapsedSincePayment))

  return (
    <div className="card text-center py-6 px-4">
      {error && <div className="mb-3"><Alert type="error" message={error} /></div>}
      {actionMessage && <div className="mb-3"><Alert type="success" message={actionMessage} /></div>}

      {/* Ícono animado */}
      <div className="relative w-20 h-20 mx-auto mb-4">
        <div className="absolute inset-0 rounded-full bg-[#E6F1FB] animate-ping opacity-30" />
        <div className="absolute inset-1 rounded-full bg-[#E6F1FB] animate-ping opacity-20" style={{ animationDelay: '0.5s' }} />
        <div className="relative w-20 h-20 rounded-full bg-[#E6F1FB] border-2 border-[#185FA5] flex items-center justify-center text-3xl">
          👨‍⚕️
        </div>
      </div>

      <p className="text-base font-bold text-[#141820] mb-1">{t('El médico está preparándose')}</p>
      <p className="text-xs text-[#6B738A] mb-4">{t('Iniciará la videollamada en unos momentos. Por favor no cerrés esta página.')}</p>

      {/* Timer de espera */}
      <div className="inline-flex items-center gap-2 bg-[#E6F1FB] border border-[#B8D4F0] rounded-full px-4 py-1.5 mb-5">
        <span className="text-[#185FA5] text-xs">{t('⏱ Tiempo de espera')}</span>
        <span className="text-[#185FA5] font-bold text-sm font-mono">
          {mins}:{secs.toString().padStart(2, '0')}
        </span>
      </div>

      {/* Barra de progreso animada */}
      <div className="w-full bg-[#DDE1EE] rounded-full h-1.5 mb-5 overflow-hidden">
        <div
          className="h-full bg-[#185FA5] rounded-full"
          style={{
            width: '60%',
            animation: 'progressPulse 2s ease-in-out infinite alternate',
          }}
        />
      </div>
      <style>{`
        @keyframes progressPulse {
          from { width: 30%; }
          to   { width: 85%; }
        }
      `}</style>

      {/* Indicador de conexión */}
      <div className="flex items-center justify-center gap-1.5 mb-5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-[#185FA5]"
            style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
        <span className="text-xs text-[#6B738A] ml-1">{t('Conectando con el médico...')}</span>
      </div>

      {/* Tip rotativo */}
      <div
        className="bg-[#F5F6FA] rounded-xl px-4 py-3 text-left transition-opacity duration-400"
        style={{ opacity: fade ? 1 : 0 }}
      >
        <p className="text-xs text-[#6B738A] mb-1 font-medium uppercase tracking-wide">{t('Mientras esperás')}</p>
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">{tip.icon}</span>
          <p className="text-sm text-[#141820]">{tip.text}</p>
        </div>
        {/* Indicadores de paginación */}
        <div className="flex justify-center gap-1 mt-3">
          {WAITING_TIPS.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === tipIndex ? 'w-4 h-1.5 bg-[#185FA5]' : 'w-1.5 h-1.5 bg-[#DDE1EE]'
              }`}
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-[#A0A8BF] mt-4">
        {t('🔒 Tu pago está confirmado · La consulta está garantizada')}
      </p>

      {/* GAP 1: cancelación voluntaria — habilitada a los 15 min del pago */}
      <div className="mt-5 pt-4 border-t border-[#DDE1EE]">
        {canCancel ? (
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={cancelling}
            className="text-xs text-[#A32D2D] hover:underline disabled:opacity-50"
          >
            {t('El médico no inició la videollamada — cancelar y pedir devolución')}
          </button>
        ) : (
          <p className="text-xs text-[#A0A8BF]">
            Si el médico no inicia la videollamada, podrás cancelar y pedir devolución
            en {minsRemaining} min.
          </p>
        )}
      </div>

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full text-left">
            <h3 className="text-base font-semibold text-[#1C2340] mb-2">{t('¿Cancelar y pedir devolución?')}</h3>
            <p className="text-sm text-[#6B738A] mb-4">
              Ya pasaron {GRACE_MINUTES} minutos desde tu pago y el médico no inició la videollamada.
              Si cancelas, recibirás la devolución completa de tu dinero.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 text-sm text-[#6B738A] border border-[#DDE1EE] rounded-xl py-2.5 hover:bg-[#F5F6FA] transition-colors"
              >
                {t('Seguir esperando')}
              </button>
              <button
                onClick={() => { setShowCancelConfirm(false); onCancelNoVideo() }}
                disabled={cancelling}
                className="flex-1 text-sm font-semibold text-white bg-[#E24B4A] rounded-xl py-2.5 hover:bg-[#C03A39] transition-colors disabled:opacity-60"
              >
                {cancelling ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Tarjeta para citas AGENDADAS ya pagadas — distinta de WaitingForDoctor porque
// no hay que "esperar que inicie en cualquier momento": la cita es a futuro.
function AppointmentCountdown({ scheduledAt }: { scheduledAt: Date }) {
  const { t } = useLanguage()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const diff = scheduledAt.getTime() - Date.now()
  if (diff <= 0) return null

  const days  = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const secs  = Math.floor((diff % (1000 * 60)) / 1000)

  const parts: { label: string; value: number }[] = []
  if (days  > 0) parts.push({ label: 'días',    value: days  })
  if (hours > 0 || days  > 0) parts.push({ label: 'horas',   value: hours })
  if (mins  > 0 || hours > 0 || days > 0) parts.push({ label: 'min',     value: mins  })
  parts.push({ label: 'seg', value: secs })

  return (
    <div className="mb-4">
      <p className="text-xs text-[#6B738A] mb-2">{t('Tu cita comienza en')}</p>
      <div className="flex justify-center gap-2">
        {parts.map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center bg-[#F0F5FB] rounded-xl px-3 py-2 min-w-[52px]">
            <span className="text-xl font-mono font-bold text-[#185FA5] leading-none">
              {String(value).padStart(2, '0')}
            </span>
            <span className="text-[10px] text-[#6B738A] mt-0.5">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScheduledConfirmedCard({
  consultation, error, actionMessage, busyMessage,
  reschedulingOpen, setReschedulingOpen, newDateTime, setNewDateTime,
  onProposeReschedule, onRespondReschedule, onCancelWithRefund, onReportNoShow,
  onCancelNoVideo, cancellingNoVideo,
}: {
  consultation: any
  error: string
  actionMessage: string
  busyMessage: string | null
  reschedulingOpen: boolean
  setReschedulingOpen: (v: boolean) => void
  newDateTime: string
  setNewDateTime: (v: string) => void
  onProposeReschedule: () => void
  onRespondReschedule: (decision: 'ACCEPT' | 'REJECT') => void
  onCancelWithRefund: () => void
  onReportNoShow: () => void
  onCancelNoVideo: () => void
  cancellingNoVideo: boolean
}) {
  const { t } = useLanguage()
  const scheduledAt = consultation?.scheduled_at ? new Date(consultation.scheduled_at) : null
  const now = Date.now()
  const timeArrived = scheduledAt ? now >= scheduledAt.getTime() : false
  // GAP 2: el reporte de no-show (médico → paciente no llegó) usa 60 min de gracia
  const graceOk = scheduledAt ? now - scheduledAt.getTime() >= 60 * 60 * 1000 : false
  // GAP 2: el botón de cancelación voluntaria del paciente (médico no inició video) usa 15 min
  const VIDEO_GRACE_MINUTES = 15
  const minsSinceScheduled = scheduledAt ? (now - scheduledAt.getTime()) / 60000 : 0
  const canCancelNoVideo = scheduledAt && minsSinceScheduled >= VIDEO_GRACE_MINUTES
  const minsUntilCancelNoVideo = Math.max(0, Math.ceil(VIDEO_GRACE_MINUTES - minsSinceScheduled))
  const hoursUntil = scheduledAt ? (scheduledAt.getTime() - now) / (1000 * 60 * 60) : 0
  const canCancelWithRefund = hoursUntil >= 24 && !consultation?.reschedule_used
  const RESCHEDULE_MAX_ATTEMPTS = 3
  const attemptsRemaining = Math.max(0, RESCHEDULE_MAX_ATTEMPTS - (consultation?.reschedule_attempts ?? 0))

  const hasProposalFromProfessional = consultation?.reschedule_proposed_at && consultation?.reschedule_proposed_by === 'PROFESSIONAL'
  const hasOwnPendingProposal = consultation?.reschedule_proposed_at && consultation?.reschedule_proposed_by === 'PATIENT'
  // Las citas que agendó el propio profesional (membresía) no siguen el
  // flujo de negociación de reprogramación ni el reembolso vía plataforma
  // — el cobro es directo, así que cualquier cambio lo coordina el
  // profesional directamente contigo (por eso él tiene sus propios botones
  // de reprogramar/cancelar en su calendario).
  const isProfessionalScheduled = consultation?.created_by_role === 'PROFESSIONAL'
  const isInPerson = consultation?.modality === 'IN_PERSON'

  return (
    <div className="card text-center py-6 px-4">
      {error && <div className="mb-3"><Alert type="error" message={error} /></div>}
      {actionMessage && <div className="mb-3"><Alert type="success" message={actionMessage} /></div>}
      {busyMessage && <div className="mb-3"><Alert type="warning" message={busyMessage} /></div>}

      <div className="w-16 h-16 rounded-full bg-[#E6F1FB] border-2 border-[#185FA5] flex items-center justify-center text-2xl mx-auto mb-3">
        {isProfessionalScheduled && isInPerson ? '🏥' : '📅'}
      </div>
      <p className="text-sm font-semibold mb-1">{t('Tu cita está confirmada')}</p>
      {scheduledAt && (
        <p className="text-base text-[#185FA5] font-bold mb-1">
          {scheduledAt.toLocaleString('es-BO', {
            weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
          })}
        </p>
      )}
      {scheduledAt && !timeArrived && (
        <AppointmentCountdown scheduledAt={scheduledAt} />
      )}
      <p className="text-xs text-[#6B738A] mb-4">
        {isProfessionalScheduled
          ? (isInPerson
              ? 'Esta es una consulta presencial — preséntate en el consultorio de tu profesional a la hora indicada.'
              : (timeArrived
                  ? 'Tu médico debería estar conectándose. Si tarda, contáctalo directamente.'
                  : 'Recibirás el acceso a la videollamada cuando llegue la hora.'))
          : (timeArrived
              ? 'Tu médico debería estar conectándose. Si tarda, en breve podrás reportarlo.'
              : 'Recibirás el acceso a la videollamada cuando llegue la hora.')}
      </p>

      {isProfessionalScheduled ? (
        <p className="text-xs text-[#A0A8BF] bg-[#F5F6FA] rounded-lg px-3 py-2.5">
          Esta cita te la agendó directamente tu profesional (con membresía) — el cobro es directo entre
          ustedes. Si necesitas cambiar el horario o cancelarla, contáctalo directamente por mensajes.
        </p>
      ) : (
        <>
      {/* Propuesta del profesional — debo responder */}
      {hasProposalFromProfessional && (
        <div className="bg-[#FAEEDA] border border-[#F3D08A] rounded-lg px-3 py-3 mb-4 text-left">
          <p className="text-xs text-[#854F0B] font-medium mb-2">
            El profesional propone cambiar tu cita a{' '}
            {new Date(consultation.reschedule_proposed_at).toLocaleString('es-BO', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            })}
          </p>
          <p className="text-xs text-[#A0A8BF] mb-2">
            {attemptsRemaining > 0
              ? `Quedan ${attemptsRemaining} propuesta(s) de reprogramación si rechazas.`
              : 'Esta es la última propuesta posible para esta cita.'}
          </p>
          <div className="flex gap-2">
            <button onClick={() => onRespondReschedule('ACCEPT')} className="flex-1 text-xs bg-[#1D9E75] text-white py-1.5 rounded-lg">
              {t('Aceptar')}
            </button>
            <button onClick={() => onRespondReschedule('REJECT')} className="flex-1 text-xs bg-white border border-[#DDE1EE] text-[#6B738A] py-1.5 rounded-lg">
              {t('Rechazar')}
            </button>
          </div>
        </div>
      )}

      {hasOwnPendingProposal && (
        <p className="text-xs text-[#A0A8BF] mb-4">{t('Propusiste otro horario — esperando respuesta del profesional.')}</p>
      )}

      {/* Acciones: reportar inasistencia (solo si ya llegó la hora + gracia) */}
      {timeArrived && (
        <button
          onClick={onReportNoShow}
          disabled={!graceOk}
          title={!graceOk ? 'Disponible 60 min después de la hora de la cita' : ''}
          className="w-full py-2 px-4 bg-[#FCEBEB] hover:bg-[#F9D8D8] text-[#A32D2D] text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-2"
        >
          {t('El profesional no llegó')}
        </button>
      )}

      {/* GAP 2: el médico no inició la videollamada a la hora — el paciente decide cuándo cancelar */}
      {timeArrived && (
        canCancelNoVideo ? (
          <button
            onClick={onCancelNoVideo}
            disabled={cancellingNoVideo}
            className="w-full py-2 px-4 bg-white border border-[#F09595] hover:bg-[#FCEBEB] text-[#A32D2D] text-xs font-medium rounded-lg transition-colors disabled:opacity-50 mb-2"
          >
            {cancellingNoVideo ? 'Cancelando…' : 'El médico no inició la videollamada — cancelar y pedir devolución'}
          </button>
        ) : (
          <p className="text-xs text-[#A0A8BF] mb-3">
            Si el médico no inicia la videollamada, podrás cancelar con devolución en {minsUntilCancelNoVideo} min.
          </p>
        )
      )}

      {/* Acciones: reprogramar / cancelar — solo si todavía no llegó la hora */}
      {!timeArrived && !hasProposalFromProfessional && !hasOwnPendingProposal && (
        <div className="space-y-2">
          {!consultation?.reschedule_used && attemptsRemaining > 0 && (
            reschedulingOpen ? (
              <SlotPicker
                professionalId={consultation?.professional_id ?? ''}
                value={newDateTime}
                onChange={setNewDateTime}
                onConfirm={onProposeReschedule}
                onCancel={() => setReschedulingOpen(false)}
              />
            ) : (
              <div>
                <button onClick={() => setReschedulingOpen(true)} className="w-full btn-secondary text-sm py-2">
                  {t('Proponer otro horario')}
                </button>
                <p className="text-xs text-[#A0A8BF] mt-1">
                  Te quedan {attemptsRemaining} propuesta(s) de reprogramación.
                </p>
              </div>
            )
          )}
          {!consultation?.reschedule_used && attemptsRemaining === 0 && (
            <p className="text-xs text-[#A0A8BF]">
              {t('Ya se alcanzó el máximo de propuestas de reprogramación para esta cita.')}
            </p>
          )}
          {canCancelWithRefund && (
            <button onClick={onCancelWithRefund} className="w-full text-xs text-[#A32D2D] hover:underline py-1">
              {t('Cancelar y recibir devolución (aviso ≥24h)')}
            </button>
          )}
        </div>
      )}
      </>
      )}
    </div>
  )
}

export default function WaitingRoomPage() {
  const { t } = useLanguage()
  const params = useSearchParams()
  const router = useRouter()
  const consultationIdFromUrl = params.get('consultationId')

  const [allActive, setAllActive] = useState<any[]>([])
  const [activeTabIdx, setActiveTabIdx] = useState(0)
  const [resolvedId, setResolvedId] = useState<string | null>(consultationIdFromUrl)
  const [consultation, setConsultation] = useState<Consultation | null>(null)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [consultationStatus, setConsultationStatus] = useState<ConsultationStatus | null>(null)
  const [consultationCreatedAt, setConsultationCreatedAt] = useState<string | null>(null)
  const [qrExpired, setQrExpired] = useState(false)
  const [loadingQR, setLoadingQR] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [simulatingPayment, setSimulatingPayment] = useState(false)
  const [error, setError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [reschedulingOpen, setReschedulingOpen] = useState(false)
  const [newDateTime, setNewDateTime] = useState('')
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [cancellingRequest, setCancellingRequest] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancellingNoVideo, setCancellingNoVideo] = useState(false)
  const qrGeneratedRef = useRef(false)

  // Cambiar de pestaña — resetea QR y estado de la nueva consulta
  function switchTab(idx: number, consultations: any[]) {
    const c = consultations[idx]
    if (!c) return
    setActiveTabIdx(idx)
    setResolvedId(c.id)
    setConsultation(c)
    setConsultationStatus(c.status)
    setConsultationCreatedAt(c.created_at)
    setPayment(null)
    setQrExpired(false)
    setError('')
    setActionMessage('')
    qrGeneratedRef.current = false
    if (c.status === 'WAITING_PAYMENT') {
      qrGeneratedRef.current = true
      generateQR(c.id)
    }
    window.history.replaceState(null, '', `/patient/waiting-room?consultationId=${c.id}`)
  }

  const isDev = process.env.NEXT_PUBLIC_SIMULATE_PAYMENT === 'true'

  useEffect(() => { initPage() }, [])

  async function initPage() {
    setLoadingStatus(true)
    try {
      const res = await consultationsAPI.getMyConsultations()
      const consultations = res.data
      const actives = consultations.filter((c: any) => ACTIVE_STATUSES.includes(c.status))
      setAllActive(actives)

      let targetId = consultationIdFromUrl
      let targetIdx = 0

      if (targetId) {
        const idx = actives.findIndex((c: any) => c.id === targetId)
        if (idx >= 0) targetIdx = idx
      } else if (actives.length > 0) {
        targetId = actives[0].id
        window.history.replaceState(null, '', `/patient/waiting-room?consultationId=${targetId}`)
      }

      setActiveTabIdx(targetIdx)
      if (!targetId) { setLoadingStatus(false); return }
      setResolvedId(targetId)

      const c = actives[targetIdx] ?? consultations.find((c: any) => c.id === targetId)
      if (c) {
        setConsultation(c)
        setConsultationStatus(c.status)
        setConsultationCreatedAt(c.created_at)
        if (c.status === 'WAITING_PAYMENT' && !qrGeneratedRef.current) {
          qrGeneratedRef.current = true
          generateQR(targetId)
        }
      }
    } catch {} finally {
      setLoadingStatus(false)
    }
  }

  // Polling cada 4 segundos — pausado cuando la pestaña no está visible
  // (minimizada, en otra pestaña) para no gastar peticiones al servidor
  // en segundo plano sin que nadie esté mirando. Al volver a la pestaña,
  // refresca al toque en vez de esperar hasta 4s.
  useEffect(() => {
    if (!resolvedId || !consultationStatus) return
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(consultationStatus)) return

    const poll = async () => {
      if (document.hidden) return
      try {
        const res = await consultationsAPI.getMyConsultations()
        const all = res.data
        const actives = all.filter((c: any) => ACTIVE_STATUSES.includes(c.status))
        setAllActive(actives)
        const c = all.find((c: any) => c.id === resolvedId)
        if (c) {
          setConsultation(c)
          if (c.status !== consultationStatus) {
            setConsultationStatus(c.status)
            // Médico aceptó → generar QR automáticamente
            if (c.status === 'WAITING_PAYMENT' && !qrGeneratedRef.current) {
              qrGeneratedRef.current = true
              generateQR(resolvedId)
            }
            if (c.status === 'IN_PROGRESS' && c.modality !== 'IN_PERSON') {
              router.push(`/patient/video?cid=${resolvedId}`)
            }
          }
        }
        // Para citas agendadas pagadas, consultar si el profesional está ocupado/atrasado
        if (c && (c.consultation_type === 'SCHEDULED' || c.consultation_type === 'FOLLOW_UP') && c.status === 'PAYMENT_CONFIRMED') {
          try {
            const statusRes = await consultationsAPI.getStatus(resolvedId)
            setBusyMessage(statusRes.message)
          } catch {}
        }
      } catch {}
    }

    const id = setInterval(poll, 4000)

    function onVisibilityChange() {
      if (!document.hidden) poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [resolvedId, consultationStatus])

  async function generateQR(id?: string) {
    const cid = id || resolvedId
    if (!cid) return
    setLoadingQR(true)
    setError('')
    try {
      const res = await consultationsAPI.generateQR(cid)
      setPayment(res.data)
      setQrExpired(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoadingQR(false)
    }
  }

  async function simulatePayment() {
    if (!resolvedId) return
    setSimulatingPayment(true)
    setError('')
    try {
      await consultationsAPI.simulatePayment(resolvedId)
      setConsultationStatus('PAYMENT_CONFIRMED')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSimulatingPayment(false)
    }
  }

  async function proposeReschedule() {
    if (!resolvedId || !newDateTime) return
    setError('')
    try {
      await consultationsAPI.proposeReschedule(resolvedId, newDateTime)
      setActionMessage('Propuesta enviada. Espera la respuesta del profesional.')
      setReschedulingOpen(false)
      await initPage()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function respondReschedule(decision: 'ACCEPT' | 'REJECT') {
    if (!resolvedId) return
    setError('')
    try {
      await consultationsAPI.respondReschedule(resolvedId, decision)
      setActionMessage(decision === 'ACCEPT' ? 'Cita reprogramada correctamente.' : 'Propuesta rechazada. Tu cita sigue en su horario original.')
      await initPage()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function cancelWithRefund() {
    if (!resolvedId) return
    setError('')
    try {
      await consultationsAPI.cancelScheduledWithRefund(resolvedId)
      setConsultationStatus('CANCELLED')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function cancelRequest() {
    if (!resolvedId) return
    setCancellingRequest(true)
    setError('')
    try {
      await consultationsAPI.cancel(resolvedId)
      setConsultationStatus('CANCELLED')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCancellingRequest(false)
      setShowCancelConfirm(false)
    }
  }

  async function reportProfessionalNoShow() {
    if (!resolvedId) return
    setError('')
    try {
      await consultationsAPI.reportProfessionalNoShow(resolvedId)
      setActionMessage('Reportado. Tu dinero fue devuelto.')
      await initPage()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  // GAP 1 y 2: el paciente decide cancelar porque el médico no inició la
  // videollamada. Usa el endpoint correcto según el tipo de consulta.
  async function cancelNoVideo() {
    if (!resolvedId) return
    setCancellingNoVideo(true)
    setError('')
    try {
      if (consultation?.consultation_type === 'SCHEDULED' || consultation?.consultation_type === 'FOLLOW_UP') {
        await consultationsAPI.cancelNoVideoScheduled(resolvedId)
      } else {
        await consultationsAPI.cancelNoVideoImmediate(resolvedId)
      }
      setActionMessage('Cancelado. Tu dinero fue devuelto.')
      setConsultationStatus('CANCELLED')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCancellingNoVideo(false)
    }
  }

  const kind = kindOf(consultation)
  const isScheduled = kind !== 'IMMEDIATE'
  const isProfessionalScheduled = kind === 'PROFESSIONAL_SCHEDULED'
  const activeSteps = getSteps(kind)
  const currentStepIndex = activeSteps.findIndex((s) => s.key === consultationStatus)

  // Segundos restantes para que el médico acepte (5 min desde created_at)
  const professionalTimeoutSecs = consultationCreatedAt
    ? Math.max(0, 300 - Math.floor((Date.now() - new Date(consultationCreatedAt + 'Z').getTime()) / 1000))
    : 300

  if (loadingStatus) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
        <div className="max-w-xl flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    )
  }

  if (!resolvedId || !consultationStatus) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
        <div className="max-w-xl text-center py-16">
          <p className="text-sm font-semibold mb-2">{t('No tienes ninguna consulta en curso')}</p>
          <p className="text-xs text-[#6B738A] mb-5">{t('Inicia una consulta con el agente o busca un profesional.')}</p>
          <div className="flex gap-3 justify-center">
            <a href="/patient/agent" className="btn-primary text-xs">{t('Hablar con Medi')}</a>
            <a href="/patient/search" className="btn-secondary text-xs">{t('Buscar médico')}</a>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
      <div className="max-w-xl">

        <div className="mb-5">
          <h1 className="text-base font-semibold">{t('Sala de espera virtual')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">{t('Tu consulta está siendo coordinada')}</p>
        </div>

        {/* Pestañas — solo si hay más de una consulta activa */}
        {allActive.length > 1 && (
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {allActive.map((c: any, i: number) => {
              const tabKind = kindOf(c)
              return (
              <button
                key={c.id}
                onClick={() => switchTab(i, allActive)}
                className={`flex-shrink-0 text-xs px-3 py-2 rounded-xl font-medium border transition-colors ${
                  activeTabIdx === i
                    ? tabKind === 'PROFESSIONAL_SCHEDULED'
                      ? 'bg-[#534AB7] text-white border-[#534AB7]'
                      : tabKind === 'PATIENT_SCHEDULED'
                      ? 'bg-[#185FA5] text-white border-[#185FA5]'
                      : 'bg-[#B95F00] text-white border-[#B95F00]'
                    : 'bg-white text-[#3C4257] border-[#DDE1EE] hover:border-[#185FA5]'
                }`}
              >
                {tabKind === 'PROFESSIONAL_SCHEDULED'
                  ? `👨‍⚕️ ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('es-BO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Agendada por el profesional'}`
                  : tabKind === 'PATIENT_SCHEDULED'
                  ? `🗓 ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('es-BO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Cita agendada'}`
                  : '⚡ Inmediata'}
              </button>
              )
            })}
          </div>
        )}

        {/* Timeline */}
        <div className="card mb-4">
          <h2 className="text-sm font-semibold mb-3">{t('Estado de tu consulta')}</h2>
          {/* Badge que diferencia el tipo de flujo */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              isProfessionalScheduled
                ? 'bg-[#EEEDFE] text-[#534AB7] border border-[#D7D4F7]'
                : isScheduled
                ? 'bg-[#EEF3FB] text-[#185FA5] border border-[#C3D6EF]'
                : 'bg-[#FFF0E6] text-[#B95F00] border border-[#FAD5AF]'
            }`}>
              {isProfessionalScheduled ? '👨‍⚕️ Agendada por el profesional' : isScheduled ? '🗓 Cita agendada' : '⚡ Consulta inmediata'}
            </span>
            {isProfessionalScheduled && consultation?.modality && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${
                consultation.modality === 'IN_PERSON'
                  ? 'bg-[#FAECE7] text-[#993C1D] border-[#F0C7B4]'
                  : 'bg-[#E1F5EE] text-[#0F6E56] border-[#9FE1CB]'
              }`}>
                {consultation.modality === 'IN_PERSON' ? '🏥 Presencial' : '🎥 Videollamada'}
              </span>
            )}
          </div>
          <div className="space-y-0">
            {activeSteps.map((step, i) => {
              const isDone   = i < currentStepIndex
              const isActive = i === currentStepIndex
              return (
                <div key={step.key} className="flex gap-3 pb-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isDone ? 'bg-[#E1F5EE] text-[#0F6E56]' :
                      isActive ? 'bg-[#185FA5] text-white' :
                      'bg-[#F5F6FA] text-[#A0A8BF]'
                    }`}>
                      {isDone ? '✓' : i + 1}
                    </div>
                    {i < activeSteps.length - 1 && (
                      <div className={`w-0.5 flex-1 mt-1 min-h-[16px] ${isDone ? 'bg-[#1D9E75]' : 'bg-[#DDE1EE]'}`} />
                    )}
                  </div>
                  <div className="pt-1.5">
                    <p className={`text-sm ${isActive ? 'font-semibold text-[#185FA5]' : isDone ? 'text-[#141820]' : 'text-[#A0A8BF]'}`}>
                      {step.label}
                    </p>
                    {isActive && step.sub() && (
                      <p className="text-xs text-[#6B738A] mt-0.5">{step.sub()}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Esperando que el médico acepte */}
        {consultationStatus === 'WAITING_PROFESSIONAL' && (
          <div className="card text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#E6F1FB] border-2 border-[#185FA5] flex items-center justify-center text-xl mx-auto mb-3 animate-pulse">
              👨‍⚕️
            </div>
            {isScheduled ? (
              <>
                <p className="text-sm font-semibold mb-1">{t('Esperando confirmación de tu cita')}</p>
                {consultation?.scheduled_at && (
                  <p className="text-xs text-[#185FA5] font-medium mb-1">
                    🗓 {new Date(consultation.scheduled_at).toLocaleString('es-BO', {
                      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                )}
                <p className="text-xs text-[#6B738A] mb-2">{t('El profesional debe confirmar tu solicitud antes de que llegue la hora de tu cita')}</p>
                {consultationCreatedAt && (
                  <ScheduledAcceptDeadlineTimer createdAt={consultationCreatedAt} scheduledAt={consultation?.scheduled_at} />
                )}
                <div className="mt-4 pt-3 border-t border-[#DDE1EE]">
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="text-xs text-[#A0A8BF] hover:text-[#E24B4A] transition-colors underline"
                  >
                    {t('Cancelar solicitud')}
                  </button>
                </div>

                {/* Modal de confirmación de cancelación */}
                {showCancelConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full text-left">
                      <h3 className="text-base font-semibold text-[#1C2340] mb-2">{t('¿Cancelar la solicitud?')}</h3>
                      <p className="text-sm text-[#6B738A] mb-4">
                        {t('El médico aún no ha confirmado tu cita. Si cancelas ahora, no se realizará ningún cobro.')}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowCancelConfirm(false)}
                          className="flex-1 text-sm text-[#6B738A] border border-[#DDE1EE] rounded-xl py-2.5 hover:bg-[#F5F6FA] transition-colors"
                        >
                          {t('Mantener cita')}
                        </button>
                        <button
                          onClick={cancelRequest}
                          disabled={cancellingRequest}
                          className="flex-1 text-sm font-semibold text-white bg-[#E24B4A] rounded-xl py-2.5 hover:bg-[#C03A39] transition-colors disabled:opacity-60"
                        >
                          {cancellingRequest ? 'Cancelando…' : 'Sí, cancelar'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold mb-1">{t('Esperando respuesta del médico')}</p>
                <p className="text-xs text-[#6B738A] mb-3">{t('El médico tiene 5 minutos para aceptar tu solicitud')}</p>
                <CountdownTimer
                  seconds={professionalTimeoutSecs}
                  label="Tiempo restante"
                  onExpired={() => setConsultationStatus('CANCELLED')}
                />
                <p className="text-xs text-[#A0A8BF] mt-3">{t('Si no responde, la consulta se cancelará automáticamente sin costo')}</p>
              </>
            )}

            {/* DEV: simular aceptación del médico */}
            {isDev && (
              <div className="mt-4 pt-4 border-t border-dashed border-[#DDE1EE]">
                <p className="text-xs text-[#A0A8BF] mb-2">{t('🛠️ Modo desarrollo')}</p>
                <button
                  onClick={async () => {
                    await consultationsAPI.acceptConsultation(resolvedId!)
                    setConsultationStatus('WAITING_PAYMENT')
                    qrGeneratedRef.current = true
                    generateQR(resolvedId!)
                  }}
                  className="w-full py-2 px-4 bg-[#185FA5] hover:bg-[#0d4a85] text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {t('🩺 Simular que el médico acepta')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* QR de pago */}
        {consultationStatus === 'WAITING_PAYMENT' && (
          <div className="card text-center">
            <h2 className="text-sm font-semibold mb-1">{t('Pago QR')}</h2>
            {isScheduled ? (
              <p className="text-xs text-[#185FA5] mb-3">{t('🗓 Confirmá tu cita pagando ahora — el profesional la aceptará después')}</p>
            ) : (
              <p className="text-xs text-[#1D9E75] mb-3">{t('✅ El médico aceptó tu consulta')}</p>
            )}

            {error && (
              <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-3 border border-[#F09595]">
                {error}
              </div>
            )}

            {loadingQR ? (
              <div className="py-8 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-[#6B738A]">{t('Generando QR...')}</p>
              </div>
            ) : payment ? (
              <>
                <div className="bg-[#F5F6FA] rounded-xl p-4 inline-block mb-3">
                  <img src={payment.qr_image_url} alt="QR de pago" width={160} height={160} className="mx-auto" />
                </div>
                <p className="text-2xl font-bold text-[#141820] mb-1">
                  Bs. {parseFloat(payment.amount).toFixed(2)}
                </p>
                <p className="text-xs text-[#6B738A] mb-3">Consulta con {payment.professional_name}</p>
                <QRTimer expiresAt={payment.expires_at} onExpired={() => setQrExpired(true)} />
                {qrExpired && (
                  <p className="text-xs text-[#A32D2D] mt-2">{t('El tiempo de pago expiró. La consulta fue cancelada automáticamente.')}</p>
                )}
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {['BNB', 'Banco Unión', 'Banco Sol', 'Tigo Money', 'Banco Fie'].map((b) => (
                    <span key={b} className="text-xs border border-[#DDE1EE] px-2 py-0.5 rounded-full text-[#6B738A]">{b}</span>
                  ))}
                </div>
                {/* Botón cancelar — solo visible si el QR no expiró todavía */}
                {!qrExpired && (
                  <div className="mt-4 pt-3 border-t border-[#F0F1F7]">
                    <button
                      onClick={async () => {
                        if (!resolvedId) return
                        const confirmed = window.confirm(
                          isScheduled
                            ? '¿Cancelar esta cita agendada? No se realizará ningún cobro.'
                            : '¿Cancelar? Aún no realizaste el pago, la consulta será cancelada sin costo.'
                        )
                        if (!confirmed) return
                        try {
                          await consultationsAPI.cancel(resolvedId)
                          setConsultationStatus('CANCELLED')
                        } catch {
                          setError('No se pudo cancelar. Intenta de nuevo.')
                        }
                      }}
                      className="text-xs text-[#A32D2D] underline underline-offset-2 hover:text-[#E24B4A] transition-colors"
                    >
                      Cancelar {isScheduled ? 'cita' : 'pago'}
                    </button>
                  </div>
                )}
              </>
            ) : null}

            {isDev && (
              <div className="mt-4 pt-4 border-t border-dashed border-[#DDE1EE]">
                <p className="text-xs text-[#A0A8BF] mb-2">{t('🛠️ Modo desarrollo')}</p>
                <div className="flex flex-col gap-2">
                  {!payment && !loadingQR && (
                    <button
                      onClick={() => { qrGeneratedRef.current = false; generateQR() }}
                      className="w-full py-2 px-4 bg-[#185FA5] hover:bg-[#0d4a85] text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {t('🔄 Reintentar generar QR')}
                    </button>
                  )}
                  <button
                    onClick={simulatePayment}
                    disabled={simulatingPayment}
                    className="w-full py-2 px-4 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    {simulatingPayment ? 'Procesando...' : '⚡ Saltar pago (simular confirmado)'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pago confirmado */}
        {consultationStatus === 'PAYMENT_CONFIRMED' && (
          isScheduled ? (
            <ScheduledConfirmedCard
              consultation={consultation}
              error={error}
              actionMessage={actionMessage}
              busyMessage={busyMessage}
              reschedulingOpen={reschedulingOpen}
              setReschedulingOpen={setReschedulingOpen}
              newDateTime={newDateTime}
              setNewDateTime={setNewDateTime}
              onProposeReschedule={proposeReschedule}
              onRespondReschedule={respondReschedule}
              onCancelWithRefund={cancelWithRefund}
              onReportNoShow={reportProfessionalNoShow}
              onCancelNoVideo={cancelNoVideo}
              cancellingNoVideo={cancellingNoVideo}
            />
          ) : (
            <WaitingForDoctor
              paymentPaidAt={consultation?.payment_paid_at}
              onCancelNoVideo={cancelNoVideo}
              cancelling={cancellingNoVideo}
              error={error}
              actionMessage={actionMessage}
            />
          )
        )}

        {/* Cancelada sin cobro */}
        {consultationStatus === 'CANCELLED' && (
          <div className="card text-center py-8 px-4">
            <div className="w-14 h-14 rounded-full bg-[#F5F6FA] flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#3C4257] mb-1">{t('Consulta cancelada')}</p>
            <p className="text-xs text-[#6B738A] mb-5">{t('No se realizó ningún cobro.')}</p>
            <a href="/patient/search" className="btn-primary text-sm px-6">{t('Buscar otro médico')}</a>
          </div>
        )}

        {/* Cancelada por el profesional — con reembolso */}
        {consultationStatus === 'REFUNDED' && (
          <div className="card text-center py-8 px-4">
            <div className="w-16 h-16 rounded-full bg-[#EBF7F2] border-2 border-[#1D9E75] flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p className="text-base font-semibold text-[#1C2340] mb-1">{t('Cita cancelada por el médico')}</p>
            <p className="text-sm text-[#6B738A] mb-4">
              {t('El profesional canceló la cita. Tu pago será reembolsado en los próximos minutos.')}
            </p>

            <div className="bg-[#F0FBF6] border border-[#A8DFC8] rounded-xl px-4 py-3 mb-6 text-left">
              <p className="text-xs font-semibold text-[#0F6E56] mb-1">{t('💰 Sobre tu reembolso')}</p>
              <p className="text-xs text-[#1D9E75]">
                {t('El monto pagado será devuelto automáticamente. Si tienes algún problema, contacta al soporte de MedicBolivia.')}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <a href="/patient/search" className="btn-primary text-sm py-2.5">
                {t('Buscar otro médico')}
              </a>
              <a href="/patient/history" className="btn-secondary text-sm py-2.5">
                {t('Ver mis consultas')}
              </a>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}