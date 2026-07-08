'use client'
// src/app/patient/medical-profile/page.tsx
// Acá el paciente llena alergias, condiciones crónicas y medicación
// actual — los mismos datos que el admin ve (de solo lectura) en su
// panel de "Historial médico" al revisar la ficha de un paciente.

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, Alert } from '@/components/ui'
import { patientsAPI, getErrorMessage } from '@/lib/api'

// ── Editor de lista tipo "chips": alergias, condiciones, medicación ──
function TagListEditor({
  title, emoji, colorClasses, placeholder, items, onChange,
}: {
  title: string
  emoji: string
  colorClasses: { bg: string; text: string; chipBg: string; chipText: string }
  placeholder: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const value = draft.trim()
    if (!value) return
    if (items.some((i) => i.toLowerCase() === value.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...items, value])
    setDraft('')
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  return (
    <div className={`rounded-xl p-4 ${colorClasses.bg}`}>
      <p className={`text-sm font-medium mb-2 ${colorClasses.text}`}>{emoji} {title}</p>

      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {items.map((item, i) => (
            <span key={i} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${colorClasses.chipBg} ${colorClasses.chipText}`}>
              {item}
              <button
                type="button"
                onClick={() => remove(i)}
                className="hover:opacity-60 transition-opacity"
                aria-label={`Quitar ${item}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#6B738A] mb-3">Todavía no registraste nada acá.</p>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm bg-white focus:outline-none focus:border-[#185FA5]"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-[#185FA5] text-white hover:bg-[#0C447C] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Agregar
        </button>
      </div>
    </div>
  )
}

export default function MedicalProfilePage() {
  const qc = useQueryClient()
  const [allergies, setAllergies] = useState<string[]>([])
  const [chronicConditions, setChronicConditions] = useState<string[]>([])
  const [medications, setMedications] = useState<string[]>([])
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  const { data: profile, isLoading } = useQuery({
    queryKey: ['patient', 'me'],
    queryFn: () => patientsAPI.getMyProfile(),
  })

  useEffect(() => {
    if (profile) {
      setAllergies(profile.allergies || [])
      setChronicConditions(profile.chronic_conditions || [])
      setMedications(profile.current_medications || [])
      setDirty(false)
    }
  }, [profile])

  const saveMutation = useMutation({
    mutationFn: () => patientsAPI.updateMyProfile({
      allergies,
      chronic_conditions: chronicConditions,
      current_medications: medications,
    }),
    onSuccess: () => {
      setSuccess('Tus datos médicos se guardaron correctamente')
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['patient', 'me'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  function update(setter: (v: string[]) => void) {
    return (v: string[]) => { setter(v); setDirty(true) }
  }

  if (isLoading) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/patient/medical-profile" role="PATIENT">
        <LoadingScreen text="Cargando tus datos..." />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/medical-profile" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-[#141820]">Mis datos médicos</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Esta información la ven los profesionales que te atienden antes y durante la consulta —
            mantenerla al día ayuda a que la atención sea más segura.
          </p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        <div className="space-y-3">
          <TagListEditor
            title="Alergias"
            emoji="⚠"
            colorClasses={{ bg: 'bg-[#FCEBEB]', text: 'text-[#A32D2D]', chipBg: 'bg-[#F7C1C1]', chipText: 'text-[#A32D2D]' }}
            placeholder="Ej: Penicilina, mariscos..."
            items={allergies}
            onChange={update(setAllergies)}
          />

          <TagListEditor
            title="Condiciones crónicas"
            emoji="🏥"
            colorClasses={{ bg: 'bg-[#FAEEDA]', text: 'text-[#854F0B]', chipBg: 'bg-[#FAD89A]', chipText: 'text-[#854F0B]' }}
            placeholder="Ej: Diabetes, hipertensión..."
            items={chronicConditions}
            onChange={update(setChronicConditions)}
          />

          <TagListEditor
            title="Medicación actual"
            emoji="💊"
            colorClasses={{ bg: 'bg-[#E6F1FB]', text: 'text-[#185FA5]', chipBg: 'bg-[#B5D4F4]', chipText: 'text-[#0C447C]' }}
            placeholder="Ej: Losartán 50mg cada 24h..."
            items={medications}
            onChange={update(setMedications)}
          />
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
            className="px-5 py-2.5 rounded-lg text-sm font-medium bg-[#185FA5] text-white hover:bg-[#0C447C] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </DashboardLayout>
  )
}
