// src/lib/consultationHistory.ts
// Helpers compartidos para mostrar info completa (quién, cuándo, por qué) en
// las tarjetas de historial de paciente y profesional.

import type { Consultation } from '@/types'

// Texto legible de outcome_note, según quién está viendo (paciente o profesional).
export function outcomeLabel(c: Consultation, viewerRole: 'PATIENT' | 'PROFESSIONAL'): string {
  const note = c.outcome_note
  switch (note) {
    case 'CANCELLED_BY_PATIENT':
      return viewerRole === 'PATIENT'
        ? 'Cancelaste la solicitud antes de que el profesional respondiera.'
        : 'El paciente canceló la solicitud antes de que respondieras.'
    case 'CANCELLED_BY_PATIENT_BEFORE_PAYMENT':
      return viewerRole === 'PATIENT'
        ? 'Cancelaste antes de pagar — no se generó ningún cobro.'
        : 'El paciente canceló antes de pagar — no hubo cobro.'
    case 'CANCELLED_BY_PATIENT_WITH_REFUND':
      return viewerRole === 'PATIENT'
        ? 'Cancelaste antes de que confirmara el profesional — el dinero te fue devuelto.'
        : 'El paciente canceló antes de que confirmaras — se le devolvió el dinero.'
    case 'CANCELLED_24H_NOTICE':
      return viewerRole === 'PATIENT'
        ? 'Cancelaste con aviso anticipado — el dinero te fue devuelto.'
        : 'El paciente canceló con aviso anticipado — se le devolvió el dinero.'
    case 'PATIENT_NO_SHOW':
      return viewerRole === 'PATIENT'
        ? 'No asististe a la cita — el pago se liberó al profesional.'
        : 'El paciente no asistió — el pago fue liberado a tu favor.'
    case 'PROFESSIONAL_NO_SHOW':
      return viewerRole === 'PATIENT'
        ? 'El profesional no asistió — el dinero te fue devuelto.'
        : 'No asististe a la cita — el dinero fue devuelto al paciente.'
    case 'PROFESSIONAL_CANCELLED_WITH_REFUND':
      return viewerRole === 'PATIENT'
        ? 'El profesional canceló por un percance — el dinero te fue devuelto.'
        : 'Cancelaste la cita por un percance — el dinero fue devuelto al paciente.'
    case 'PROFESSIONAL_CANCELLED_NO_CHARGE':
      return viewerRole === 'PATIENT'
        ? 'El profesional canceló antes de que se generara el cobro.'
        : 'Cancelaste la cita antes de que se generara el cobro.'
    case 'AUTO_TIMEOUT_PROFESSIONAL':
      return viewerRole === 'PATIENT'
        ? 'Nadie respondió a tiempo y la solicitud se canceló automáticamente.'
        : 'No respondiste a tiempo y la solicitud se canceló automáticamente.'
    case 'AUTO_TIMEOUT_PAYMENT':
      return viewerRole === 'PATIENT'
        ? 'No completaste el pago a tiempo — la solicitud se canceló automáticamente.'
        : 'El paciente no completó el pago a tiempo — la solicitud se canceló automáticamente.'
    default:
      return c.status === 'REFUNDED'
        ? 'Consulta reembolsada.'
        : 'Consulta cancelada.'
  }
}

// Quién originó la cancelación, para mostrar como etiqueta corta.
export function cancelledByLabel(c: Consultation): string | null {
  const note = c.outcome_note
  if (!note) return null
  if (note.startsWith('CANCELLED_BY_PATIENT') || note === 'CANCELLED_24H_NOTICE' || note === 'PROFESSIONAL_NO_SHOW') {
    return 'Canceló: paciente'
  }
  if (note === 'PROFESSIONAL_CANCELLED_WITH_REFUND' || note === 'PROFESSIONAL_CANCELLED_NO_CHARGE' || note === 'PATIENT_NO_SHOW') {
    return 'Canceló: profesional'
  }
  if (note.startsWith('AUTO_TIMEOUT')) {
    return 'Cancelación automática'
  }
  return null
}

// Formatea fecha + hora completa desde UTC (el backend no manda 'Z').
export function fmtFechaHora(iso?: string | null): string {
  if (!iso) return ''
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/La_Paz'
  })
}

// Formatea fecha + hora para campos que YA vienen en hora Bolivia naive
// (como scheduled_at) — a diferencia de fmtFechaHora, NO le agrega 'Z'.
export function fmtFechaHoraLocal(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Determina si hubo un reembolso REAL (dinero que efectivamente se cobró y se devolvió).
// Excluye casos donde nunca hubo cobro:
//   - Cancelado antes de pagar (AUTO_TIMEOUT_PAYMENT, CANCELLED_BY_PATIENT_BEFORE_PAYMENT)
//   - No asistencia del paciente (el pago se libera al profesional, no se reembolsa)
//   - Timeout del profesional antes de que el paciente pagara (AUTO_TIMEOUT_PROFESSIONAL)
const NO_REAL_CHARGE_NOTES = new Set([
  'AUTO_TIMEOUT_PAYMENT',
  'AUTO_TIMEOUT_PROFESSIONAL',
  'CANCELLED_BY_PATIENT_BEFORE_PAYMENT',
  'PROFESSIONAL_CANCELLED_NO_CHARGE',
  'PATIENT_NO_SHOW',
])

export function wasActuallyRefunded(c: { outcome_note?: string | null; payment_refunded_at?: string | null; payment_status?: string | null }): boolean {
  // El backend ya distingue esto en el estado del pago (CANCELLED_NO_CHARGE),
  // pero se deja este chequeo por outcome_note como red de seguridad para
  // registros antiguos creados antes de esa corrección.
  if (c.payment_status === 'CANCELLED_NO_CHARGE') return false
  if (NO_REAL_CHARGE_NOTES.has(c.outcome_note ?? '')) return false
  return !!(c.payment_refunded_at || c.payment_status === 'REFUNDED_FULL' || c.payment_status === 'REFUNDED_PARTIAL')
}

export function fmtHora(iso?: string | null): string {
  if (!iso) return ''
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleTimeString('es-BO', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/La_Paz'
  })
}