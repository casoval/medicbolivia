// src/components/shared/ConsultationBadges.tsx
//
// Badges compartidos para mostrar, en cualquier lugar donde aparezca una
// consulta/cita, dos cosas que antes solo se veían en el detalle del
// calendario:
//   1) Qué tipo de flujo es — hay 3, no 2: consulta inmediata, cita
//      agendada por el paciente (flujo normal), o cita agendada por el
//      propio profesional (membresía, cobro directo). Antes solo se
//      distinguía "inmediata" vs "agendada", sin decir quién la agendó.
//   2) La modalidad (videollamada / presencial) — solo tiene sentido para
//      citas que agendó el profesional, ya que el flujo normal siempre es
//      por videollamada a través de la plataforma.

import type { Consultation } from '@/types'

type MinimalConsultation = Pick<Consultation, 'consultation_type' | 'created_by_role' | 'modality'>

export function consultationKind(c: MinimalConsultation): 'IMMEDIATE' | 'PATIENT_SCHEDULED' | 'PROFESSIONAL_SCHEDULED' {
  if (c.consultation_type === 'IMMEDIATE') return 'IMMEDIATE'
  return c.created_by_role === 'PROFESSIONAL' ? 'PROFESSIONAL_SCHEDULED' : 'PATIENT_SCHEDULED'
}

export function ConsultationTypeBadge({ consultation, className = '' }: { consultation: MinimalConsultation; className?: string }) {
  const kind = consultationKind(consultation)
  const cfg = {
    IMMEDIATE:               { label: '⚡ Inmediata',                    cls: 'bg-[#FFF0E6] text-[#B95F00] border-[#FAD5AF]' },
    PATIENT_SCHEDULED:       { label: '🗓 Cita agendada',                cls: 'bg-[#EEF3FB] text-[#185FA5] border-[#C3D6EF]' },
    PROFESSIONAL_SCHEDULED:  { label: '👨‍⚕️ Agendada por el profesional', cls: 'bg-[#EEEDFE] text-[#534AB7] border-[#D7D4F7]' },
  }[kind]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${cfg.cls} ${className}`}>
      {cfg.label}
    </span>
  )
}

export function ModalityBadge({ consultation, className = '' }: { consultation: MinimalConsultation; className?: string }) {
  // Solo es una elección real en citas que agendó el profesional — en el
  // resto de flujos siempre es videollamada, mostrar el badge ahí sería
  // ruido repetido en cada tarjeta.
  if (consultation.created_by_role !== 'PROFESSIONAL' || !consultation.modality) return null
  const isInPerson = consultation.modality === 'IN_PERSON'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${
      isInPerson ? 'bg-[#FAECE7] text-[#993C1D] border-[#F0C7B4]' : 'bg-[#E1F5EE] text-[#0F6E56] border-[#9FE1CB]'
    } ${className}`}>
      {isInPerson ? '🏥 Presencial' : '🎥 Videollamada'}
    </span>
  )
}

// ── Badge de pago ──────────────────────────────────────
// El estado de la cita (Consultation.status) y el estado real del cobro
// (Payment.status) son cosas distintas — PAYMENT_CONFIRMED en la cita solo
// dice "puede proceder", no que alguien ya haya pagado o cobrado. Ni el
// paciente ni el profesional pueden deducir eso mirando solo el estado de
// la cita, así que este badge lo dice explícito, en las palabras que le
// tocan a cada rol ("falta pagar" al paciente, "falta cobrar" al
// profesional), y distingue cobro por plataforma (QR) de cobro directo
// (CASH, solo en citas que agenda el profesional).
type PaymentInfoConsultation = Pick<
  Consultation,
  'status' | 'payment_status' | 'payment_channel' | 'payment_paid_at' | 'created_by_role'
>

export function PaymentBadge({
  consultation,
  viewerRole,
  className = '',
}: {
  consultation: PaymentInfoConsultation
  viewerRole: 'PATIENT' | 'PROFESSIONAL'
  className?: string
}) {
  const { status, payment_status, payment_channel, payment_paid_at, created_by_role } = consultation
  const isCash = created_by_role === 'PROFESSIONAL' || payment_channel === 'CASH'

  // Antes de que exista un Payment (agente triando la consulta, buscando
  // profesional) no hay nada real que reportar todavía.
  if (status === 'AGENT_TRIAGING' || status === 'WAITING_PROFESSIONAL') return null

  // Cancelada sin que se haya cobrado nada — no hay ambigüedad, no hace
  // falta un badge de pago encima del de "Cancelada".
  if (status === 'CANCELLED' && !payment_paid_at && payment_status !== 'CONFIRMED' && payment_status !== 'RELEASED_TO_PROFESSIONAL') {
    return null
  }

  if (status === 'REFUNDED' || payment_status === 'REFUNDED_FULL' || payment_status === 'REFUNDED_PARTIAL') {
    return <span className={`badge-gray whitespace-nowrap ${className}`}>↩ Reembolsado</span>
  }
  if (payment_status === 'DISPUTED') {
    return <span className={`badge-red whitespace-nowrap ${className}`}>⚠ Pago en disputa</span>
  }

  const isPaid = isCash
    ? !!payment_paid_at
    : (payment_status === 'CONFIRMED' || payment_status === 'RELEASED_TO_PROFESSIONAL')

  if (isPaid) {
    const label = viewerRole === 'PROFESSIONAL' ? '✅ Cobrado' : '✅ Ya pagaste'
    return <span className={`badge-green whitespace-nowrap ${className}`}>{label}</span>
  }

  const label = isCash
    ? (viewerRole === 'PROFESSIONAL' ? '⏳ Falta cobrar' : '⏳ Falta pagar (directo)')
    : (viewerRole === 'PROFESSIONAL' ? '⏳ Esperando pago' : '⏳ Falta pagar')
  return <span className={`badge-amber whitespace-nowrap ${className}`}>{label}</span>
}
