'use client'
// src/components/patient/ProfessionalRecordSummary.tsx
//
// Contenido reutilizable con MI historial (recetas + historias clínicas)
// correspondiente a UN profesional en particular. Es solo presentación:
// recibe ya filtrados los datos (el paciente ya tiene endpoints que
// devuelven TODO su historial — prescriptionsAPI.getMyPatient() y
// clinicalNotesAPI.getMyHistory() — así que agrupar por profesional se
// hace en el cliente, sin necesidad de endpoints nuevos en el backend).

import type { Prescription } from '@/types'
import type { ClinicalNote } from '@/lib/api'

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

// Correcciones/agregados posteriores a la nota original (fuera de la
// ventana de edición de 24h). Solo lectura: nunca reemplazan lo original.
function Addenda({ addenda }: { addenda?: ClinicalNote['addenda'] }) {
  if (!addenda || addenda.length === 0) return null
  return (
    <div className="mt-2 space-y-1.5">
      {addenda.map(a => (
        <div key={a.id} className="bg-[#FFFBEB] border border-[#F5E4B0] rounded-lg p-2">
          <p className="text-[10px] text-[#9A7B1E] mb-1">📝 Addendum · {fmtDate(a.created_at)}</p>
          <p className="text-xs text-[#3C4257] leading-relaxed whitespace-pre-wrap">{a.content}</p>
        </div>
      ))}
    </div>
  )
}

export function ProfessionalRecordSummary({
  prescriptions,
  notes,
}: {
  prescriptions: Prescription[]
  notes: ClinicalNote[]
}) {
  const nothingAtAll = prescriptions.length === 0 && notes.length === 0

  if (nothingAtAll) {
    return (
      <div className="text-center py-6">
        <p className="text-3xl mb-2">🗂️</p>
        <p className="text-sm text-[#6B738A]">Todavía no hay recetas ni historias clínicas con este profesional.</p>
      </div>
    )
  }

  return (
    <div>
      {notes.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
            📋 Mi historia clínica ({notes.length})
          </p>
          <div className="space-y-2">
            {notes.map((note: any) => (
              <div key={note.id} className="border border-[#DDE1EE] rounded-xl p-3">
                <p className="text-[11px] text-[#A0A8BF] mb-1.5">{fmtDate(note.created_at)}</p>
                <Field label="Motivo (S)" value={note.subjective} />
                <Field label="Hallazgos (O)" value={note.objective} />
                <Field label="Diagnóstico (A)" value={note.assessment} />
                <Field label="Plan (P)" value={note.plan} />
                {!note.subjective && !note.objective && !note.assessment && !note.plan && (
                  <p className="text-xs text-[#A0A8BF]">El médico aún no completó el detalle.</p>
                )}
                {note.shared_with_professionals && (
                  <p className="text-[10px] text-[#185FA5] mt-1.5">🔗 Compartida con otros médicos de la plataforma</p>
                )}
                <Addenda addenda={note.addenda} />
              </div>
            ))}
          </div>
        </div>
      )}

      {prescriptions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">
            💊 Mis recetas ({prescriptions.length})
          </p>
          <div className="space-y-2">
            {prescriptions.map((rx: any) => (
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
    </div>
  )
}