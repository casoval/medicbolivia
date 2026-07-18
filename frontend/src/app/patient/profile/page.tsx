'use client'
// src/app/patient/profile/page.tsx
// Perfil del paciente: foto, datos de registro (solo lectura) y, más abajo,
// sus datos médicos editables (alergias, condiciones crónicas, medicación
// actual) — los mismos que el admin y sus profesionales ven en la ficha.
// Antes esta página se llamaba "Datos médicos" (ruta /patient/medical-profile)
// y solo mostraba esa última sección; ahora es "Perfil" y agrupa todo.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, Alert, SectionTitle } from '@/components/ui'
import { patientsAPI, getErrorMessage } from '@/lib/api'
import { NotificationsBell } from '@/components/shared/NotificationsBell'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const IconCamera = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>

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
  const { t } = useLanguage()
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
        <p className="text-xs text-[#6B738A] mb-3">{t('Todavía no registraste nada acá.')}</p>
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
          {t('Agregar')}
        </button>
      </div>
    </div>
  )
}

export default function PatientProfilePage() {
  const { t } = useLanguage()
  const qc = useQueryClient()

  // Datos médicos (editable)
  const [allergies, setAllergies] = useState<string[]>([])
  const [chronicConditions, setChronicConditions] = useState<string[]>([])
  const [medications, setMedications] = useState<string[]>([])
  const [medicalSuccess, setMedicalSuccess] = useState('')
  const [medicalError, setMedicalError] = useState('')
  const [dirty, setDirty] = useState(false)

  // Foto de perfil
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoSuccess, setPhotoSuccess] = useState('')
  const photoRef = useRef<HTMLInputElement | null>(null)

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
      if (profile.photo_url) setPhotoPreview(profile.photo_url)
    }
  }, [profile])

  const saveMutation = useMutation({
    mutationFn: () => patientsAPI.updateMyProfile({
      allergies,
      chronic_conditions: chronicConditions,
      current_medications: medications,
    }),
    onSuccess: () => {
      setMedicalSuccess('Tus datos médicos se guardaron correctamente')
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['patient', 'me'] })
      setTimeout(() => setMedicalSuccess(''), 3000)
    },
    onError: (err) => setMedicalError(getErrorMessage(err)),
  })

  function update(setter: (v: string[]) => void) {
    return (v: string[]) => { setter(v); setDirty(true) }
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) {
      setPhotoError('Solo se aceptan imágenes JPG, PNG o WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('La foto no puede superar 5MB')
      return
    }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setPhotoError('')
  }

  async function savePhoto() {
    if (!photoFile) return
    setPhotoUploading(true)
    setPhotoError('')
    try {
      await patientsAPI.uploadPhoto(photoFile)
      setPhotoSuccess('Foto de perfil actualizada correctamente')
      setPhotoFile(null)
      qc.invalidateQueries({ queryKey: ['patient', 'me'] })
      setTimeout(() => setPhotoSuccess(''), 3000)
    } catch (err) {
      setPhotoError(getErrorMessage(err))
    } finally {
      setPhotoUploading(false)
    }
  }

  function cancelPhoto() {
    setPhotoPreview(profile?.photo_url || null)
    setPhotoFile(null)
    setPhotoError('')
  }

  if (isLoading) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/patient/profile" role="PATIENT">
        <LoadingScreen text="Cargando tu perfil..." />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/profile" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[#141820]">{t('Perfil')}</h1>
            <p className="text-xs text-[#6B738A] mt-0.5">
              {t('Tus datos personales y tu información médica en un solo lugar.')}
            </p>
          </div>
          <NotificationsBell role="PATIENT" />
        </div>

        {/* Datos personales + foto */}
        <div className="card mb-4">
          <SectionTitle>{t('Mis datos')}</SectionTitle>
          {photoSuccess && <div className="mb-3"><Alert type="success" message={photoSuccess} /></div>}
          {photoError   && <div className="mb-3"><Alert type="error"   message={photoError} /></div>}

          <div className="flex flex-col items-center mb-5">
            <p className="text-xs font-medium text-[#6B738A] mb-2 self-start">{t('Foto de perfil')}</p>
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-2 border-[#DDE1EE] overflow-hidden bg-[#F5F6FA] flex items-center justify-center">
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="Foto de perfil" className="w-full h-full object-cover" />
                ) : (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                )}
              </div>
              <button
                onClick={() => photoRef.current?.click()}
                className="absolute bottom-0 right-0 w-8 h-8 bg-[#185FA5] rounded-full flex items-center justify-center shadow-md hover:bg-[#0C447C] transition-colors"
              >
                <IconCamera />
                <span className="sr-only">{t('Cambiar foto')}</span>
              </button>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                ref={photoRef}
                onChange={handlePhotoChange}
                className="hidden"
              />
            </div>

            {photoFile && (
              <div className="flex gap-2 mt-2">
                <button onClick={savePhoto} disabled={photoUploading} className="btn-primary text-xs py-1 px-3">
                  {photoUploading ? 'Subiendo...' : 'Guardar foto'}
                </button>
                <button onClick={cancelPhoto} disabled={photoUploading} className="btn-secondary text-xs py-1 px-3">
                  {t('Cancelar')}
                </button>
              </div>
            )}
            <p className="text-xs text-[#A0A8BF] mt-1">{t('JPG, PNG o WebP · Máximo 5MB')}</p>
            <p className="text-xs text-[#A0A8BF] text-center">{t('Es opcional, pero ayuda a tus profesionales a identificarte mejor')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Nombre completo')}</p>
              <p className="text-sm">{profile?.first_name} {profile?.last_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Cédula de identidad')}</p>
              <p className="text-sm">{profile?.ci || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Fecha de nacimiento')}</p>
              <p className="text-sm">
                {profile?.birth_date ? new Date(profile.birth_date).toLocaleDateString('es-BO') : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Departamento')}</p>
              <p className="text-sm">{profile?.department || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Género')}</p>
              <p className="text-sm">{profile?.gender || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Correo electrónico')}</p>
              <p className="text-sm">{profile?.email || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-[#6B738A]">{t('Celular')}</p>
              <p className="text-sm">{profile?.phone || '—'}</p>
            </div>
          </div>
          <p className="text-xs text-[#A0A8BF] mt-3">
            {t('Para corregir tu CI, fecha de nacimiento u otro dato de registro, escribe a soporte.')}
          </p>
        </div>

        {/* Datos médicos */}
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[#141820]">{t('Mis datos médicos')}</h2>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Esta información la ven los profesionales que te atienden antes y durante la consulta —
            mantenerla al día ayuda a que la atención sea más segura.
          </p>
        </div>

        {medicalSuccess && <div className="mb-4"><Alert type="success" message={medicalSuccess} /></div>}
        {medicalError   && <div className="mb-4"><Alert type="error"   message={medicalError} /></div>}

        <div className="space-y-3">
          <TagListEditor
            title="Alergias"
            emoji="⚠"
            colorClasses={{ bg: 'bg-[#FCEBEB]', text: 'text-[#A32D2D]', chipBg: 'bg-[#F7C1C1]', chipText: 'text-[#A32D2D]' }}
            placeholder={t('Ej: Penicilina, mariscos...')}
            items={allergies}
            onChange={update(setAllergies)}
          />

          <TagListEditor
            title="Condiciones crónicas"
            emoji="🏥"
            colorClasses={{ bg: 'bg-[#FAEEDA]', text: 'text-[#854F0B]', chipBg: 'bg-[#FAD89A]', chipText: 'text-[#854F0B]' }}
            placeholder={t('Ej: Diabetes, hipertensión...')}
            items={chronicConditions}
            onChange={update(setChronicConditions)}
          />

          <TagListEditor
            title="Medicación actual"
            emoji="💊"
            colorClasses={{ bg: 'bg-[#E6F1FB]', text: 'text-[#185FA5]', chipBg: 'bg-[#B5D4F4]', chipText: 'text-[#0C447C]' }}
            placeholder={t('Ej: Losartán 50mg cada 24h...')}
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
