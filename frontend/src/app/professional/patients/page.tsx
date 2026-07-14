'use client'
// src/app/professional/patients/page.tsx
//
// "Mis pacientes": agrupa todas mis consultas por paciente para que pueda
// encontrar rápido, por persona, sus consultas anteriores y su historial
// de recetas e historias clínicas (lo mío, y — si el paciente está activo
// conmigo ahora mismo — lo que otros médicos compartieron con la plataforma).

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, EmptyState, Alert } from '@/components/ui'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { PatientRecordSummary } from '@/components/professional/PatientRecordSummary'
import { ProfessionalScheduleModal } from '@/components/professional/ProfessionalScheduleModal'
import { consultationsAPI, patientBlockAPI, professionalsAPI, getErrorMessage } from '@/lib/api'
import type { PatientLink } from '@/lib/api'
import { fmtFechaHora, fmtFechaHoraLocal } from '@/lib/consultationHistory'
import { CHAT_REASON_CATEGORY_LABELS, type ChatReasonCategory } from '@/types'

const IconDots = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
const IconBan = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/></svg>

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
  // true si tiene un vínculo activo (PatientProfessionalLink) — ya sea
  // porque se vinculó a mano o porque se creó automáticamente al
  // completarse una consulta.
  hasActiveLink: boolean
  // true si el paciente se desvinculó explícitamente (existe una fila de
  // vínculo, pero con revoked_at). En ese caso NUNCA se habilita
  // "Agendar cita", aunque tenga consultas completadas previas — la
  // desvinculación es una decisión explícita del paciente y hay que
  // respetarla (ver has_effective_link en el backend).
  linkWasRevoked: boolean
  link: PatientLink | null
}

