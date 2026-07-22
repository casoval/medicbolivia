'use client'
// src/components/layout/NotificationToast.tsx

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { consultationsAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

interface Toast {
  id: string
  type: 'incoming' | 'accepted' | 'video_ready' | 'rejected' | 'completed' | 'payment'
  title: string
  body: string
  consultationId?: string
  createdAt?: string
  action?: { label: string; href: string }
}

// ── Helpers para persistir en sessionStorage ─────────
function getSeenIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem('mb_seen_toasts')
    return new Set(raw ? JSON.parse(raw) : [])
  } catch { return new Set() }
}

function saveSeenId(id: string) {
  if (typeof window === 'undefined') return
  try {
    const seen = getSeenIds()
    seen.add(id)
    sessionStorage.setItem('mb_seen_toasts', JSON.stringify([...seen]))
  } catch {}
}

function getPrevStatuses(): Map<string, string> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = sessionStorage.getItem('mb_prev_statuses')
    return new Map(raw ? JSON.parse(raw) : [])
  } catch { return new Map() }
}

function savePrevStatus(id: string, status: string) {
  if (typeof window === 'undefined') return
  try {
    const map = getPrevStatuses()
    map.set(id, status)
    sessionStorage.setItem('mb_prev_statuses', JSON.stringify([...map]))
  } catch {}
}

