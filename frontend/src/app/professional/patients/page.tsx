'use client'
// src/app/professional/patients/page.tsx
//
// "Mis pacientes": agrupa todas mis consultas por paciente para que pueda
// encontrar rápido, por persona, sus consultas anteriores y su historial
// de recetas e historias clínicas (lo mío, y — si el paciente está activo
// conmigo ahora mismo — lo que otros médicos compartieron con la plataforma).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState } from '@/components/ui'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { PatientRecordSummary } from '@/components/professional/PatientRecordSummary'
import { consultationsAPI } from '@/lib/api'
import { fmtFechaHora, fmtFechaHoraLocal } from '@/lib/consultationHistory'

const IconSearch = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    className={`transition-transform ${open ? 'rotate-180' : ''}`}>
    <polyline points="6,9 12,15 18,9" />
  </svg>
)

// Estados que cuentan como "el paciente está activo conmigo ahora" — listo
// para atender, en curso, o con una cita agendada todavía por venir.
const ACTIVE_STATUSES = new Set(['WAITING_PROFESSIONAL', 'PAYMENT_CONFIRMED', 'IN_PROGRESS'])

interface PatientGroup {
  patientId: string
  name: string
  firstName: string
  lastName: string
  photoUrl: string | null
  initials: string
  consultations: any[]
  total: number
  completed: number
  isActive: boolean
  lastAt: string
}

function groupByPatient(consultations: any[]): PatientGroup[] {
  const map = new Map<string, PatientGroup>()
  for (const c of consultations) {
    if (!c.patient_id) continue
    const name = c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : 'Paciente'
    const initials = ((c.patient_first_name?.[0] || '') + (c.patient_last_name?.[0] || '')).toUpperCase() || 'P'

    const isFutureScheduled =
      c.consultation_type === 'SCHEDULED' &&
      c.scheduled_at &&
      new Date(c.scheduled_at).getTime() > Date.now() &&
      c.status !== 'CANCELLED' && c.status !== 'REFUNDED'

    const isActiveNow = ACTIVE_STATUSES.has(c.status) || isFutureScheduled

    let group = map.get(c.patient_id)
    if (!group) {
      group = {
        patientId: c.patient_id,
        name,
        firstName: c.patient_first_name || '',
        lastName: c.patient_last_name || '',
        photoUrl: c.patient_photo_url || null,
        initials,
        consultations: [],
        total: 0,
        completed: 0,
        isActive: false,
        lastAt: c.created_at,
      }
      map.set(c.patient_id, group)
    }
    // La foto es del paciente (no de la consulta), así que basta con
    // quedarnos con la primera que venga con foto.
    if (c.patient_photo_url && !group.photoUrl) {
      group.photoUrl = c.patient_photo_url
    }
    group.consultations.push(c)
    group.total += 1
    if (c.status === 'COMPLETED') group.completed += 1
    if (isActiveNow) group.isActive = true
    if (new Date(c.created_at).getTime() > new Date(group.lastAt).getTime()) group.lastAt = c.created_at
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

function PatientCard({ group }: { group: PatientGroup }) {
  const [open, setOpen] = useState(false)
  const sortedConsultations = [...group.consultations].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <PatientAvatar
          firstName={group.firstName}
          lastName={group.lastName}
          photoUrl={group.photoUrl}
          size="w-10 h-10"
          textSize="text-sm"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{group.name}</p>
            {group.isActive && (
              <span className="text-[10px] bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                ● Activo ahora
              </span>
            )}
          </div>
          <p className="text-xs text-[#6B738A]">
            {group.total} consulta{group.total > 1 ? 's' : ''} · {group.completed} completada{group.completed !== 1 ? 's' : ''} · última {fmtFechaHora(group.lastAt)}
          </p>
        </div>
        <IconChevron open={open} />
      </button>

      {open && (
        <div className="bg-[#FAFBFC] border-t border-[#DDE1EE] px-4 py-4 space-y-5">
          {/* Historial de consultas */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
              🗓️ Consultas ({sortedConsultations.length})
            </p>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {sortedConsultations.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2 bg-white border border-[#DDE1EE] rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.specialty || 'Consulta general'}</p>
                    <p className="text-[11px] text-[#6B738A]">
                      {c.scheduled_at ? fmtFechaHoraLocal(c.scheduled_at) : fmtFechaHora(c.created_at)} · Bs. {parseFloat(c.professional_earning ?? c.amount ?? 0).toFixed(2)}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Recetas + historias clínicas mías, y compartidas si está activo */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
              🗂️ Historial clínico
            </p>
            <PatientRecordSummary patientId={group.patientId} showSharedFromOthers={group.isActive} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProfessionalPatientsPage() {
  const [search, setSearch] = useState('')

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then(r => r.data),
    refetchInterval: 15000,
  })

  const allPatients = useMemo(() => groupByPatient(consultations as any[]), [consultations])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allPatients
    return allPatients.filter(p => p.name.toLowerCase().includes(q))
  }, [allPatients, search])

  const activeCount = allPatients.filter(p => p.isActive).length

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/patients" role="PROFESSIONAL">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-[#141820]">Mis pacientes</h1>
          <p className="text-sm text-[#6B738A] mt-0.5">
            {allPatients.length} paciente{allPatients.length !== 1 ? 's' : ''}
            {activeCount > 0 ? ` · ${activeCount} activo${activeCount > 1 ? 's' : ''} ahora` : ''}
          </p>
        </div>

        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A8BF]"><IconSearch /></span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar paciente por nombre..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-[#DDE1EE] rounded-xl focus:outline-none focus:border-[#185FA5] bg-white"
          />
        </div>

        {isLoading && <LoadingScreen text="Cargando pacientes..." />}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            title={search ? 'No se encontró ningún paciente' : 'Todavía no tienes pacientes'}
            description={search ? 'Probá con otro nombre.' : 'Cuando atiendas tu primera consulta, el paciente aparecerá acá.'}
          />
        )}

        <div className="space-y-3">
          {filtered.map(group => (
            <PatientCard key={group.patientId} group={group} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}