// Combina el historial de consultas con la lista de vínculos (activos y
// revocados) en una sola lista de pacientes, para no tener "Mis
// pacientes" y "Membresía" mostrando datos distintos y confusos.
// - Pacientes con consultas: aparecen con su historial completo.
// - Pacientes solo vinculados (nunca tuvieron consulta, se vincularon a
//   mano desde la búsqueda): aparecen igual, con 0 consultas.
// - Si se desvincularon explícitamente, se marcan con linkWasRevoked
//   para que la tarjeta no ofrezca "Agendar cita" aunque tengan
//   historial de consultas.
function groupByPatient(consultations: any[], links: PatientLink[]): PatientGroup[] {
  const map = new Map<string, PatientGroup>()
  // `links` trae la fila MÁS RECIENTE por paciente (activa o revocada) —
  // ver GET /professionals/my-patients.
  const linkByPatient = new Map(links.map((l) => [l.patient_id, l]))

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
      const link = linkByPatient.get(c.patient_id) || null
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
        hasActiveLink: !!link && link.revoked_at === null,
        linkWasRevoked: !!link && link.revoked_at !== null,
        link,
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

  // Pacientes vinculados ACTIVAMENTE que todavía no tienen ninguna
  // consulta (se vincularon a mano desde la búsqueda) — no están en
  // `consultations`, hay que agregarlos aparte para que no queden
  // "escondidos" en otra pantalla. Los revocados sin ninguna consulta NO
  // se agregan: no hay nada que mostrar y ya no están vinculados.
  for (const link of links) {
    if (map.has(link.patient_id)) continue
    if (link.revoked_at !== null) continue
    const name = link.patient_first_name ? `${link.patient_first_name} ${link.patient_last_name || ''}`.trim() : 'Paciente'
    const initials = ((link.patient_first_name?.[0] || '') + (link.patient_last_name?.[0] || '')).toUpperCase() || 'P'
    map.set(link.patient_id, {
      patientId: link.patient_id,
      name,
      firstName: link.patient_first_name || '',
      lastName: link.patient_last_name || '',
      photoUrl: link.patient_photo_url || null,
      initials,
      consultations: [],
      total: 0,
      completed: 0,
      isActive: false,
      lastAt: link.created_at,
      hasActiveLink: true,
      linkWasRevoked: false,
      link,
    })
  }

  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

function BlockPatientMenu({ patientId, patientName }: { patientId: string; patientName: string }) {
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [reportChecked, setReportChecked] = useState(false)
  const [reasonCategory, setReasonCategory] = useState<ChatReasonCategory>('OTHER')
  const [reasonText, setReasonText] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: status } = useQuery({
    queryKey: ['patient-block-status', patientId],
    queryFn: () => patientBlockAPI.getStatus(patientId),
    enabled: menuOpen,
  })

  async function handleUnblock() {
    setSubmitting(true)
    setError('')
    try {
      await patientBlockAPI.unblock(patientId)
      queryClient.invalidateQueries({ queryKey: ['patient-block-status', patientId] })
      setMenuOpen(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitBlock() {
    setSubmitting(true)
    setError('')
    try {
      await patientBlockAPI.block(patientId, {
        isReported: reportChecked,
        reasonCategory: reportChecked ? reasonCategory : undefined,
        reasonText: reportChecked ? (reasonText || undefined) : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['patient-block-status', patientId] })
      setModalOpen(false)
      setMenuOpen(false)
      setReportChecked(false)
      setReasonText('')
    } catch (err) {
      // Si el backend responde 409 (citas pendientes), el mensaje ya viene
      // listo para mostrar directamente — ver assert_no_pending_appointments.
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="p-1.5 text-[#6B738A] hover:bg-[#F5F6FA] rounded-lg"
        title="Opciones"
      >
        <IconDots />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-9 w-72 bg-white border border-[#DDE1EE] rounded-xl shadow-lg py-1 z-20">
          {status?.blocked ? (
            <button
              onClick={handleUnblock}
              disabled={submitting}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#185FA5] hover:bg-[#F5F6FA] text-left disabled:opacity-50"
            >
              <IconBan /> Desbloquear paciente
            </button>
          ) : (
            <button
              onClick={() => { setModalOpen(true); setMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#DC2626] hover:bg-[#FEF2F2] text-left"
            >
              <IconBan /> Bloquear paciente y reportar (opcional)
            </button>
          )}
          {error && <p className="px-4 py-2 text-xs text-[#DC2626]">{error}</p>}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-sm font-semibold text-[#141820]">Bloquear a {patientName}</h3>
              <p className="text-xs text-[#6B738A] mt-1">
                Esto bloqueará por completo tu relación con este paciente: no podrán chatear,
                el paciente ya no te verá en sus búsquedas y no podrá agendar nuevas citas contigo.
                Tu historial clínico con este paciente se conserva.
              </p>
            </div>

            {error && <Alert type="error" message={error} />}

            <label className="flex items-start gap-2 text-sm text-[#141820]">
              <input
                type="checkbox"
                checked={reportChecked}
                onChange={(e) => setReportChecked(e.target.checked)}
                className="mt-0.5"
              />
              Además, quiero reportar este caso al equipo de MedicBolivia
            </label>

            {reportChecked && (
              <div className="space-y-3 pl-6">
                <div>
                  <label className="text-xs text-[#6B738A] block mb-1">Motivo</label>
                  <select
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value as ChatReasonCategory)}
                    className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                  >
                    {Object.entries(CHAT_REASON_CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#6B738A] block mb-1">Detalle (opcional)</label>
                  <textarea
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2 resize-none"
                    placeholder="Contanos brevemente qué pasó..."
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-[#6B738A] hover:bg-[#F5F6FA] rounded-lg">
                Cancelar
              </button>
              <button
                onClick={handleSubmitBlock}
                disabled={submitting}
                className="px-4 py-2 text-sm text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Aplicando...' : 'Confirmar bloqueo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PatientCard({ group, membershipActive, onSchedule }: {
  group: PatientGroup
  membershipActive: boolean
  onSchedule: (link: PatientLink) => void
}) {
  const [open, setOpen] = useState(false)
  // El agendamiento directo requiere membresía activa del profesional Y
  // que el paciente esté "efectivamente" vinculado. Si el paciente se
  // desvinculó explícitamente (linkWasRevoked), NUNCA se habilita, sin
  // importar cuántas consultas completadas tenga en su historial — es
  // una decisión suya y se respeta (igual que el backend en
  // app/services/patient_links.py::has_effective_link). Si nunca hubo
  // una desvinculación, cuenta tanto el vínculo manual activo
  // (hasActiveLink) como el historial de consultas completadas.
  const hasEffectiveLink = !group.linkWasRevoked && (group.hasActiveLink || group.completed > 0)
  const canSchedule = hasEffectiveLink && membershipActive
  // Si el paciente no tiene una fila de vínculo real (solo llegó acá por
  // su historial de consultas), armamos un objeto mínimo compatible con
  // ProfessionalScheduleModal (solo usa patient_id / nombre del paciente).
  const linkForSchedule: PatientLink = group.link ?? {
    id: '',
    patient_id: group.patientId,
    professional_id: '',
    created_at: group.lastAt,
    revoked_at: null,
    patient_first_name: group.firstName,
    patient_last_name: group.lastName,
    patient_photo_url: group.photoUrl,
  }
  const sortedConsultations = [...group.consultations].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Mismo queryKey que usa BlockPatientMenu más abajo: comparten caché,
  // así que esto se mantiene sincronizado apenas se bloquea/desbloquea,
  // sin importar si el menú está abierto o no.
  const { data: blockStatus } = useQuery({
    queryKey: ['patient-block-status', group.patientId],
    queryFn: () => patientBlockAPI.getStatus(group.patientId),
  })
  const isBlocked = !!blockStatus?.blocked

  return (
    <div className={`relative border rounded-xl bg-white ${isBlocked ? 'border-[#FCA5A5] bg-[#FFFBFB]' : 'border-[#DDE1EE]'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${isBlocked ? 'hover:bg-[#FEF2F2]' : 'hover:bg-[#F5F6FA]'}`}
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
            <p className={`text-sm font-medium truncate ${isBlocked ? 'text-[#8A8F9C]' : ''}`}>{group.name}</p>
            {isBlocked && (
              <span className="text-[10px] bg-[#FEE2E2] text-[#B91C1C] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 flex items-center gap-1">
                🚫 Bloqueado
              </span>
            )}
            {!isBlocked && group.isActive && (
              <span className="text-[10px] bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                ● Activo ahora
              </span>
            )}
            {!isBlocked && group.linkWasRevoked && (
              <span className="text-[10px] bg-[#F5F6FA] text-[#6B738A] px-2 py-0.5 rounded-full font-medium flex-shrink-0" title="El paciente se desvinculó: conservas su historial, pero ya no puedes agendarle directo.">
                🔗 Se desvinculó
              </span>
            )}
          </div>
          <p className={`text-xs ${isBlocked ? 'text-[#A0A5B5]' : 'text-[#6B738A]'}`}>
            {group.total} consulta{group.total > 1 ? 's' : ''} · {group.completed} completada{group.completed !== 1 ? 's' : ''} · última {fmtFechaHora(group.lastAt)}
          </p>
        </div>
        <IconChevron open={open} />
      </button>

      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        {canSchedule && (
          <button
            onClick={(e) => { e.stopPropagation(); onSchedule(linkForSchedule) }}
            className="btn-primary text-xs py-1.5 px-3"
          >
            Agendar cita
          </button>
        )}
        <BlockPatientMenu patientId={group.patientId} patientName={group.name} />
      </div>

      {open && (
        <div className={`border-t px-4 py-4 space-y-5 ${isBlocked ? 'bg-[#FFF9F9] border-[#FCA5A5]' : 'bg-[#FAFBFC] border-[#DDE1EE]'}`}>
          {isBlocked && (
            <div className="flex items-start gap-2 bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2 text-xs text-[#991B1B]">
              🚫 Bloqueaste integralmente a este paciente: no pueden chatear, no te ve en sus búsquedas y no puede agendar nuevas citas contigo. Tu historial clínico con él se conserva.
            </div>
          )}
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
  const [scheduling, setScheduling] = useState<PatientLink | null>(null)

  const { data: consultations = [], isLoading } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then(r => r.data),
    refetchInterval: 15000,
  })

  // Vínculos activos (PatientProfessionalLink) — habilitan "Agendar cita"
  // junto con la membresía. Ya no viven en una pantalla aparte.
  const { data: links = [], isLoading: loadingLinks } = useQuery({
    queryKey: ['my-linked-patients'],
    queryFn: professionalsAPI.getMyPatients,
    staleTime: 30_000,
  })

  const { data: membership, isLoading: loadingMembership } = useQuery({
    queryKey: ['my-membership'],
    queryFn: professionalsAPI.getMyMembership,
    staleTime: 30_000,
  })

  const { data: profile } = useQuery({
    queryKey: ['professional-profile'],
    queryFn: professionalsAPI.getMyProfile,
    staleTime: 60_000,
  })

  const membershipActive = !!membership?.active
  const defaultAmount = profile ? parseFloat((profile as any).price_general || '0') : 0

  const allPatients = useMemo(() => groupByPatient(consultations as any[], links as PatientLink[]), [consultations, links])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allPatients
    return allPatients.filter(p => p.name.toLowerCase().includes(q))
  }, [allPatients, search])

  const activeCount = allPatients.filter(p => p.isActive).length
  const isLoading_ = isLoading || loadingLinks || loadingMembership

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

        {!loadingMembership && (
          membershipActive ? (
            <div className="mb-4">
              <Alert
                type="success"
                message="Tu membresía está activa: no pagas comisión por tus consultas y puedes agendar directamente a los pacientes vinculados (el botón 'Agendar cita' aparece en su tarjeta), en cualquier horario."
              />
            </div>
          ) : (
            <div className="mb-4">
              <Alert
                type="info"
                message="No tienes una membresía activa. Contacta al administrador para habilitarla — mientras tanto, sigues operando con la comisión normal por consulta y sin agendamiento directo."
              />
            </div>
          )
        )}

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

        {isLoading_ && <LoadingScreen text="Cargando pacientes..." />}

        {!isLoading_ && filtered.length === 0 && (
          <EmptyState
            title={search ? 'No se encontró ningún paciente' : 'Todavía no tienes pacientes'}
            description={search ? 'Probá con otro nombre.' : 'Cuando atiendas tu primera consulta o un paciente se vincule contigo, aparecerá acá.'}
          />
        )}

        <div className="space-y-3">
          {filtered.map(group => (
            <PatientCard
              key={group.patientId}
              group={group}
              membershipActive={membershipActive}
              onSchedule={setScheduling}
            />
          ))}
        </div>
      </div>

      {scheduling && (
        <ProfessionalScheduleModal
          link={scheduling}
          defaultAmount={defaultAmount}
          onClose={() => setScheduling(null)}
        />
      )}
    </DashboardLayout>
  )
}