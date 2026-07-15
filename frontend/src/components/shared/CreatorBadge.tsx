// src/components/shared/CreatorBadge.tsx
//
// Distingue, en el panel del paciente y en el del profesional, si una cita
// la agendó el propio paciente (flujo normal) o el profesional
// directamente (agendamiento por membresía, cobro directo — ver
// ProfessionalScheduleRequest). Se usa en el calendario, en las listas de
// "Próximas citas" del profesional y en el historial del paciente.

export function CreatorBadge({
  createdByRole,
  viewerRole,
  className = '',
}: {
  createdByRole?: 'PATIENT' | 'PROFESSIONAL' | null
  viewerRole: 'PATIENT' | 'PROFESSIONAL'
  className?: string
}) {
  if (!createdByRole) return null

  const isOwn = createdByRole === viewerRole
  const label = isOwn
    ? 'Agendada por ti'
    : viewerRole === 'PATIENT'
      ? 'Agendada por el profesional'
      : 'Agendada por el paciente'

  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
        isOwn ? 'bg-[#EFF6FF] text-[#185FA5]' : 'bg-[#F5F6FA] text-[#6B738A]'
      } ${className}`}
      title={
        createdByRole === 'PROFESSIONAL'
          ? 'El cobro de esta cita fue directo entre el profesional y el paciente, no vía plataforma.'
          : undefined
      }
    >
      {label}
    </span>
  )
}
