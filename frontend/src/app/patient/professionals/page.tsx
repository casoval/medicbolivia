'use client'
// src/app/patient/professionals/page.tsx
//
// "Mis profesionales": agrupa todas mis consultas por profesional para
// encontrar rápido, por médico, el historial de consultas, recetas e
// historias clínicas que tengo con cada uno.
//
// No hace falta ningún endpoint nuevo: el paciente ya tiene acceso a TODO
// su historial (consultationsAPI.getMyConsultations, prescriptionsAPI.
// getMyPatient, clinicalNotesAPI.getMyHistory) — acá solo se agrupa por
// profesional en el cliente.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState } from '@/components/ui'
import { ProfessionalRecordSummary } from '@/components/patient/ProfessionalRecordSummary'
import { consultationsAPI, prescriptionsAPI, clinicalNotesAPI, patientLinksAPI } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'
import { fmtFechaHora, fmtFechaHoraLocal } from '@/lib/consultationHistory'
import type { Consultation, Prescription } from '@/types'

const IconSearch2 = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    className={`transition-transform ${open ? 'rotate-180' : ''}`}>
    <polyline points="6,9 12,15 18,9" />
  </svg>
)

// Estados que cuentan como "todavía tengo algo pendiente con este médico" —
// una cita agendada por venir o una consulta en curso.
const ACTIVE_STATUSES = new Set(['WAITING_PROFESSIONAL', 'PAYMENT_CONFIRMED', 'IN_PROGRESS'])

interface ProfessionalGroup {
  professionalId: string
  name: string
  initials: string
  specialty?: string
  photoUrl?: string | null
  consultations: Consultation[]
  prescriptions: Prescription[]
  notes: ClinicalNote[]
  total: number
  completed: number
  isActive: boolean
  lastAt: string
}

function doctorName(c: Consultation) {
  return c.professional_first_name
    ? `Dr. ${c.professional_first_name} ${c.professional_last_name || ''}`.trim()
    : 'Profesional'
}

