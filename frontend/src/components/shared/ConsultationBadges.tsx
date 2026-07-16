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
