'use client'
// src/app/professional/profile/page.tsx — con foto de perfil

import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Alert, SectionTitle } from '@/components/ui'
import { professionalsAPI, getErrorMessage } from '@/lib/api'

const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
const IconCal   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
const IconFile  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconStar  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
const IconUser  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
const IconCamera = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>

const NAV = [
  { label: 'Resumen',        href: '/professional/dashboard',     icon: <IconGrid /> },
  { label: 'Consultas',      href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Horarios',       href: '/professional/schedule',      icon: <IconCal /> },
  { label: 'Recetario',      href: '/professional/prescriptions', icon: <IconFile /> },
  { label: 'Calificaciones', href: '/professional/ratings',       icon: <IconStar /> },
  { label: 'Mi perfil',      href: '/professional/profile',       icon: <IconUser /> },
]

const DOCUMENTS = [
  { type: 'CI_FRONT',           label: 'Cédula de identidad — anverso',          hint: 'Foto clara, todos los datos legibles' },
  { type: 'CI_BACK',            label: 'Cédula de identidad — reverso',          hint: 'Sin reflejos ni bordes cortados' },
  { type: 'PROFESSIONAL_TITLE', label: 'Título en Provisión Nacional',           hint: 'Título universitario habilitante para ejercer' },
  { type: 'ACADEMIC_DIPLOMA',   label: 'Diploma académico universitario',        hint: 'Diploma de la universidad donde culminaste la carrera' },
  { type: 'HEALTH_MINISTRY',    label: 'Registro Ministerio de Salud',           hint: 'Registro en el Ministerio de Salud de Bolivia' },
  { type: 'CMB_MATRICULA',      label: 'Matrícula Colegio Médico Bolivia',       hint: 'CMB vigente, no vencida' },
  { type: 'SELFIE_WITH_CI',     label: 'Selfie sosteniendo tu CI',               hint: 'Tu cara y la CI deben ser legibles' },
]

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'

export default function ProfilePage() {
  const [docStatuses, setDocStatuses] = useState<Record<string, UploadStatus>>({})
  const [docErrors, setDocErrors]     = useState<Record<string, string>>({})
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError]     = useState('')
  const [bio, setBio]     = useState('')
  const [langs, setLangs] = useState('Español')
  const [years, setYears] = useState(0)

  // Foto de perfil
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile]       = useState<File | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoRef = useRef<HTMLInputElement | null>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const uploadMutation = useMutation({
    mutationFn: ({ type, file }: { type: string; file: File }) =>
      professionalsAPI.uploadDocument(type, file),
    onMutate: ({ type }) => {
      setDocStatuses((p) => ({ ...p, [type]: 'uploading' }))
      setDocErrors((p) => ({ ...p, [type]: '' }))
    },
    onSuccess: (_, { type }) => setDocStatuses((p) => ({ ...p, [type]: 'done' })),
    onError: (err, { type }) => {
      setDocStatuses((p) => ({ ...p, [type]: 'error' }))
      setDocErrors((p) => ({ ...p, [type]: getErrorMessage(err) }))
    },
  })

  function handleFileChange(type: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate({ type, file })
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProfileError('Solo se aceptan imágenes JPG o PNG')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError('La foto no puede superar 5MB')
      return
    }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setProfileError('')
  }

  async function saveProfile() {
    setProfileError('')
    // En producción: subir la foto a S3 y actualizar el perfil via API
    setProfileSuccess('Perfil actualizado correctamente')
    setTimeout(() => setProfileSuccess(''), 3000)
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/profile" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Perfil y documentos</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Tu perfil público y estado de verificación</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Perfil público */}
          <div className="card">
            <SectionTitle>Datos del perfil público</SectionTitle>
            {profileSuccess && <div className="mb-3"><Alert type="success" message={profileSuccess} /></div>}
            {profileError   && <div className="mb-3"><Alert type="error"   message={profileError} /></div>}

            {/* Foto de perfil */}
            <div className="flex flex-col items-center mb-4">
              <p className="text-xs font-medium text-[#6B738A] mb-2 self-start">Foto de perfil</p>
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-2 border-[#DDE1EE] overflow-hidden bg-[#F5F6FA] flex items-center justify-center">
                  {photoPreview ? (
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
                  <span className="sr-only">Cambiar foto</span>
                </button>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  ref={photoRef}
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </div>
              {photoPreview && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveProfile}
                    disabled={photoUploading}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    {photoUploading ? 'Subiendo...' : 'Guardar foto'}
                  </button>
                  <button
                    onClick={() => { setPhotoPreview(null); setPhotoFile(null) }}
                    className="btn-secondary text-xs py-1 px-3"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              <p className="text-xs text-[#A0A8BF] mt-1">JPG o PNG · Máximo 5MB</p>
              <p className="text-xs text-[#185FA5] mt-0.5 text-center">
                Una foto profesional aumenta la confianza de los pacientes
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Presentación (visible al paciente)</label>
                <textarea
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none"
                  rows={4}
                  placeholder="Describe tu experiencia, especialidades y estilo de atención..."
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={400}
                />
                <p className="text-xs text-[#A0A8BF] mt-1 text-right">{bio.length}/400</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Idiomas de atención</label>
                <input className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  placeholder="Español, Aymara, Quechua..." value={langs} onChange={(e) => setLangs(e.target.value)} />
                <p className="text-xs text-[#A0A8BF] mt-1">Separa con comas</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Años de experiencia</label>
                <input type="number" min={0} max={50} className="w-24 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  value={years} onChange={(e) => setYears(Number(e.target.value))} />
              </div>

              <button onClick={saveProfile} className="btn-primary text-xs py-1.5 px-3">
                Guardar cambios
              </button>
            </div>
          </div>

          {/* Documentos de verificación */}
          <div className="card">
            <SectionTitle>Documentos de verificación</SectionTitle>
            <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5 mb-3">
              <p className="text-xs text-[#185FA5]">
                La revisión toma entre 24 y 72 horas hábiles. Te avisaremos por SMS cuando tu perfil sea aprobado.
              </p>
            </div>
            <div className="space-y-2.5">
              {DOCUMENTS.map(({ type, label, hint }) => {
                const status = docStatuses[type] || 'idle'
                return (
                  <div key={type} className={`rounded-xl border p-3 transition-colors ${
                    status === 'done'      ? 'bg-[#E1F5EE] border-[#1D9E75]' :
                    status === 'error'     ? 'bg-[#FCEBEB] border-[#F09595]' :
                    status === 'uploading' ? 'bg-[#E6F1FB] border-[#85B7EB]' :
                    'bg-white border-[#DDE1EE]'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{label}</p>
                        <p className="text-xs text-[#6B738A] mt-0.5">{hint}</p>
                        {docErrors[type] && <p className="text-xs text-[#A32D2D] mt-1">{docErrors[type]}</p>}
                      </div>
                      <div className="flex-shrink-0">
                        {status === 'done' ? (
                          <span className="badge-green">✓ Subido</span>
                        ) : status === 'uploading' ? (
                          <div className="w-5 h-5 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow" />
                        ) : (
                          <>
                            <input type="file" accept="image/jpeg,image/png,application/pdf"
                              ref={(el) => { fileRefs.current[type] = el }}
                              onChange={(e) => handleFileChange(type, e)} className="hidden" />
                            <button onClick={() => fileRefs.current[type]?.click()}
                              className="btn-secondary text-xs py-1 px-2.5">
                              {status === 'error' ? 'Reintentar' : 'Subir'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
