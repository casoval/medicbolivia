'use client'
// src/app/professional/clinical-notes/page.tsx

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { Alert } from '@/components/ui'
import { clinicalNotesAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'

function fmtFecha(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz'
  })
}

function fmtFechaHora(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleString('es-BO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/La_Paz'
  })
}

const SOAP_LABELS: { key: keyof ClinicalNote; label: string; icon: string }[] = [
  { key: 'subjective', label: 'Subjetivo — relato del paciente', icon: '🗣️' },
  { key: 'objective',  label: 'Objetivo — hallazgos',           icon: '🔍' },
  { key: 'assessment', label: 'Evaluación — impresión clínica', icon: '🩺' },
  { key: 'plan',       label: 'Plan e indicaciones',            icon: '📌' },
]

function NoteCard({ note, onChanged }: { note: ClinicalNote; onChanged: () => void }) {
  const [open, setOpen]       = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState({
    subjective:           note.subjective  ?? '',
    objective:            note.objective   ?? '',
    assessment:           note.assessment  ?? '',
    plan:                 note.plan        ?? '',
    is_visible_to_patient: note.is_visible_to_patient,
  })

  // Ventana de edición: pasadas 24h desde que se creó la nota (y la
  // consulta ya no está en curso), is_editable llega en false desde el
  // backend y hay que usar un addendum en vez de sobreescribir.
  const isEditable = note.is_editable !== false
  const [showAddendum, setShowAddendum] = useState(false)
  const [addendumText, setAddendumText] = useState('')
  const [addendumSaving, setAddendumSaving] = useState(false)
  const [addendumMsg, setAddendumMsg] = useState('')

  const filledFields = SOAP_LABELS.filter(f => {
    const val = note[f.key]
    return typeof val === 'string' && val.trim()
  })

  async function handleSave() {
    setSaving(true)
    setSaveMsg('')
    try {
      await clinicalNotesAPI.update(note.id, form)
      setSaveMsg('✓ Guardado')
      setEditing(false)
      onChanged()
    } catch (err) {
      setSaveMsg(getErrorMessage(err) || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddendum() {
    if (!addendumText.trim()) return
    setAddendumSaving(true)
    setAddendumMsg('')
    try {
      await clinicalNotesAPI.addAddendum(note.id, addendumText.trim())
      setAddendumText('')
      setShowAddendum(false)
      onChanged()
    } catch (err) {
      setAddendumMsg(getErrorMessage(err) || 'Error al guardar el addendum')
    } finally {
      setAddendumSaving(false)
    }
  }

  return (
    <div className="border border-[#DDE1EE] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-[#EEF3FB] text-[#185FA5] flex items-center justify-center text-sm flex-shrink-0">
          📋
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1A1F2E] truncate">
            {note.patient_name || `Paciente · ${note.patient_id.slice(0, 8).toUpperCase()}`}
          </p>
          <p className="text-xs text-[#6B738A]">
            {fmtFecha(note.created_at)}
            {filledFields.length > 0 && ` · ${filledFields.length} campo${filledFields.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!note.is_visible_to_patient && (
            <span className="text-[10px] bg-[#F5F0FF] text-[#6B3FA0] px-2 py-0.5 rounded-full font-medium">Interna</span>
          )}
          {note.shared_with_professionals && (
            <span className="text-[10px] bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full font-medium">Compartida</span>
          )}
          <span className="text-[#6B738A] text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="bg-[#FAFBFC] border-t border-[#DDE1EE] px-4 py-4 space-y-3">

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[#A0A8BF]">
              Consulta: <span className="font-mono">{note.consultation_id}</span>
            </p>
            {isEditable ? (
              <button
                onClick={() => { setEditing(e => !e); setSaveMsg('') }}
                className="text-xs text-[#185FA5] hover:underline"
              >
                {editing ? 'Cancelar' : 'Editar nota'}
              </button>
            ) : (
              <button
                onClick={() => { setShowAddendum(s => !s); setAddendumMsg('') }}
                className="text-xs text-[#185FA5] hover:underline"
              >
                {showAddendum ? 'Cancelar' : '+ Agregar addendum'}
              </button>
            )}
          </div>

          {!isEditable && !showAddendum && (
            <p className="text-[11px] text-[#A0A8BF] bg-[#F5F6FA] rounded-lg px-3 py-2">
              🔒 Pasaron más de 24h desde que se creó esta nota, así que ya no se puede editar
              directamente. Si necesitas corregir o agregar algo, usa "+ Agregar addendum".
            </p>
          )}

          {showAddendum && (
            <div className="space-y-2 bg-white border border-[#DDE1EE] rounded-lg p-3">
              <label className="text-[11px] text-[#6B738A] block">
                Corrección del {new Date().toLocaleDateString('es-BO')} — no reemplaza la nota original
              </label>
              <textarea
                className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#185FA5] transition-colors resize-none"
                rows={3}
                value={addendumText}
                onChange={e => setAddendumText(e.target.value)}
                placeholder="Ej: Se corrige dosis indicada en el plan, era 500mg y no 50mg."
              />
              {addendumMsg && <p className="text-xs text-[#A32D2D]">{addendumMsg}</p>}
              <button
                onClick={handleAddendum}
                disabled={addendumSaving || !addendumText.trim()}
                className="w-full py-2 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {addendumSaving ? 'Guardando...' : 'Guardar addendum'}
              </button>
            </div>
          )}

          {saveMsg && (
            <p className={`text-xs ${saveMsg.startsWith('✓') ? 'text-[#0F6E56]' : 'text-[#A32D2D]'}`}>
              {saveMsg}
            </p>
          )}

          {editing && isEditable ? (
            /* ── Modo edición ── */
            <div className="space-y-3">
              {SOAP_LABELS.map(f => (
                <div key={f.key}>
                  <label className="text-[11px] text-[#6B738A] mb-1 block">{f.icon} {f.label}</label>
                  <textarea
                    className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#185FA5] transition-colors resize-none"
                    rows={3}
                    value={form[f.key as keyof typeof form] as string}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <label className="flex items-center gap-2 text-xs text-[#6B738A]">
                <input
                  type="checkbox"
                  checked={form.is_visible_to_patient}
                  onChange={e => setForm(p => ({ ...p, is_visible_to_patient: e.target.checked }))}
                />
                Visible para el paciente en su historial
              </label>
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          ) : (
            /* ── Modo lectura ── */
            <>
              {filledFields.length === 0 ? (
                <p className="text-xs text-[#A0A8BF] text-center py-2">
                  Esta nota no tiene contenido. Pulsa "Editar nota" para completarla.
                </p>
              ) : (
                filledFields.map(f => (
                  <div key={f.key} className="bg-white rounded-lg border border-[#DDE1EE] p-3">
                    <p className="text-xs font-semibold text-[#1A1F2E] mb-1">{f.icon} {f.label}</p>
                    <p className="text-xs text-[#3C4257] leading-relaxed whitespace-pre-wrap">
                      {note[f.key] as string}
                    </p>
                  </div>
                ))
              )}

              {note.addenda && note.addenda.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-[#6B738A] uppercase tracking-wide">
                    📝 Addenda ({note.addenda.length})
                  </p>
                  {note.addenda.map(a => (
                    <div key={a.id} className="bg-[#FFFBEB] border border-[#F5E4B0] rounded-lg p-3">
                      <p className="text-[11px] text-[#9A7B1E] mb-1">{fmtFechaHora(a.created_at)}</p>
                      <p className="text-xs text-[#3C4257] leading-relaxed whitespace-pre-wrap">{a.content}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-[#F5F6FA] rounded-lg px-3 py-2 text-[11px] text-[#6B738A]">
                {note.is_visible_to_patient
                  ? '👁 El paciente puede ver esta nota en su historial.'
                  : '🔒 Nota interna — el paciente no la ve.'}
                {note.shared_with_professionals
                  ? ' · 🔓 El paciente la compartió con otros médicos.'
                  : ' · 🔒 No está compartida con otros médicos.'}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Grupo de notas de un mismo paciente ──────────────
function PatientGroup({
  group, onChanged
}: {
  group: { patientId: string; patientName: string; notes: ClinicalNote[] }
  onChanged: () => void
}) {
  const [open, setOpen] = useState(true) // abierto por defecto

  // Ordenar notas del más reciente al más antiguo
  const sorted = [...group.notes].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="border border-[#DDE1EE] rounded-2xl overflow-hidden">
      {/* Cabecera del grupo */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#F5F6FA] hover:bg-[#EEF0F6] transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {group.patientName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1F2E] truncate">{group.patientName}</p>
          <p className="text-xs text-[#6B738A]">
            {group.notes.length} nota{group.notes.length !== 1 ? 's' : ''} clínica{group.notes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="text-[#A0A8BF] text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* Lista de notas del paciente */}
      {open && (
        <div className="divide-y divide-[#DDE1EE]">
          {sorted.map(note => (
            <div key={note.id} className="px-2 py-2">
              <NoteCard note={note} onChanged={onChanged} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Nueva historia clínica (para consultas ya completadas) ──
// El médico crea la historia clínica DURANTE la videollamada en la
// pantalla de video, pero si se le pasó por alto, aquí puede crearla
// después para cualquier consulta completada que aún no tenga una.
function NewNoteForm({
  consultations, onCreated, onCancel,
}: {
  consultations: {
    id: string
    specialty?: string
    created_at: string
    scheduled_at?: string
    patient_first_name?: string
    patient_last_name?: string
  }[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [consultationId, setConsultationId] = useState('')
  const [form, setForm] = useState({
    subjective: '', objective: '', assessment: '', plan: '', is_visible_to_patient: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!consultationId) { setError('Selecciona la consulta'); return }
    if (!form.subjective && !form.objective && !form.assessment && !form.plan) {
      setError('Completa al menos un campo de la historia clínica')
      return
    }
    setSaving(true)
    try {
      await clinicalNotesAPI.create({ consultation_id: consultationId, ...form })
      onCreated()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[#1A1F2E]">Nueva historia clínica</p>
        <button onClick={onCancel} className="text-xs text-[#6B738A] hover:underline">Cancelar</button>
      </div>

      {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

      {consultations.length === 0 ? (
        <p className="text-xs text-[#6B738A]">
          No tienes consultas completadas sin historia clínica pendiente. Todas tus consultas completadas o en curso ya tienen una registrada.
        </p>
      ) : (
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="text-[11px] text-[#6B738A] mb-1 block">Consulta</label>
            <select
              className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#185FA5]"
              value={consultationId}
              onChange={e => setConsultationId(e.target.value)}
              required
            >
              <option value="">Seleccionar consulta sin historia clínica...</option>
              {consultations.map(c => {
                const patientName = [c.patient_first_name, c.patient_last_name].filter(Boolean).join(' ')
                const when = c.scheduled_at || c.created_at
                return (
                  <option key={c.id} value={c.id}>
                    {patientName ? `${patientName} · ` : ''}{c.specialty || 'Consulta general'} · {fmtFechaHora(when)}
                  </option>
                )
              })}
            </select>
          </div>

          {SOAP_LABELS.map(f => (
            <div key={f.key}>
              <label className="text-[11px] text-[#6B738A] mb-1 block">{f.icon} {f.label}</label>
              <textarea
                className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#185FA5] transition-colors resize-none"
                rows={3}
                value={form[f.key as keyof typeof form] as string}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}

          <label className="flex items-center gap-2 text-xs text-[#6B738A]">
            <input
              type="checkbox"
              checked={form.is_visible_to_patient}
              onChange={e => setForm(p => ({ ...p, is_visible_to_patient: e.target.checked }))}
            />
            Visible para el paciente en su historial
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {saving ? 'Guardando...' : 'Crear historia clínica'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function ProfessionalClinicalNotesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'date' | 'patient'>('patient')
  const [showNewNote, setShowNewNote] = useState(false)

  const { data: notes = [], isLoading, error } = useQuery({
    queryKey: ['clinical-notes', 'professional'],
    queryFn: () => clinicalNotesAPI.getMyWrittenNotes().then(r => r.data),
  })

  const { data: consultations = [] } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then(r => r.data),
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['clinical-notes', 'professional'] })
  }

  // Consultas completadas/en curso que todavía no tienen historia clínica
  const consultationsWithoutNote = consultations.filter((c: any) =>
    ['COMPLETED', 'IN_PROGRESS'].includes(c.status) &&
    !notes.some(n => n.consultation_id === c.id)
  )

  // Agrupar por paciente
  type PatientGroup = { patientId: string; patientName: string; notes: ClinicalNote[] }
  const grouped: PatientGroup[] = Object.values(
    notes.reduce((acc: Record<string, PatientGroup>, n) => {
      if (!acc[n.patient_id]) {
        acc[n.patient_id] = {
          patientId: n.patient_id,
          patientName: n.patient_name || `Paciente · ${n.patient_id.slice(0, 8).toUpperCase()}`,
          notes: [],
        }
      }
      acc[n.patient_id].notes.push(n)
      return acc
    }, {})
  ).sort((a, b) => {
    // Ordenar grupos por la nota más reciente de cada paciente
    const latestA = Math.max(...a.notes.map(n => new Date(n.created_at).getTime()))
    const latestB = Math.max(...b.notes.map(n => new Date(n.created_at).getTime()))
    return latestB - latestA
  })

  // Filtrar por búsqueda (por nombre o contenido)
  const filteredGroups = grouped
    .map(g => ({
      ...g,
      notes: g.notes.filter(n => {
        if (!search) return true
        const q = search.toLowerCase()
        return (
          g.patientName.toLowerCase().includes(q) ||
          n.subjective?.toLowerCase().includes(q) ||
          n.objective?.toLowerCase().includes(q) ||
          n.assessment?.toLowerCase().includes(q) ||
          n.plan?.toLowerCase().includes(q)
        )
      }),
    }))
    .filter(g => g.notes.length > 0)

  const totalPatients = filteredGroups.length
  const totalNotes = filteredGroups.reduce((s, g) => s + g.notes.length, 0)

  const flatNotesByDate = filteredGroups
    .flatMap(g => g.notes)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/clinical-notes" role="PROFESSIONAL">
      <div className="max-w-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">Mis notas clínicas</h1>
            <p className="text-xs text-[#6B738A] mt-0.5">
              Puedes consultarlas si un paciente regresa.
            </p>
          </div>
          {!showNewNote && (
            <button
              onClick={() => setShowNewNote(true)}
              className="text-xs font-medium text-white bg-[#185FA5] hover:bg-[#0C447C] px-3 py-2 rounded-lg transition-colors flex-shrink-0"
            >
              + Nueva historia clínica
            </button>
          )}
        </div>

        {showNewNote && (
          <NewNoteForm
            consultations={consultationsWithoutNote}
            onCreated={() => { setShowNewNote(false); refresh() }}
            onCancel={() => setShowNewNote(false)}
          />
        )}

        {/* Buscador */}
        <div className="relative mb-4">
          <input
            type="text"
            placeholder="Buscar por paciente o contenido..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-[#DDE1EE] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#185FA5] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A0A8BF] hover:text-[#6B738A] text-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>

        {error && <div className="mb-4"><Alert type="error" message={getErrorMessage(error)} /></div>}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => <div key={n} className="h-16 bg-[#F5F6FA] rounded-2xl animate-pulse" />)}
          </div>
        ) : totalPatients === 0 && !search ? (
          <div className="card text-center py-14">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm font-semibold text-[#1A1F2E]">Sin notas clínicas aún</p>
            <p className="text-xs text-[#6B738A] mt-1 max-w-xs mx-auto">
              Puedes crear la historia clínica de un paciente durante la videollamada usando el botón 📋,
              o usar "+ Nueva historia clínica" arriba para cualquier consulta ya completada.
            </p>
          </div>
        ) : totalPatients === 0 ? (
          <div className="card text-center py-10">
            <p className="text-sm text-[#6B738A]">No se encontraron notas para "{search}"</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#A0A8BF]">
                {totalPatients} paciente{totalPatients !== 1 ? 's' : ''} · {totalNotes} nota{totalNotes !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-1 bg-[#F5F6FA] rounded-lg p-1">
                <button
                  onClick={() => setViewMode('date')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'date' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  🕐 Por fecha
                </button>
                <button
                  onClick={() => setViewMode('patient')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'patient' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  👤 Por paciente
                </button>
              </div>
            </div>

            {viewMode === 'patient' ? (
              filteredGroups.map(group => (
                <PatientGroup key={group.patientId} group={group} onChanged={refresh} />
              ))
            ) : (
              <div className="space-y-2">
                {flatNotesByDate.map(note => (
                  <NoteCard key={note.id} note={note} onChanged={refresh} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}