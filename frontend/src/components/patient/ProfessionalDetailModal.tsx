'use client'
// src/components/patient/ProfessionalDetailModal.tsx
// Presentación grande del profesional: foto ampliada, nombre, especialidad,
// subespecialidades, biografía completa y accesos directos para agendar/consultar.

import { Avatar, Stars, StatusBadge } from '@/components/ui'
import type { Professional } from '@/types'

interface ProfessionalDetailModalProps {
  professional: Professional
  onClose: () => void
  onBook: () => void
  onConsult?: (pro: Professional) => void
  consultLoading?: boolean
}

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

export function ProfessionalDetailModal({
  professional: pro,
  onClose,
  onBook,
  onConsult,
  consultLoading,
}: ProfessionalDetailModalProps) {
  const color = SPECIALTY_COLORS[pro.specialty] || 'blue'
  const initials = `${pro.first_name[0]}${pro.last_name[0]}`
  const isOnline = pro.availability === 'ONLINE_NOW'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera con foto grande */}
        <div className="relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-[#6B738A] hover:text-[#3C4257] text-xl leading-none shadow-sm z-10"
          >
            ×
          </button>
          <div className="bg-gradient-to-b from-[#E6F1FB] to-white pt-8 pb-4 flex flex-col items-center">
            {pro.photo_url ? (
              <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-white shadow-md">
                <img
                  src={pro.photo_url}
                  alt={`${pro.first_name} ${pro.last_name}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.currentTarget
                    target.style.display = 'none'
                    target.parentElement!.innerHTML = `
                      <div class="w-full h-full rounded-full flex items-center justify-center bg-[#E6F1FB] text-[#185FA5] text-2xl font-semibold">
                        ${initials}
                      </div>`
                  }}
                />
              </div>
            ) : (
              <div className="border-4 border-white rounded-full shadow-md">
                <Avatar initials={initials} color={color} size="lg" />
              </div>
            )}

            <h2 className="text-lg font-semibold text-[#141820] mt-3 text-center px-6">
              {pro.first_name} {pro.last_name}
            </h2>
            <p className="text-sm text-[#6B738A] mt-0.5 text-center px-6">
              {pro.specialty}
              {pro.department && <span> · {pro.department}</span>}
            </p>

            {pro.sub_specialties && pro.sub_specialties.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 mt-2 px-6">
                {pro.sub_specialties.map((sub) => (
                  <span
                    key={sub}
                    className="text-xs bg-white border border-[#DDE1EE] text-[#3C4257] px-2 py-0.5 rounded-full"
                  >
                    {sub}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 mt-3">
              <Stars score={Math.round(parseFloat(pro.average_rating))} size="sm" />
              <span className="text-xs text-[#6B738A]">
                {parseFloat(pro.average_rating).toFixed(1)} ({pro.total_ratings} calificaciones)
              </span>
            </div>

            <div className="mt-2">
              <StatusBadge status={pro.availability} />
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          {/* Datos rápidos */}
          <div className="grid grid-cols-3 gap-2 py-4 border-y border-[#DDE1EE] text-center">
            <div>
              <p className="text-sm font-semibold text-[#141820]">{pro.years_experience}</p>
              <p className="text-[10px] text-[#A0A8BF]">años de exp.</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#141820]">{pro.total_consultations}</p>
              <p className="text-[10px] text-[#A0A8BF]">consultas</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#141820] truncate">{pro.languages.join(', ')}</p>
              <p className="text-[10px] text-[#A0A8BF]">idiomas</p>
            </div>
          </div>

          {/* Biografía completa, sin recortar */}
          {pro.bio && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-[#3C4257] mb-1">Sobre mí</h3>
              <p className="text-sm text-[#6B738A] whitespace-pre-line">{pro.bio}</p>
            </div>
          )}

          {/* Precios y acciones */}
          <div className="flex gap-2 mt-5">
            <div className="flex-1 flex flex-col items-center gap-1">
              <button
                onClick={onBook}
                className="btn-secondary text-xs py-2 px-3 w-full"
              >
                Agendar cita
              </button>
              <span className="text-xs font-semibold text-[#3C4257]">Bs. {parseFloat(pro.price_general).toFixed(0)}</span>
            </div>
            {isOnline && onConsult && (
              <div className="flex-1 flex flex-col items-center gap-1">
                <button
                  onClick={() => onConsult(pro)}
                  disabled={consultLoading}
                  className="btn-primary text-xs py-2 px-3 flex items-center justify-center gap-1 w-full"
                >
                  {consultLoading && (
                    <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin-slow" />
                  )}
                  Consultar ahora
                </button>
                <span className="text-xs font-semibold text-[#185FA5]">Bs. {parseFloat(pro.price_urgent).toFixed(0)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
