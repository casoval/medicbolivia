'use client'
// src/components/professional/PatientRecordSummary.tsx
//
// Contenido reutilizable con el historial clínico de UN paciente, desde el
// punto de vista del profesional logueado:
//   - Mis historias clínicas para ese paciente (todas mis consultas con él)
//   - Mis recetas para ese paciente
//   - Si el paciente está "activo" conmigo (consulta lista/agendada/en curso),
//     también lo que otros médicos compartieron con la plataforma.
//
// Es solo contenido (sin modal ni layout de página) para poder usarse tanto
// dentro de un modal (dashboard) como embebido en una página (Mis pacientes).

import { useQuery } from '@tanstack/react-query'
import { prescriptionsAPI, clinicalNotesAPI, patientsAPI } from '@/lib/api'

function fmtDate(d?: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="mb-1.5 last:mb-0">
      <span className="text-[10px] font-semibold text-[#6B738A] uppercase tracking-wide">{label}: </span>
      <span className="text-xs">{value}</span>
    </div>
  )
}

export function PatientRecordSummary({
  patientId,
  showSharedFromOthers,
}: {
  patientId: string
  showSharedFromOthers: boolean
}) {
  const { data: myRx = [], isLoading: loadingRx } = useQuery({
    queryKey: ['patient-history-rx-mine', patientId],
    queryFn: () => prescriptionsAPI.getMineForPatient(patientId),
  })
  const { data: myNotes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ['patient-history-notes-mine', patientId],
    queryFn: () => clinicalNotesAPI.getMineForPatient(patientId),
  })
  const { data: sharedNotes = [], isLoading: loadingShared } = useQuery({
    queryKey: ['patient-history-notes-shared', patientId],
    queryFn: () => clinicalNotesAPI.getPatientSharedHistory(patientId).then(r => r.data),
    enabled: showSharedFromOthers,
  })
  // Datos médicos que el propio paciente cargó en su perfil (alergias,
  // condiciones crónicas, medicación actual) — el médico debe verlos
  // ADEMÁS de su historia clínica, no en vez de ella.
  const { data: medicalInfo, isLoading: loadingMedicalInfo } = useQuery({
    queryKey: ['patient-medical-info', patientId],
    queryFn: () => patientsAPI.getMedicalInfo(patientId),
  })

  const isLoading = loadingRx || loadingNotes || (showSharedFromOthers && loadingShared) || loadingMedicalInfo
  const nothingAtAll = !isLoading && myRx.length === 0 && myNotes.length === 0 && sharedNotes.length === 0

  return (
    <div>
      {isLoading && <p className="text-sm text-[#6B738A] text-center py-6">Cargando historial...</p>}

      {!isLoading && medicalInfo && (
        medicalInfo.allergies.length > 0 || medicalInfo.chronic_conditions.length > 0 || medicalInfo.current_medications.length > 0
      ) && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
            🩺 Datos médicos del paciente
          </p>
          <div className="space-y-2">
            {medicalInfo.allergies.length > 0 && (
              <div className="bg-[#FCEBEB] rounded-lg p-2.5">
                <p className="text-[11px] font-medium text-[#A32D2D] mb-1">⚠ Alergias</p>
                <div className="flex flex-wrap gap-1">
                  {medicalInfo.allergies.map((a, i) => (
                    <span key={i} className="bg-[#F7C1C1] text-[#A32D2D] text-[11px] px-2 py-0.5 rounded-full">{a}</span>
                  ))}
                </div>
              </div>
            )}
            {medicalInfo.chronic_conditions.length > 0 && (
              <div className="bg-[#FAEEDA] rounded-lg p-2.5">
                <p className="text-[11px] font-medium text-[#854F0B] mb-1">🏥 Condiciones crónicas</p>
                <div className="flex flex-wrap gap-1">
                  {medicalInfo.chronic_conditions.map((c, i) => (
                    <span key={i} className="bg-[#FAD89A] text-[#854F0B] text-[11px] px-2 py-0.5 rounded-full">{c}</span>
                  ))}
                </div>
              </div>
            )}
            {medicalInfo.current_medications.length > 0 && (
              <div className="bg-[#E6F1FB] rounded-lg p-2.5">
                <p className="text-[11px] font-medium text-[#185FA5] mb-1">💊 Medicación actual</p>
                <div className="flex flex-wrap gap-1">
                  {medicalInfo.current_medications.map((m, i) => (
                    <span key={i} className="bg-[#B5D4F4] text-[#0C447C] text-[11px] px-2 py-0.5 rounded-full">{m}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {nothingAtAll && (
        <div className="text-center py-6">
          <p className="text-3xl mb-2">🗂️</p>
          <p className="text-sm text-[#6B738A]">Todavía no hay recetas ni historias clínicas de este paciente.</p>
        </div>
      )}

      {myNotes.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
            📋 Mis historias clínicas ({myNotes.length})
          </p>
          <div className="space-y-2">
            {myNotes.map((note: any) => (
              <div key={note.id} className="border border-[#DDE1EE] rounded-xl p-3">
                <p className="text-[11px] text-[#A0A8BF] mb-1.5">{fmtDate(note.created_at)}</p>
                <Field label="Motivo (S)" value={note.subjective} />
                <Field label="Hallazgos (O)" value={note.objective} />
                <Field label="Diagnóstico (A)" value={note.assessment} />
                <Field label="Plan (P)" value={note.plan} />
                {!note.subjective && !note.objective && !note.assessment && !note.plan && (
                  <p className="text-xs text-[#A0A8BF]">Sin detalle registrado.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {myRx.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
            💊 Mis recetas ({myRx.length})
          </p>
          <div className="space-y-2">
            {myRx.map((rx: any) => (
              <div key={rx.id} className="border border-[#DDE1EE] rounded-xl p-3">
                <p className="text-[11px] text-[#A0A8BF] mb-1.5">
                  {fmtDate(rx.signed_at)}{rx.status === 'VOIDED' ? ' · Anulada' : ''}
                </p>
                <div className="space-y-1">
                  {rx.medications?.map((m: any, i: number) => (
                    <p key={i} className="text-xs">
                      • {m.name}{m.dosage ? ` — ${m.dosage}` : ''}{m.frequency ? ` · ${m.frequency}` : ''}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSharedFromOthers && sharedNotes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#185FA5] uppercase tracking-wide mb-1">
            🔗 Compartido por otros médicos ({sharedNotes.length})
          </p>
          <p className="text-[11px] text-[#6B738A] mb-2">
            El paciente autorizó compartir estas notas con médicos de la plataforma.
          </p>
          <div className="space-y-2">
            {sharedNotes.map((note: any) => (
              <div key={note.id} className="border border-[#BFDBFE] bg-[#F0F7FF] rounded-xl p-3">
                <p className="text-[11px] text-[#185FA5] font-medium mb-1">
                  {note.professional_name || 'Médico'}{note.professional_specialty ? ` · ${note.professional_specialty}` : ''}
                </p>
                <p className="text-[11px] text-[#A0A8BF] mb-1.5">{fmtDate(note.created_at)}</p>
                <Field label="Motivo (S)" value={note.subjective} />
                <Field label="Hallazgos (O)" value={note.objective} />
                <Field label="Diagnóstico (A)" value={note.assessment} />
                <Field label="Plan (P)" value={note.plan} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}