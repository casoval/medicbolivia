'use client'
// src/app/patient/search/page.tsx

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { ProfessionalCard } from '@/components/patient/ProfessionalCard'
import { LoadingScreen, EmptyState, Alert } from '@/components/ui'
import { professionalsAPI, consultationsAPI } from '@/lib/api'
import type { Professional } from '@/types'

const SPECIALTIES = [
  'Todos', 'Medicina General', 'Cardiología', 'Psicología',
  'Pediatría', 'Nutrición y Dietética', 'Ginecología y Obstetricia',
  'Traumatología y Ortopedia', 'Dermatología',
]

export default function SearchPage() {
  const router = useRouter()
  const [search, setSearch]           = useState('')
  const [specialty, setSpecialty]     = useState('Todos')
  const [availableNow, setAvailableNow] = useState(false)
  const [consultingId, setConsultingId] = useState<string | null>(null)
  const [error, setError]             = useState('')
  const [hasActiveConsultation, setHasActiveConsultation] = useState(false)
  const [activeConsultationId, setActiveConsultationId]   = useState<string | null>(null)

  const { data: professionals = [], isLoading } = useQuery({
    queryKey: ['professionals', specialty, availableNow, search],
    queryFn: () => professionalsAPI.list({
      specialty: specialty !== 'Todos' ? specialty : undefined,
      available_now: availableNow || undefined,
      search: search || undefined,
    }).then((r) => r.data),
    staleTime: 30_000,
  })

  const createConsultation = useMutation({
    mutationFn: (pro: Professional) =>
      consultationsAPI.create({
        professional_id: pro.id,
        consultation_type: 'IMMEDIATE',
        specialty: pro.specialty,
      }),
    onMutate: (pro) => {
      setConsultingId(pro.id)
      setError('')
      setHasActiveConsultation(false)
    },
    onSuccess: (res) => {
      router.push(`/patient/waiting-room?consultationId=${res.data.id}`)
    },
    onError: (err: any) => {
      setConsultingId(null)
      const detail = err?.response?.data?.detail || ''
      // Detectar error de consulta activa (409)
      if (err?.response?.status === 409) {
        // Extraer el ID del mensaje si viene
        const match = detail.match(/ID: ([a-f0-9-]+)/)
        if (match) setActiveConsultationId(match[1])
        setHasActiveConsultation(true)
      } else {
        setError(detail || 'Error al crear la consulta')
      }
    },
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/search" role="PATIENT">
      <div className="max-w-3xl">

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-4">
          <div>
            <h1 className="text-base font-semibold">Profesionales disponibles</h1>
            <p className="text-xs text-[#6B738A] mt-0.5">Consulta inmediata o agenda una cita</p>
          </div>
          <a href="/patient/agent" className="text-xs bg-[#E6F1FB] text-[#185FA5] border border-[#85B7EB] px-3 py-1.5 rounded-lg hover:bg-[#B5D4F4] transition-colors">
            No sé qué especialista →
          </a>
        </div>

        {/* Error genérico */}
        {error && (
          <div className="mb-4">
            <Alert type="error" message={error} />
          </div>
        )}

        {/* Banner consulta activa — amigable */}
        {hasActiveConsultation && (
          <div className="mb-4 bg-[#FAEEDA] border border-[#FAC775] rounded-xl p-4">
            <p className="text-sm font-semibold text-[#854F0B] mb-1">Ya tienes una consulta en curso</p>
            <p className="text-xs text-[#854F0B] mb-3">
              Debes finalizar o cancelar tu consulta actual antes de iniciar una nueva.
            </p>
            <div className="flex gap-2">
              <a
                href={activeConsultationId ? `/patient/waiting-room?consultationId=${activeConsultationId}` : '/patient/waiting-room'}
                className="text-xs bg-[#854F0B] text-white px-3 py-1.5 rounded-lg hover:bg-[#6b3e08] transition-colors"
              >
                Ir a mi consulta →
              </a>
              <button
                onClick={() => setHasActiveConsultation(false)}
                className="text-xs text-[#854F0B] hover:underline"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Buscador */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A8BF]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              className="input pl-8"
              placeholder="Buscar por nombre o especialidad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Filtros especialidad */}
        <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1 mb-3 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
          {SPECIALTIES.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpecialty(sp)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                specialty === sp
                  ? 'bg-[#E6F1FB] border-[#185FA5] text-[#185FA5] font-medium'
                  : 'bg-white border-[#DDE1EE] text-[#6B738A] hover:border-[#A0A8BF]'
              }`}
            >
              {sp}
            </button>
          ))}
        </div>

        {/* Toggle disponibles */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setAvailableNow(!availableNow)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-colors ${
              availableNow
                ? 'bg-[#E1F5EE] border-[#1D9E75] text-[#0F6E56] font-medium'
                : 'bg-white border-[#DDE1EE] text-[#6B738A]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${availableNow ? 'bg-[#1D9E75]' : 'bg-[#A0A8BF]'}`} />
            Disponibles ahora
          </button>
          {professionals.length > 0 && (
            <p className="text-xs text-[#6B738A]">
              {professionals.length} profesional{professionals.length !== 1 ? 'es' : ''} encontrado{professionals.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Resultados */}
        {isLoading ? (
          <LoadingScreen text="Buscando profesionales..." />
        ) : professionals.length === 0 ? (
          <EmptyState
            title="No se encontraron profesionales"
            description="Intenta con otra especialidad o quita los filtros"
            action={
              <button onClick={() => { setSpecialty('Todos'); setAvailableNow(false); setSearch('') }}
                className="btn-secondary text-xs">
                Limpiar filtros
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {professionals.map((pro) => (
              <ProfessionalCard
                key={pro.id}
                professional={pro}
                onConsult={() => createConsultation.mutate(pro)}
                loading={consultingId === pro.id && createConsultation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}