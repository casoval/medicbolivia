// src/components/patient/ProfessionalCard.tsx
// Tarjeta de profesional reutilizable en búsqueda y resultados del agente

import { useState } from 'react'
import { Avatar, Stars, StatusBadge } from '@/components/ui'
import { BookAppointmentModal } from './BookAppointmentModal'
import { ProfessionalDetailModal } from './ProfessionalDetailModal'
import type { Professional } from '@/types'

const SPECIALTY_COLORS: Record<string, 'blue' | 'teal' | 'purple' | 'coral' | 'amber'> = {
  'Cardiología':       'coral',
  'Psicología':        'purple',
  'Pediatría':         'blue',
  'Nutrición y Dietética':      'teal',
  'Medicina General':           'blue',
  'Ginecología y Obstetricia':  'coral',
  'Traumatología y Ortopedia':  'amber',
  'Dermatología':               'teal',
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
  const [showBooking, setShowBooking] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)

  // Avatar con foto real si existe, o iniciales como fallback
  const PhotoAvatar = ({ size }: { size: 'md' | 'lg' }) => {
    const px = size === 'lg' ? 'w-12 h-12' : 'w-9 h-9'
    if (pro.photo_url) {
      return (
        <div className={`${px} rounded-full overflow-hidden flex-shrink-0 border border-[#DDE1EE]`}>
          <img
            src={pro.photo_url}
            alt={`${pro.first_name} ${pro.last_name}`}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Si la imagen falla, mostrar iniciales
              const target = e.currentTarget
              target.style.display = 'none'
              target.parentElement!.innerHTML = `
                <div class="${px} rounded-full flex items-center justify-center bg-[#E6F1FB] text-[#185FA5] text-sm font-semibold flex-shrink-0">
                  ${initials}
                </div>`
            }}
          />
        </div>
      )
    }
    return <Avatar initials={initials} color={color} size={size} />
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 py-3 border-b border-[#DDE1EE] last:border-0">
        <PhotoAvatar size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{pro.first_name} {pro.last_name}</p>
          <p className="text-xs text-[#6B738A]">
            {pro.specialty}
            {pro.department && <span> · {pro.department}</span>}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold">Bs. {parseFloat(pro.price_general).toFixed(0)}</p>
          <StatusBadge status={pro.availability} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="card hover:border-[#185FA5] transition-colors cursor-pointer group"
      onClick={() => setShowDetail(true)}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <PhotoAvatar size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{pro.first_name} {pro.last_name}</p>
              <p className="text-xs text-[#6B738A] mt-0.5">
                {pro.specialty}
                {pro.department && <span> · {pro.department}</span>}
              </p>
              {pro.sub_specialties && pro.sub_specialties.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {pro.sub_specialties.map((sub) => (
                    <span
                      key={sub}
                      className="text-[10px] bg-[#F1F3F9] text-[#6B738A] px-1.5 py-0.5 rounded-full"
                    >
                      {sub}
                    </span>
                  ))}
                </div>
              )}
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
        <div className="mb-3">
          <p className={`text-xs text-[#6B738A] ${bioExpanded ? '' : 'line-clamp-2'}`}>{pro.bio}</p>
          <button
            onClick={(e) => { e.stopPropagation(); setBioExpanded((v) => !v) }}
            className="text-xs text-[#185FA5] font-medium mt-0.5 hover:underline"
          >
            {bioExpanded ? 'Ver menos' : 'Ver más'}
          </button>
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-end gap-3 pt-3 border-t border-[#DDE1EE]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => setShowBooking(true)}
            className="btn-secondary text-xs py-1.5 px-3 w-full"
          >
            Agendar cita
          </button>
          <span className="text-xs font-semibold text-[#3C4257]">Bs. {parseFloat(pro.price_general).toFixed(0)}</span>
        </div>
        {isOnline && onConsult && (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => onConsult(pro)}
              disabled={loading}
              className="btn-primary text-xs py-1.5 px-3 flex items-center justify-center gap-1 w-full"
            >
              {loading && (
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin-slow" />
              )}
              Consultar ahora
            </button>
            <span className="text-xs font-semibold text-[#185FA5]">Bs. {parseFloat(pro.price_urgent).toFixed(0)}</span>
          </div>
        )}
      </div>

      {showBooking && (
        <BookAppointmentModal professional={pro} onClose={() => setShowBooking(false)} />
      )}

      {showDetail && (
        <ProfessionalDetailModal
          professional={pro}
          onClose={() => setShowDetail(false)}
          onBook={() => { setShowDetail(false); setShowBooking(true) }}
          onConsult={onConsult}
          consultLoading={loading}
        />
      )}
    </div>
  )
}