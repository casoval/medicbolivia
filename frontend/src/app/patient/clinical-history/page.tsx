'use client'
// src/app/patient/clinical-history/page.tsx

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { Alert, Toggle } from '@/components/ui'
import { clinicalNotesAPI, getErrorMessage } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'

function fmtFecha(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz'
  })
}

// Toggle visual de compartir — el paciente activa/desactiva por nota
function ShareToggle({ note, onToggled }: { note: ClinicalNote; onToggled: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function toggle() {
    setLoading(true)
    setError('')
    try {
      await clinicalNotesAPI.share(note.id, !note.shared_with_professionals)
      onToggled()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#DDE1EE] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs font-semibold text-[#1A1F2E]">
            {note.shared_with_professionals ? '🔓 Compartida con otros médicos' : '🔒 Privada (solo este médico la ve)'}
          </p>
          <p className="text-[11px] text-[#6B738A] mt-0.5">
            {note.shared_with_professionals
              ? 'Cualquier médico verificado de la plataforma puede ver esta nota si te atiende en el futuro.'
              : 'Solo el médico que la escribió puede verla. Actívalo si quieres que otros médicos la consulten.'}
          </p>
        </div>
        <Toggle
          on={note.shared_with_professionals}
          onChange={toggle}
          disabled={loading}
          activeColor="#1D9E75"
        />
      </div>
      {error && <p className="text-[11px] text-[#A32D2D] mt-2">{error}</p>}
    </div>
  )
}

function ClinicalNoteCard({ note, onChanged }: { note: ClinicalNote; onChanged: () => void }) {
  const [open, setOpen] = useState(false)

  const fields: { label: string; value?: string | null; icon: string }[] = [
    { label: 'Lo que reporté',        value: note.subjective, icon: '🗣️' },
    { label: 'Hallazgos del médico',  value: note.objective,  icon: '🔍' },
    { label: 'Evaluación',            value: note.assessment, icon: '🩺' },
    { label: 'Plan e indicaciones',   value: note.plan,       icon: '📌' },
  ].filter(f => f.value && f.value.trim())

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-sm flex-shrink-0">
          📋
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{note.professional_name || 'Médico'}</p>
          <p className="text-xs text-[#6B738A]">
            {note.professional_specialty || 'Consulta'} · {fmtFecha(note.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {note.shared_with_professionals && (
            <span className="text-[10px] bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full font-medium">Compartida</span>
          )}
          <span className="text-[#6B738A] text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="bg-[#FAFBFC] border-t border-[#DDE1EE] px-4 py-4 space-y-3">
          {fields.length === 0 ? (
            <p className="text-xs text-[#A0A8BF] text-center py-2">El médico no agregó detalles en esta nota.</p>
          ) : (
            fields.map(f => (
              <div key={f.label} className="bg-white rounded-lg border border-[#DDE1EE] p-3">
                <p className="text-xs font-semibold text-[#1A1F2E] mb-1">{f.icon} {f.label}</p>
                <p className="text-xs text-[#3C4257] leading-relaxed whitespace-pre-wrap">{f.value}</p>
              </div>
            ))
          )}

          <ShareToggle note={note} onToggled={onChanged} />
        </div>
      )}
    </div>
  )
}

// ── Grupo de notas del mismo profesional ─────────────
function ProfessionalGroup({
  group, onChanged
}: {
  group: { professionalId: string; professionalName: string; specialty?: string | null; notes: ClinicalNote[] }
  onChanged: () => void
}) {
  const [open, setOpen] = useState(true) // abierto por defecto

  const sorted = [...group.notes].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="border border-[#DDE1EE] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#F5F6FA] hover:bg-[#EEF0F6] transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {group.professionalName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1F2E] truncate">{group.professionalName}</p>
          <p className="text-xs text-[#6B738A]">
            {group.specialty ? `${group.specialty} · ` : ''}
            {group.notes.length} nota{group.notes.length !== 1 ? 's' : ''} clínica{group.notes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="text-[#A0A8BF] text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="divide-y divide-[#DDE1EE]">
          {sorted.map(note => (
            <div key={note.id} className="px-2 py-2">
              <ClinicalNoteCard note={note} onChanged={onChanged} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PatientClinicalHistoryPage() {
  const qc = useQueryClient()
  const [viewMode, setViewMode] = useState<'date' | 'professional'>('date')

  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: ['clinical-notes', 'patient'],
    queryFn: () => clinicalNotesAPI.getMyHistory().then(r => r.data),
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['clinical-notes', 'patient'] })
  }

  const sorted = [...notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Agrupar por profesional
  type ProfGroup = { professionalId: string; professionalName: string; specialty?: string | null; notes: ClinicalNote[] }
  const groupedByProfessional: ProfGroup[] = Object.values(
    notes.reduce((acc: Record<string, ProfGroup>, n) => {
      const key = n.professional_id
      if (!acc[key]) {
        acc[key] = {
          professionalId: key,
          professionalName: n.professional_name || 'Médico',
          specialty: n.professional_specialty,
          notes: [],
        }
      }
      acc[key].notes.push(n)
      return acc
    }, {})
  ).sort((a, b) => {
    const latestA = Math.max(...a.notes.map(n => new Date(n.created_at).getTime()))
    const latestB = Math.max(...b.notes.map(n => new Date(n.created_at).getTime()))
    return latestB - latestA
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/clinical-history" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-5">
          <h1 className="text-base font-semibold">Mi historia clínica</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Notas que tus médicos fueron registrando durante tus consultas. Tú decides si compartirlas con otros profesionales de la plataforma.
          </p>
        </div>

        <div className="bg-[#EEF3FB] border border-[#C3D6EF] rounded-xl px-4 py-3 mb-5 flex gap-2.5">
          <span className="text-base leading-none">🔒</span>
          <p className="text-xs text-[#185FA5] leading-relaxed">
            Esta información es privada por defecto. Solo el médico que escribió cada nota puede verla, salvo que tú actives
            "Compartir" — en ese caso, cualquier médico verificado de MedicBolivia podrá consultarla si te atiende en el futuro.
          </p>
        </div>

        {error && <div className="mb-4"><Alert type="error" message={getErrorMessage(error)} /></div>}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => <div key={n} className="h-16 bg-[#F5F6FA] rounded-2xl animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="card text-center py-14">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm font-semibold text-[#1A1F2E]">Sin historia clínica aún</p>
            <p className="text-xs text-[#6B738A] mt-1 max-w-xs mx-auto">
              Las notas que tu médico registre durante tus consultas aparecerán aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#A0A8BF]">
                {sorted.length} nota{sorted.length !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-1 bg-[#F5F6FA] rounded-lg p-1">
                <button
                  onClick={() => setViewMode('date')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'date' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  🕐 Por fecha
                </button>
                <button
                  onClick={() => setViewMode('professional')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'professional' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  🩺 Por profesional
                </button>
              </div>
            </div>

            {viewMode === 'date' ? (
              <div className="space-y-3">
                {sorted.map((note: ClinicalNote) => (
                  <ClinicalNoteCard key={note.id} note={note} onChanged={refresh} />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByProfessional.map(group => (
                  <ProfessionalGroup key={group.professionalId} group={group} onChanged={refresh} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}