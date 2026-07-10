// src/components/shared/PatientAvatar.tsx
// Avatar del paciente: muestra su foto de perfil si la cargó, o un círculo
// con sus iniciales (mismo criterio que ya se usaba para profesionales).
// Se usa en todos los lugares donde antes solo aparecía un círculo de
// iniciales: consultas, citas, recetario, notas clínicas, historial y
// panel de administración.

interface PatientAvatarProps {
  firstName?: string | null
  lastName?: string | null
  photoUrl?: string | null
  /** Clases de tamaño, ej: "w-9 h-9" */
  size?: string
  /** Clases de fondo/texto para el círculo de iniciales (no aplica si hay foto) */
  colorClasses?: string
  /** Clases de tamaño de fuente para las iniciales */
  textSize?: string
  className?: string
}

export function PatientAvatar({
  firstName,
  lastName,
  photoUrl,
  size = 'w-9 h-9',
  colorClasses = 'bg-[#E6F1FB] text-[#185FA5]',
  textSize = 'text-xs',
  className = '',
}: PatientAvatarProps) {
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || 'P'

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={firstName ? `Foto de ${firstName}` : 'Foto del paciente'}
        className={`${size} rounded-full object-cover flex-shrink-0 ${className}`}
      />
    )
  }

  return (
    <div className={`${size} rounded-full ${colorClasses} flex items-center justify-center ${textSize} font-bold flex-shrink-0 ${className}`}>
      {initials}
    </div>
  )
}