// ── Cuenta regresiva ─────────────────────────────────
function Countdown({ createdAt, onExpire }: { createdAt: string; onExpire: () => void }) {
  const [secs, setSecs] = useState(300)
  const expiredRef = useRef(false)

  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(createdAt + 'Z').getTime()) / 1000)
      const left = Math.max(0, 300 - elapsed)
      setSecs(left)
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpire()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [createdAt, onExpire])

  const m = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs <= 30
  const pct = (secs / 300) * 100

  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-white/60">Tiempo para responder</span>
        <span className={`text-xs font-mono font-bold ${urgent ? 'text-[#FF6B6B]' : 'text-[#4ECDC4]'}`}>
          {m}:{s.toString().padStart(2, '0')}
        </span>
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${urgent ? 'bg-[#FF6B6B]' : 'bg-[#4ECDC4]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ToastIcon({ type }: { type: Toast['type'] }) {
  const icons: Record<Toast['type'], string> = {
    incoming:    '🔔',
    accepted:    '✅',
    video_ready: '📹',
    rejected:    '❌',
    completed:   '🏁',
    payment:     '💳',
  }
  return <span className="text-xl flex-shrink-0">{icons[type]}</span>
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {

  const bgColors: Record<Toast['type'], string> = {
    incoming:    'bg-[#1a2744]',
    accepted:    'bg-[#0f3d2e]',
    video_ready: 'bg-[#0c2d5a]',
    rejected:    'bg-[#3d1515]',
    completed:   'bg-[#1a2744]',
    payment:     'bg-[#1a3a2a]',
  }

  const borderColors: Record<Toast['type'], string> = {
    incoming:    'border-[#4ECDC4]',
    accepted:    'border-[#1D9E75]',
    video_ready: 'border-[#185FA5]',
    rejected:    'border-[#E24B4A]',
    completed:   'border-[#6B738A]',
    payment:     'border-[#1D9E75]',
  }

  return (
    <div
      className={`${bgColors[toast.type]} ${borderColors[toast.type]} border rounded-xl shadow-2xl p-4 w-80 pointer-events-auto`}
      style={{ animation: 'slideIn 0.3s ease-out' }}
    >
      <div className="flex items-start gap-3">
        <ToastIcon type={toast.type} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">{toast.title}</p>
          <p className="text-xs text-white/60 mt-0.5 leading-relaxed">{toast.body}</p>

          {toast.type === 'incoming' && toast.createdAt && (
            <Countdown createdAt={toast.createdAt} onExpire={() => onDismiss(toast.id)} />
          )}

          {toast.action && (
            <button
              onClick={() => { window.location.href = toast.action!.href; onDismiss(toast.id) }}
              className="mt-3 w-full py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="text-white/30 hover:text-white/70 transition-colors flex-shrink-0 -mt-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────
export function NotificationToast() {
  const { user } = useAuthStore()
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const addToast = useCallback((toast: Toast) => {
    // Verificar en sessionStorage para sobrevivir navegación entre páginas
    if (getSeenIds().has(toast.id)) return
    saveSeenId(toast.id)
    setToasts(t => [...t, toast])

    if (toast.type !== 'incoming') {
      const delay = toast.type === 'video_ready' ? 12000 : 6000
      setTimeout(() => dismiss(toast.id), delay)
    }

    if (typeof window !== 'undefined' && Notification.permission === 'granted') {
      new Notification(toast.title, { body: toast.body, icon: '/favicon.ico', tag: toast.id })
    }
  }, [dismiss])

  useQuery({
    queryKey: ['notifications-poll'],
    queryFn: async () => {
      if (!user) return null
      const res = await consultationsAPI.getMyConsultations()
      const consultations: any[] = Array.isArray(res.data) ? res.data : []

      consultations.forEach((c: any) => {
        const prev = getPrevStatuses().get(c.id)
        const curr = c.status

        // ── Primera vez que vemos esta consulta ──
        if (!prev) {
          savePrevStatus(c.id, curr)

          // Médico: solicitud activa al cargar página
          if (curr === 'WAITING_PROFESSIONAL' && user.role === 'PROFESSIONAL') {
            if (c.consultation_type === 'SCHEDULED') {
              // Cita agendada: aviso informativo, sin countdown de 5 min
              // (el plazo real puede ser de horas o días — se ve en el dashboard)
              addToast({
                id: `incoming-${c.id}`,
                type: 'incoming',
                title: '📅 Nueva cita agendada por confirmar',
                body: `${c.specialty || 'Consulta general'} — Bs. ${parseFloat(c.amount).toFixed(2)}`,
                consultationId: c.id,
                action: { label: 'Ver en el dashboard', href: '/professional/dashboard' },
              })
            } else {
              // Solo mostrar si la consulta tiene menos de 5 minutos
              const elapsed = Math.floor((Date.now() - new Date(c.created_at + 'Z').getTime()) / 1000)
              if (elapsed < 300) {
                addToast({
                  id: `incoming-${c.id}`,
                  type: 'incoming',
                  title: '🔔 Nueva solicitud de consulta',
                  body: `${c.specialty || 'Consulta general'} — Bs. ${parseFloat(c.amount).toFixed(2)}`,
                  consultationId: c.id,
                  createdAt: c.created_at,
                  action: { label: 'Ver en el dashboard', href: '/professional/dashboard' },
                })
              }
            }
          }

          // Paciente: QR pendiente al cargar página
          if (curr === 'WAITING_PAYMENT' && user.role === 'PATIENT') {
            addToast({
              id: `qr-${c.id}`,
              type: 'payment',
              title: '💳 Tienes un pago pendiente',
              body: 'El médico aceptó tu consulta. Escanea el QR para continuar.',
              action: { label: 'Ir a pagar', href: `/patient/waiting-room?consultationId=${c.id}` },
            })
          }
          if (curr === 'PAYMENT_CONFIRMED' && user.role === 'PATIENT') {
            addToast({
              id: `payment-${c.id}`,
              type: 'payment',
              title: '💳 Pago confirmado',
              body: 'Tu pago fue recibido. El médico iniciará la consulta pronto.',
              action: { label: 'Ver estado', href: '/patient/dashboard' },
            })
          }
          return
        }

        // ── Cambio de estado ──
        if (prev === curr) return
        savePrevStatus(c.id, curr)
        const toastId = `${c.id}-${prev}-${curr}`

        // ── MÉDICO ──
        if (user.role === 'PROFESSIONAL') {
          // Nueva solicitud que aparece mientras está en otra pestaña
          if (curr === 'WAITING_PROFESSIONAL') {
            if (c.consultation_type === 'SCHEDULED') {
              addToast({
                id: `incoming-${c.id}`,
                type: 'incoming',
                title: '📅 Nueva cita agendada por confirmar',
                body: `${c.specialty || 'Consulta general'} — Bs. ${parseFloat(c.amount).toFixed(2)}`,
                consultationId: c.id,
                action: { label: 'Ver en el dashboard', href: '/professional/dashboard' },
              })
            } else {
              const elapsed = Math.floor((Date.now() - new Date(c.created_at + 'Z').getTime()) / 1000)
              if (elapsed < 300) {
                addToast({
                  id: `incoming-${c.id}`,
                  type: 'incoming',
                  title: '🔔 Nueva solicitud de consulta',
                  body: `${c.specialty || 'Consulta general'} — Bs. ${parseFloat(c.amount).toFixed(2)}`,
                  consultationId: c.id,
                  createdAt: c.created_at,
                  action: { label: 'Ver en el dashboard', href: '/professional/dashboard' },
                })
              }
            }
          }
          if (curr === 'WAITING_PAYMENT') {
            const isScheduled = c.consultation_type === 'SCHEDULED'
            const scheduledLabel = c.scheduled_at
              ? new Date(c.scheduled_at).toLocaleString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              : 'la hora agendada'
            addToast({
              id: `awaiting-payment-${c.id}`,
              type: 'payment',
              title: '⏳ Esperando pago del paciente',
              body: isScheduled
                ? `El paciente tiene 5 min para pagar. La videollamada iniciará el ${scheduledLabel}.`
                : 'Aceptaste la consulta. El paciente tiene 5 min para completar el pago QR.',
              action: { label: 'Ver en dashboard', href: '/professional/dashboard' },
            })
          }
          if (curr === 'PAYMENT_CONFIRMED') {
            dismiss(`incoming-${c.id}`)
            dismiss(`awaiting-payment-${c.id}`)
            addToast({
              id: toastId,
              type: 'payment',
              title: '💳 Pago confirmado',
              body: 'El paciente realizó el pago — puedes iniciar la videollamada',
              action: { label: 'Ir al dashboard', href: '/professional/dashboard' },
            })
          }
          if (curr === 'COMPLETED') {
            addToast({
              id: toastId,
              type: 'completed',
              title: '🏁 Consulta completada',
              body: 'La consulta ha finalizado correctamente',
            })
          }
          if (curr === 'CANCELLED' && prev === 'WAITING_PROFESSIONAL') {
            dismiss(`incoming-${c.id}`)
            const isScheduled = c.consultation_type === 'SCHEDULED'
            addToast({
              id: toastId,
              type: 'rejected',
              title: isScheduled ? '❌ Cita agendada cancelada' : '❌ Solicitud cancelada',
              body: isScheduled
                ? 'El paciente canceló la solicitud de cita antes de que la confirmaras.'
                : 'El paciente canceló la solicitud antes de que pudieras responder.',
            })
          }
        }

        // ── PACIENTE ──
        if (user.role === 'PATIENT') {
          if (curr === 'ACCEPTED') {
            addToast({
              id: toastId,
              type: 'accepted',
              title: '✅ Médico aceptó tu consulta',
              body: 'Procede al pago para continuar',
              action: { label: 'Ver consulta', href: '/patient/dashboard' },
            })
          }
          if (curr === 'WAITING_PAYMENT') {
            addToast({
              id: toastId,
              type: 'payment',
              title: '💳 ¡Es tu turno de pagar!',
              body: 'El médico aceptó tu consulta. Escanea el QR para confirmar el pago.',
              action: { label: 'Ir a pagar', href: `/patient/waiting-room?consultationId=${c.id}` },
            })
          }
          if (curr === 'PAYMENT_CONFIRMED') {
            addToast({
              id: toastId,
              type: 'payment',
              title: '💳 Pago recibido',
              body: 'Tu pago fue confirmado. El médico iniciará la consulta en breve.',
              action: { label: 'Ver estado', href: '/patient/dashboard' },
            })
          }
          if (curr === 'CANCELLED') {
            addToast({
              id: toastId,
              type: 'rejected',
              title: '❌ Consulta no aceptada',
              body: 'El médico no pudo atenderte. Intenta con otro profesional.',
              action: { label: 'Buscar médico', href: '/patient/search' },
            })
          }
          // Videollamada iniciada → solo notificar, el flujo ya redirige automáticamente
          if (curr === 'IN_PROGRESS') {
            addToast({
              id: toastId,
              type: 'video_ready',
              title: '📹 ¡Videollamada iniciada!',
              body: 'El médico comenzó la consulta',
            })
          }
          if (curr === 'COMPLETED') {
            addToast({
              id: toastId,
              type: 'completed',
              title: '🏁 Consulta finalizada',
              body: '¿Cómo estuvo tu atención? Puedes calificar desde Mis consultas.',
              action: { label: 'Calificar ahora', href: '/patient/history' },
            })
          }
        }
      })

      return consultations
    },
    enabled: !!user,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (typeof window !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </>
  )
}