function groupByProfessional(
  consultations: Consultation[],
  prescriptions: Prescription[],
  notes: ClinicalNote[]
): ProfessionalGroup[] {
  const map = new Map<string, ProfessionalGroup>()
  // consultation_id -> professional_id, para poder ubicar cada receta
  // (las recetas no traen professional_id propio, sí consultation_id).
  const consultationToProfessional = new Map<string, string>()

  for (const c of consultations) {
    if (!c.professional_id) continue
    consultationToProfessional.set(c.id, c.professional_id)

    const name = doctorName(c)
    const initials = ((c.professional_first_name?.[0] || '') + (c.professional_last_name?.[0] || '')).toUpperCase() || 'D'

    const isFutureScheduled =
      c.consultation_type === 'SCHEDULED' &&
      (c as any).scheduled_at &&
      new Date((c as any).scheduled_at).getTime() > Date.now() &&
      c.status !== 'CANCELLED' && c.status !== 'REFUNDED'

    const isActiveNow = ACTIVE_STATUSES.has(c.status) || isFutureScheduled

    let group = map.get(c.professional_id)
    if (!group) {
      group = {
        professionalId: c.professional_id,
        name,
        initials,
        specialty: c.specialty,
        photoUrl: c.professional_photo_url,
        consultations: [],
        prescriptions: [],
        notes: [],
        total: 0,
        completed: 0,
        isActive: false,
        lastAt: c.created_at,
      }
      map.set(c.professional_id, group)
    }
    group.consultations.push(c)
    group.total += 1
    if (c.status === 'COMPLETED') group.completed += 1
    if (isActiveNow) group.isActive = true
    if (!group.photoUrl && c.professional_photo_url) group.photoUrl = c.professional_photo_url
    if (new Date(c.created_at).getTime() > new Date(group.lastAt).getTime()) group.lastAt = c.created_at
  }

  for (const rx of prescriptions) {
    const profId = consultationToProfessional.get(rx.consultation_id)
    if (profId && map.has(profId)) map.get(profId)!.prescriptions.push(rx)
  }

  for (const note of notes) {
    const profId = (note as any).professional_id
    if (profId && map.has(profId)) map.get(profId)!.notes.push(note)
  }

  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

function DoctorAvatar({ initials, photoUrl, name }: { initials: string; photoUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-[#F5F6FA]"
      />
    )
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-sm font-bold flex-shrink-0">
      {initials}
    </div>
  )
}

function ProfessionalCard({ group }: { group: ProfessionalGroup }) {
  const [open, setOpen] = useState(false)
  const sortedConsultations = [...group.consultations].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Vínculo "Mis pacientes": se crea solo (automático) al completar la
  // primera consulta con este profesional, o a mano desde "Buscar médico".
  // Acá solo mostramos el estado y permitimos vincularse manualmente si
  // por algún motivo no quedó vinculado todavía (ej. todas sus consultas
  // fueron canceladas antes de completarse).
  const qc = useQueryClient()
  const { data: myLinks = [] } = useQuery({
    queryKey: ['patient-links'],
    queryFn: patientLinksAPI.getMine,
    staleTime: 30_000,
  })
  const isLinked = myLinks.some((l) => l.professional_id === group.professionalId)
  const [linkError, setLinkError] = useState('')

  const linkMutation = useMutation({
    mutationFn: () => (isLinked ? patientLinksAPI.revoke(group.professionalId) : patientLinksAPI.create(group.professionalId)),
    onMutate: () => setLinkError(''),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient-links'] }),
    onError: (err: any) => setLinkError(err?.response?.data?.detail || 'No se pudo actualizar el vínculo'),
  })

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <DoctorAvatar initials={group.initials} photoUrl={group.photoUrl} name={group.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{group.name}</p>
            {group.isActive && (
              <span className="text-[10px] bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                ● Cita pendiente
              </span>
            )}
            {isLinked ? (
              <span className="text-[10px] bg-[#E6F1FB] text-[#185FA5] px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                ✓ Vinculado
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); linkMutation.mutate() }}
                disabled={linkMutation.isPending}
                className="text-[10px] border border-[#DDE1EE] text-[#6B738A] hover:border-[#185FA5] hover:text-[#185FA5] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
              >
                {linkMutation.isPending ? '...' : 'Vincularme'}
              </button>
            )}
          </div>
          <p className="text-xs text-[#6B738A]">
            {group.specialty ? `${group.specialty} · ` : ''}
            {group.total} consulta{group.total > 1 ? 's' : ''} · {group.completed} completada{group.completed !== 1 ? 's' : ''} · última {fmtFechaHora(group.lastAt)}
          </p>
          {linkError && <p className="text-[10px] text-[#D14343] mt-0.5">{linkError}</p>}
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
                      {c.scheduled_at ? fmtFechaHoraLocal(c.scheduled_at) : fmtFechaHora(c.created_at)} · Bs. {parseFloat(c.amount ?? 0).toFixed(2)}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Recetas + historias clínicas que tengo con este profesional */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
              🗂️ Mi historial con este médico
            </p>
            <ProfessionalRecordSummary prescriptions={group.prescriptions} notes={group.notes} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function PatientProfessionalsPage() {
  const [search, setSearch] = useState('')

  const { data: consultations = [], isLoading: loadingC } = useQuery({
    queryKey: ['consultations', 'patient'],
    queryFn: () => consultationsAPI.getMyConsultations().then(r => r.data),
    refetchInterval: 15000,
  })
  const { data: prescriptions = [], isLoading: loadingRx } = useQuery({
    queryKey: ['prescriptions', 'patient', 'my'],
    queryFn: () => prescriptionsAPI.getMyPatient(),
  })
  const { data: notes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ['clinical-notes', 'patient', 'my'],
    queryFn: () => clinicalNotesAPI.getMyHistory().then(r => r.data),
  })

  const isLoading = loadingC || loadingRx || loadingNotes

  const allProfessionals = useMemo(
    () => groupByProfessional(consultations as Consultation[], prescriptions as Prescription[], notes as ClinicalNote[]),
    [consultations, prescriptions, notes]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allProfessionals
    return allProfessionals.filter(p => p.name.toLowerCase().includes(q) || (p.specialty || '').toLowerCase().includes(q))
  }, [allProfessionals, search])

  const activeCount = allProfessionals.filter(p => p.isActive).length

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/professionals" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-[#141820]">Mis profesionales</h1>
          <p className="text-sm text-[#6B738A] mt-0.5">
            {allProfessionals.length} médico{allProfessionals.length !== 1 ? 's' : ''}
            {activeCount > 0 ? ` · ${activeCount} con cita pendiente` : ''}
          </p>
        </div>

        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A8BF]"><IconSearch2 /></span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar médico por nombre o especialidad..."
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-[#DDE1EE] rounded-xl focus:outline-none focus:border-[#185FA5] bg-white"
          />
        </div>

        {isLoading && <LoadingScreen text="Cargando profesionales..." />}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            title={search ? 'No se encontró ningún médico' : 'Todavía no tienes consultas'}
            description={search ? 'Probá con otro nombre o especialidad.' : 'Cuando tengas tu primera consulta, el profesional aparecerá acá.'}
          />
        )}

        <div className="space-y-3">
          {filtered.map(group => (
            <ProfessionalCard key={group.professionalId} group={group} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}