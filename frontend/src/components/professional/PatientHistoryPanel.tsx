'use client'
// src/components/professional/PatientHistoryPanel.tsx
//
// Panel que el profesional ve al revisar una consulta entrante o activa.
// Muestra:
//  1. Las notas que ÉL MISMO escribió para ese paciente en consultas anteriores
//  2. Las notas de OTROS médicos que el paciente decidió compartir con la plataforma

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clinicalNotesAPI, getErrorMessage } from '@/lib/api'
import type { ClinicalNote } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const SOAP_LABELS = [
  { key: 'subjective' as const, label: 'Relato del paciente', icon: '🗣️' },
  { key: 'objective'  as const, label: 'Hallazgos',           icon: '🔍' },
  { key: 'assessment' as const, label: 'Evaluación',          icon: '🩺' },
  { key: 'plan'       as const, label: 'Plan',                icon: '📌' },
]

function fmtFecha(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz'
  })
}

function NotePreview({ note }: { note: ClinicalNote }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  const filled = SOAP_LABELS.filter(f => {
    const v = note[f.key]
    return typeof v === 'string' && v.trim()
  })

  return (
    <div className="border border-[#DDE1EE] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <span className="text-sm">📋</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[#1A1F2E] truncate">
            {note.professional_name || 'Médico anterior'}
            {note.professional_specialty ? ` · ${note.professional_specialty}` : ''}
          </p>
          <p className="text-[11px] text-[#6B738A]">
            {fmtFecha(note.created_at)}
            {filled.length > 0 && ` · ${filled.length} campo${filled.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <span className="text-[#A0A8BF] text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-[#FAFBFC] border-t border-[#DDE1EE] px-3 py-3 space-y-2">
          {filled.length === 0 ? (
            <p className="text-[11px] text-[#A0A8BF]">{t('Sin contenido registrado.')}</p>
          ) : (
            filled.map(f => (
              <div key={f.key}>
                <p className="text-[10px] font-semibold text-[#6B738A] mb-0.5">{f.icon} {f.label}</p>
                <p className="text-xs text-[#3C4257] leading-relaxed whitespace-pre-wrap">{note[f.key] as string}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  patientId: string
  patientName?: string | null
  currentConsultationId?: string  // para excluir la nota de la consulta actual si ya existe
}

export function PatientHistoryPanel({ patientId, patientName, currentConsultationId }: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  // Notas que este profesional escribió para este paciente (todas sus consultas previas)
  const { data: myNotes = [], isLoading: loadingMy } = useQuery({
    queryKey: ['clinical-notes', 'professional'],
    queryFn: () => clinicalNotesAPI.getMyWrittenNotes().then(r => r.data),
    enabled: open,
  })

  // Notas de otros médicos que el paciente compartió con la plataforma
  const { data: sharedNotes = [], isLoading: loadingShared, error: errorShared } = useQuery({
    queryKey: ['clinical-notes', 'shared', patientId],
    queryFn: () => clinicalNotesAPI.getPatientSharedHistory(patientId).then(r => r.data),
    enabled: open,
  })

  // Filtrar notas propias de consultas anteriores (excluir la consulta actual)
  const ownPrior = myNotes.filter(
    n => n.patient_id === patientId && n.consultation_id !== currentConsultationId
  )

  // De las compartidas, excluir las que ya son propias (para no duplicar)
  const ownProfessionalIds = new Set(myNotes.map(n => n.professional_id))
  const otherShared = sharedNotes.filter(n => !ownProfessionalIds.has(n.professional_id))

  const totalNotes = ownPrior.length + otherShared.length
  const isLoading = loadingMy || loadingShared

  return (
    <div className="mt-2 ml-12">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-[#185FA5] hover:underline"
      >
        <span>📂</span>
        <span>
          Historial clínico de {patientName || 'este paciente'}
          {!open && totalNotes > 0 && ` · ${totalNotes} nota${totalNotes > 1 ? 's' : ''}`}
          {!open && totalNotes === 0 && !isLoading && open && ' · sin historial'}
        </span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 max-h-64 overflow-y-auto pr-1">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2].map(n => <div key={n} className="h-10 bg-[#F5F6FA] rounded-lg animate-pulse" />)}
            </div>
          )}

          {!isLoading && ownPrior.length === 0 && otherShared.length === 0 && (
            <p className="text-[11px] text-[#A0A8BF] py-2">
              {t('No hay historial clínico previo disponible para este paciente.')}
            </p>
          )}

          {ownPrior.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] mb-1.5 uppercase tracking-wide">
                {t('Mis notas anteriores')}
              </p>
              <div className="space-y-1.5">
                {ownPrior.map(n => <NotePreview key={n.id} note={n} />)}
              </div>
            </div>
          )}

          {otherShared.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#6B738A] mb-1.5 uppercase tracking-wide">
                {t('De otros médicos (compartido por el paciente)')}
              </p>
              <div className="space-y-1.5">
                {otherShared.map(n => <NotePreview key={n.id} note={n} />)}
              </div>
            </div>
          )}

          {errorShared && (
            <p className="text-[11px] text-[#A32D2D]">{getErrorMessage(errorShared)}</p>
          )}
        </div>
      )}
    </div>
  )
}