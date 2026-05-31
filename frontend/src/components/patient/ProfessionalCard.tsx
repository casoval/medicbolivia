// src/components/patient/ProfessionalCard.tsx
// Tarjeta de profesional reutilizable en búsqueda y resultados del agente

import Link from 'next/link'
import { Avatar, Stars, StatusBadge } from '@/components/ui'
import type { Professional } from '@/types'

const SPECIALTY_COLORS: Record<string, 'blue' | 'teal' | 'purple' | 'coral' | 'amber'> = {
  'Cardiología':       'coral',
  'Psicología':        'purple',
  'Pediatría':         'blue',
  'Nutrición':         'teal',
  'Medicina General':  'blue',
  'Ginecología':       'coral',
  'Traumatología':     'amber',
  'Dermatología':      'teal',
}

interface ProfessionalCardProps {
  professional: Professional
  onConsult?: (pro: Professional) => void
  loading?: boolean
  compact?: boolean
}

export function ProfessionalCard({ professional: pro, onConsult, loading, compact }: ProfessionalCardProps) {
  const color = SPECIALTY_COLORS[pro.specialty] || 'blue'
  const initials = `${pro.first_name[0]}${pro.last_name[0]}`
  const isOnline = pro.availability === 'ONLINE_NOW'

  if (compact) {
    return (
      <div className="flex items-center gap-3 py-3 border-b border-[#DDE1EE] last:border-0">
        <Avatar initials={initials} color={color} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{pro.first_name} {pro.last_name}</p>
          <p className="text-xs text-[#6B738A]">{pro.specialty}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold">Bs. {parseFloat(pro.price_general).toFixed(0)}</p>
          <StatusBadge status={pro.availability} />
        </div>
      </div>
    )
  }

  return (
    <div className="card hover:border-[#185FA5] transition-colors cursor-pointer group">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <Avatar initials={initials} color={color} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{pro.first_name} {pro.last_name}</p>
              <p className="text-xs text-[#6B738A] mt-0.5">{pro.specialty}</p>
            </div>
            <StatusBadge status={pro.availability} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Stars score={Math.round(parseFloat(pro.average_rating))} size="sm" />
            <span className="text-xs text-[#6B738A]">
              {parseFloat(pro.average_rating).toFixed(1)} ({pro.total_ratings})
            </span>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-center gap-3 mb-3 text-xs text-[#6B738A]">
        <span>{pro.years_experience} años de exp.</span>
        <span className="text-[#DDE1EE]">·</span>
        <span>{pro.languages.join(', ')}</span>
        <span className="text-[#DDE1EE]">·</span>
        <span>{pro.total_consultations} consultas</span>
      </div>

      {pro.bio && (
        <p className="text-xs text-[#6B738A] mb-3 line-clamp-2">{pro.bio}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#DDE1EE]">
        <div>
          <p className="text-base font-bold text-[#141820]">Bs. {parseFloat(pro.price_general).toFixed(0)}</p>
          <p className="text-xs text-[#A0A8BF]">consulta general</p>
        </div>
        <div className="flex gap-2">
          {!isOnline && (
            <button className="btn-secondary text-xs py-1.5 px-3">
              Agendar cita
            </button>
          )}
          {isOnline && onConsult && (
            <button
              onClick={() => onConsult(pro)}
              disabled={loading}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
            >
              {loading && (
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin-slow" />
              )}
              Consultar ahora
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
