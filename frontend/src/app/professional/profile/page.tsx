'use client'
// src/app/professional/profile/page.tsx

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { Alert, SectionTitle } from '@/components/ui'
import { professionalsAPI, api, getErrorMessage } from '@/lib/api'

const IconCamera = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
const IconRefresh = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>

const DOCUMENTS = [
  { type: 'CI_FRONT',           label: 'Cédula de identidad — anverso',    hint: 'Foto clara, todos los datos legibles' },
  { type: 'CI_BACK',            label: 'Cédula de identidad — reverso',    hint: 'Sin reflejos ni bordes cortados' },
  { type: 'PROFESSIONAL_TITLE', label: 'Título en Provisión Nacional',     hint: 'Título universitario habilitante para ejercer' },
  { type: 'ACADEMIC_DIPLOMA',   label: 'Diploma académico universitario',  hint: 'Diploma de la universidad donde culminaste la carrera' },
  { type: 'HEALTH_MINISTRY',    label: 'Registro Ministerio de Salud',     hint: 'Registro en el Ministerio de Salud de Bolivia' },
  { type: 'CMB_MATRICULA',      label: 'Matrícula Colegio Médico Bolivia', hint: 'CMB vigente, no vencida' },
  { type: 'SPECIALTY_CERT',     label: 'Respaldo de Especialidad y/o Subespecialidad', hint: 'Certificado, diploma o título que respalde tu especialidad o subespecialidad' },
  { type: 'SELFIE_WITH_CI',     label: 'Selfie sosteniendo tu CI',         hint: 'Tu cara y la CI deben ser legibles' },
]

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'

interface DocRecord {
  id: string
  doc_type: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  url?: string | null
  review_note?: string | null
  reviewed_at?: string | null
  created_at: string
}

interface NotificationItem {
  id: string
  title: string
  body: string
  type: string
  read: boolean
  created_at: string
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().split('?')[0].endsWith('.pdf')
}

function MyDocViewerModal({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  const pdf = isPdfUrl(url)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#DDE1EE]">
          <p className="text-sm font-semibold">{label}</p>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-auto bg-[#F5F6FA] flex items-center justify-center p-4">
          {pdf ? (
            <iframe src={url} className="w-full h-[60vh] rounded-lg bg-white" title={label} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={label} className="max-w-full max-h-[60vh] object-contain rounded-lg" />
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const [docStatuses, setDocStatuses] = useState<Record<string, UploadStatus>>({})
  const [docErrors, setDocErrors]     = useState<Record<string, string>>({})
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError]     = useState('')
  const [bio, setBio]     = useState('')
  const [langs, setLangs] = useState('Español')
  const [years, setYears] = useState(0)
  const [priceGeneral, setPriceGeneral]     = useState('')
  const [priceUrgent, setPriceUrgent]       = useState('')
  const [priceFollowUp, setPriceFollowUp]   = useState('')
  const [samePriceAll, setSamePriceAll]     = useState(false)
  const [pricesSuccess, setPricesSuccess]   = useState('')
  const [pricesError, setPricesError]       = useState('')
  const [viewingDoc, setViewingDoc] = useState<{ label: string; url: string } | null>(null)
  const [showNotifs, setShowNotifs] = useState(false)

  // % de comisión vigente ahora mismo (individual > promo global > default)
  // y cuánto le llegaría neto por cada tipo de consulta con los precios
  // actuales — para mostrar transparencia total antes de que se cobre nada.
  const [commission, setCommission] = useState<{
    percent: number
    source: 'PROFESSIONAL' | 'GLOBAL_PROMO' | 'DEFAULT'
    label: string | null
    ends_at: string | null
    net_price_general: number | null
    net_price_urgent: number | null
    net_price_follow_up: number | null
  } | null>(null)

  // Datos de registro — solo lectura, para que el profesional recuerde qué colocó
  const [registrationData, setRegistrationData] = useState<{
    first_name?: string; last_name?: string; ci?: string; birth_date?: string
    department?: string; gender?: string; specialty?: string; sub_specialties?: string[]
    email?: string; phone?: string; cmb_matricula?: string; sedes_number?: string
  } | null>(null)

  // Estado real de los documentos guardado en el backend (aprobado/rechazado/pendiente)
  const { data: myDocs = [], refetch: refetchDocs } = useQuery({
    queryKey: ['professional', 'me', 'documents'],
    queryFn: () => api.get('/professionals/me/documents').then((r) => r.data as DocRecord[]),
    refetchInterval: 20000, // así se ve "Aprobado"/"Rechazado" solo, sin recargar la página
  })

  // Notificaciones (campanita) — aprobaciones/rechazos del admin
  const { data: notifications = [], refetch: refetchNotifs } = useQuery({
    queryKey: ['professional', 'me', 'notifications'],
    queryFn: () => api.get('/professionals/me/notifications').then((r) => r.data as NotificationItem[]),
    refetchInterval: 20000,
  })
  const unreadCount = notifications.filter((n) => !n.read).length

  // Detalle completo de mi membresía (la habilita/deshabilita un admin
  // manualmente) — estado actual + historial, para tener toda la info a
  // la vista en mi propio perfil.
  const { data: membership } = useQuery({
    queryKey: ['my-membership'],
    queryFn: professionalsAPI.getMyMembership,
    staleTime: 30_000,
  })

  async function markAllNotifsRead() {
    if (unreadCount === 0) return
    try {
      await api.patch('/professionals/me/notifications/read-all')
      refetchNotifs()
    } catch {
      // silencioso — no es crítico si falla el marcado de leído
    }
  }

  function docRecordOf(type: string): DocRecord | undefined {
    return myDocs.find((d) => d.doc_type === type)
  }

  // Foto de perfil
  const [photoPreview, setPhotoPreview]     = useState<string | null>(null)
  const [photoFile, setPhotoFile]           = useState<File | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoRef = useRef<HTMLInputElement | null>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Cargar datos actuales del perfil al entrar a la página
  useEffect(() => {
    professionalsAPI.getMyProfile().then((data: any) => {
      if (data.bio)              setBio(data.bio)
      if (data.languages)        setLangs(data.languages)
      if (data.years_experience) setYears(data.years_experience)
      if (data.photo_url)        setPhotoPreview(data.photo_url)
      if (data.price_general   !== undefined && data.price_general   !== null) setPriceGeneral(String(data.price_general))
      if (data.price_urgent    !== undefined && data.price_urgent    !== null) setPriceUrgent(String(data.price_urgent))
      if (data.price_follow_up !== undefined && data.price_follow_up !== null) setPriceFollowUp(String(data.price_follow_up))
      if (
        data.price_general !== undefined && data.price_general !== null &&
        Number(data.price_general) === Number(data.price_urgent) &&
        Number(data.price_general) === Number(data.price_follow_up)
      ) setSamePriceAll(true)
      if (data.commission) setCommission(data.commission)
      setRegistrationData(data)
    }).catch(() => {/* silencioso — el perfil puede estar vacío */})
  }, [])

  // Mutación para subir (o reemplazar) documentos de verificación
  const uploadDocMutation = useMutation({
    mutationFn: ({ type, file }: { type: string; file: File }) =>
      professionalsAPI.uploadDocument(type, file),
    onMutate: ({ type }) => {
      setDocStatuses((p) => ({ ...p, [type]: 'uploading' }))
      setDocErrors((p)   => ({ ...p, [type]: '' }))
    },
    onSuccess: (_, { type }) => {
      setDocStatuses((p) => ({ ...p, [type]: 'done' }))
      refetchDocs()
    },
    onError: (err, { type }) => {
      setDocStatuses((p) => ({ ...p, [type]: 'error' }))
      setDocErrors((p)   => ({ ...p, [type]: getErrorMessage(err) }))
    },
  })

  function handleFileChange(type: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Resetear el input para que el mismo archivo pueda seleccionarse de nuevo si fuera necesario
    e.target.value = ''
    uploadDocMutation.mutate({ type, file })
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

  async function savePhoto() {
    if (!photoFile) return
    setPhotoUploading(true)
    setProfileError('')
    try {
      await professionalsAPI.uploadPhoto(photoFile)
      setProfileSuccess('Foto de perfil actualizada correctamente')
      setPhotoFile(null)
      setTimeout(() => setProfileSuccess(''), 3000)
    } catch (err) {
      setProfileError(getErrorMessage(err))
    } finally {
      setPhotoUploading(false)
    }
  }

  async function saveProfile() {
    setProfileError('')
    try {
      await professionalsAPI.updateProfile({
        bio,
        languages: langs,
        years_experience: years,
      })
      setProfileSuccess('Perfil actualizado correctamente')
      setTimeout(() => setProfileSuccess(''), 3000)
    } catch (err) {
      setProfileError(getErrorMessage(err))
    }
  }

  // Un precio válido: número entero positivo, mayor que 0 (sin decimales)
  function priceIsValid(value: string): boolean {
    if (value === '') return false
    const n = Number(value)
    return Number.isInteger(n) && n > 0
  }

  // Cuánto le llegaría neto al profesional por un precio dado, usando el %
  // de comisión vigente ahora mismo. Se recalcula en vivo mientras escribe,
  // así ve el efecto de cada cambio de precio antes de guardar.
  function netOfPrice(value: string): string | null {
    if (!commission || !priceIsValid(value)) return null
    const price = Number(value)
    const net = price - (price * commission.percent) / 100
    return net.toFixed(2)
  }

  function handleGeneralPriceChange(value: string) {
    // Solo dígitos, sin decimales ni signos
    const clean = value.replace(/[^\d]/g, '')
    setPriceGeneral(clean)
    if (samePriceAll) {
      setPriceUrgent(clean)
      setPriceFollowUp(clean)
    }
  }

  function handleSamePriceToggle(checked: boolean) {
    setSamePriceAll(checked)
    if (checked) {
      // Al activarlo, igualamos los otros dos al precio general actual
      setPriceUrgent(priceGeneral)
      setPriceFollowUp(priceGeneral)
    }
  }

  async function savePrices() {
    setPricesError('')
    setPricesSuccess('')

    const toCheck = samePriceAll
      ? { 'Precio': priceGeneral }
      : {
          'Consulta agendada': priceGeneral,
          'Consulta inmediata': priceUrgent,
          'Consulta de seguimiento': priceFollowUp,
        }

    for (const [label, value] of Object.entries(toCheck)) {
      if (!priceIsValid(value)) {
        setPricesError(`"${label}" debe ser un número entero mayor a 0 (sin decimales).`)
        return
      }
    }

    try {
      await professionalsAPI.updatePrices({
        price_general: Number(priceGeneral),
        price_urgent: Number(samePriceAll ? priceGeneral : priceUrgent),
        price_follow_up: Number(samePriceAll ? priceGeneral : priceFollowUp),
      })
      setPricesSuccess('Precios actualizados correctamente')
      setTimeout(() => setPricesSuccess(''), 3000)
    } catch (err) {
      setPricesError(getErrorMessage(err))
    }
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/profile" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-base font-semibold">Perfil y documentos</h1>
            <p className="text-xs text-[#6B738A] mt-0.5">Tu perfil público y estado de verificación</p>
          </div>

          <div className="relative">
            <button
              onClick={() => { setShowNotifs((v) => !v); if (!showNotifs) markAllNotifsRead() }}
              className="relative w-9 h-9 rounded-full border border-[#DDE1EE] bg-white flex items-center justify-center hover:bg-[#F5F6FA] transition-colors"
              title="Notificaciones"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#E24B4A] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifs && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
                <div className="absolute right-0 mt-2 w-80 bg-white border border-[#DDE1EE] rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
                <div className="p-3 border-b border-[#DDE1EE]">
                  <p className="text-xs font-semibold">Notificaciones</p>
                </div>
                {notifications.length === 0 ? (
                  <p className="text-xs text-[#6B738A] text-center py-6">No tenés notificaciones todavía</p>
                ) : (
                  <div className="divide-y divide-[#DDE1EE]">
                    {notifications.map((n) => (
                      <div key={n.id} className="p-3">
                        <p className="text-xs font-medium">{n.title}</p>
                        <p className="text-xs text-[#6B738A] mt-0.5">{n.body}</p>
                        <p className="text-[10px] text-[#A0A8BF] mt-1">
                          {new Date(n.created_at).toLocaleString('es-BO')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Datos de registro — solo lectura, así el profesional recuerda qué colocó */}
          {registrationData && (
            <div className="card lg:col-span-2">
              <SectionTitle>Datos de registro</SectionTitle>
              <p className="text-xs text-[#6B738A] mb-3">
                Esta es la información que colocaste al registrarte. Para corregir tu CI, fecha de
                nacimiento, departamento o contacto, escribe a soporte.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Nombre completo</p>
                  <p className="text-sm">{registrationData.first_name} {registrationData.last_name}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Cédula de identidad</p>
                  <p className="text-sm">{registrationData.ci || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Fecha de nacimiento</p>
                  <p className="text-sm">
                    {registrationData.birth_date
                      ? new Date(registrationData.birth_date).toLocaleDateString('es-BO')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Departamento</p>
                  <p className="text-sm">{registrationData.department || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Género</p>
                  <p className="text-sm">{registrationData.gender || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Especialidad</p>
                  <p className="text-sm">{registrationData.specialty || '—'}</p>
                </div>
                <div className="sm:col-span-2 md:col-span-1">
                  <p className="text-xs font-medium text-[#6B738A]">Subespecialidades</p>
                  <p className="text-sm">
                    {registrationData.sub_specialties && registrationData.sub_specialties.length > 0
                      ? registrationData.sub_specialties.join(', ')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Correo electrónico</p>
                  <p className="text-sm">{registrationData.email || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#6B738A]">Celular</p>
                  <p className="text-sm">{registrationData.phone || '—'}</p>
                </div>
                {registrationData.cmb_matricula && (
                  <div>
                    <p className="text-xs font-medium text-[#6B738A]">Matrícula CMB</p>
                    <p className="text-sm">{registrationData.cmb_matricula}</p>
                  </div>
                )}
                {registrationData.sedes_number && (
                  <div>
                    <p className="text-xs font-medium text-[#6B738A]">N° SEDES</p>
                    <p className="text-sm">{registrationData.sedes_number}</p>
                  </div>
                )}
              </div>
            </div>
          )}

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

              {/* Botones confirmar / cancelar — solo cuando hay foto NUEVA pendiente */}
              {photoFile && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={savePhoto}
                    disabled={photoUploading}
                    className="btn-primary text-xs py-1 px-3"
                  >
                    {photoUploading ? 'Subiendo...' : 'Guardar foto'}
                  </button>
                  <button
                    onClick={() => { setPhotoPreview(null); setPhotoFile(null) }}
                    disabled={photoUploading}
                    className="btn-secondary text-xs py-1 px-3"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              <p className="text-xs text-[#A0A8BF] mt-1">JPG, PNG o WebP · Máximo 5MB</p>
              <p className="text-xs text-[#185FA5] mt-0.5 text-center">
                Una foto profesional aumenta la confianza de los pacientes
              </p>
            </div>

            {/* Datos del perfil */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">
                  Presentación (visible al paciente)
                </label>
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
                <input
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  placeholder="Español, Aymara, Quechua..."
                  value={langs}
                  onChange={(e) => setLangs(e.target.value)}
                />
                <p className="text-xs text-[#A0A8BF] mt-1">Separa con comas</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Años de experiencia</label>
                <input
                  type="number" min={0} max={50}
                  className="w-24 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value))}
                />
              </div>

              <button onClick={saveProfile} className="btn-primary text-xs py-1.5 px-3">
                Guardar cambios
              </button>
            </div>
          </div>

          {/* Precios de consulta */}
          <div className="card">
            <SectionTitle>Precios de consulta</SectionTitle>
            <p className="text-xs text-[#6B738A] mb-3">
              Define cuánto cobras según el tipo de consulta. El paciente ve el precio correspondiente antes de confirmar.
            </p>

            {pricesError   && <div className="mb-3"><Alert type="error"   message={pricesError} /></div>}
            {pricesSuccess && <div className="mb-3"><Alert type="success" message={pricesSuccess} /></div>}

            {commission && (
              <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5 mb-4">
                <p className="text-xs text-[#185FA5]">
                  Comisión de la plataforma: <span className="font-semibold">{commission.percent}%</span>
                  {' '}— recibes el <span className="font-semibold">{(100 - commission.percent).toFixed(2)}%</span> de cada consulta.
                  {commission.source === 'PROFESSIONAL' && (
                    <> Tarifa promocional exclusiva para ti{commission.label ? ` (${commission.label})` : ''}.</>
                  )}
                  {commission.source === 'GLOBAL_PROMO' && (
                    <> Promoción activa en toda la plataforma{commission.label ? ` (${commission.label})` : ''}.</>
                  )}
                  {commission.ends_at && (
                    <> Vigente hasta el {new Date(commission.ends_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })}.</>
                  )}
                </p>
              </div>
            )}

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={samePriceAll}
                onChange={(e) => handleSamePriceToggle(e.target.checked)}
                className="w-4 h-4 accent-[#185FA5]"
              />
              <span className="text-xs text-[#3C4257]">Cobrar el mismo precio para las 3 consultas</span>
            </label>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">
                  {samePriceAll ? 'Precio único (Bs.)' : 'Consulta agendada (Bs.)'}
                </label>
                <input
                  type="text" inputMode="numeric"
                  className="w-32 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  placeholder="150"
                  value={priceGeneral}
                  onChange={(e) => handleGeneralPriceChange(e.target.value)}
                />
                {netOfPrice(priceGeneral) && (
                  <p className="text-xs text-[#0F6E56] mt-1 font-medium">Recibes Bs. {netOfPrice(priceGeneral)}</p>
                )}
                {!samePriceAll && (
                  <p className="text-xs text-[#A0A8BF] mt-1">El paciente agenda una cita para más adelante</p>
                )}
              </div>

              {!samePriceAll && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#6B738A] mb-1">
                      Consulta inmediata (Bs.)
                    </label>
                    <input
                      type="text" inputMode="numeric"
                      className="w-32 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                      placeholder="200"
                      value={priceUrgent}
                      onChange={(e) => setPriceUrgent(e.target.value.replace(/[^\d]/g, ''))}
                    />
                    {netOfPrice(priceUrgent) && (
                      <p className="text-xs text-[#0F6E56] mt-1 font-medium">Recibes Bs. {netOfPrice(priceUrgent)}</p>
                    )}
                    <p className="text-xs text-[#A0A8BF] mt-1">El paciente entra ahora mismo, sin cita previa</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#6B738A] mb-1">
                      Consulta de seguimiento (Bs.)
                    </label>
                    <input
                      type="text" inputMode="numeric"
                      className="w-32 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                      placeholder="100"
                      value={priceFollowUp}
                      onChange={(e) => setPriceFollowUp(e.target.value.replace(/[^\d]/g, ''))}
                    />
                    {netOfPrice(priceFollowUp) && (
                      <p className="text-xs text-[#0F6E56] mt-1 font-medium">Recibes Bs. {netOfPrice(priceFollowUp)}</p>
                    )}
                    <p className="text-xs text-[#A0A8BF] mt-1">
                      Solo la ven pacientes que ya tuvieron una consulta completada contigo, y también se agenda con fecha y hora
                    </p>
                  </div>
                </>
              )}

              <button onClick={savePrices} className="btn-primary text-xs py-1.5 px-3">
                Guardar precios
              </button>
            </div>
          </div>

          {/* Membresía */}
          <div className="card">
            <SectionTitle>Membresía</SectionTitle>
            <p className="text-xs text-[#6B738A] mb-3">
              La habilita o deshabilita el administrador manualmente. Con membresía activa no pagas comisión por tus consultas y puedes agendar directamente a los pacientes de "Mis pacientes", sin límite de horario.
            </p>

            {membership?.active && membership.current ? (
              <div className="bg-[#E1F5EE] rounded-lg px-3 py-2.5 mb-3">
                <p className="text-xs text-[#0F6E56] font-semibold mb-1">🟢 Membresía activa</p>
                <p className="text-xs text-[#0F6E56]">
                  {membership.current.period_label && <>Periodo: <span className="font-medium">{membership.current.period_label}</span>. </>}
                  Desde el {membership.current.starts_at ? new Date(membership.current.starts_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  {membership.current.ends_at
                    ? <> hasta el {new Date(membership.current.ends_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })}.</>
                    : <>, sin fecha de fin definida (vigente hasta que el administrador la cierre).</>}
                </p>
                {membership.current.note && (
                  <p className="text-xs text-[#0F6E56] mt-1">Nota del administrador: {membership.current.note}</p>
                )}
              </div>
            ) : (
              <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5 mb-3">
                <p className="text-xs text-[#185FA5]">
                  No tienes una membresía activa. Contacta al administrador para habilitarla — mientras tanto, operas con la comisión normal por consulta y sin agendamiento directo a "Mis pacientes".
                </p>
              </div>
            )}

            {membership && membership.history.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Historial</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {membership.history.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 bg-white border border-[#DDE1EE] rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {m.period_label || 'Sin etiqueta'}
                        </p>
                        <p className="text-[11px] text-[#6B738A]">
                          {m.starts_at ? new Date(m.starts_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                          {' → '}
                          {m.ends_at ? new Date(m.ends_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'sin fin'}
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${m.is_current ? 'bg-[#E1F5EE] text-[#0F6E56]' : m.active ? 'bg-[#F5F6FA] text-[#6B738A]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
                        {m.is_current ? 'Vigente' : m.active ? 'Habilitada' : 'Deshabilitada'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                const localStatus = docStatuses[type] || 'idle'
                const record = docRecordOf(type)
                // El estado local de "subiendo ahora mismo" siempre gana visualmente.
                // Si no se está subiendo nada, se muestra el estado real guardado en el backend.
                const serverStatus = record?.status // 'PENDING' | 'APPROVED' | 'REJECTED' | undefined
                const isUploading = localStatus === 'uploading'
                const isLocalError = localStatus === 'error'

                return (
                  <div key={type} className={`rounded-xl border p-3 transition-colors ${
                    isLocalError                    ? 'bg-[#FCEBEB] border-[#F09595]' :
                    isUploading                     ? 'bg-[#E6F1FB] border-[#85B7EB]' :
                    serverStatus === 'APPROVED'      ? 'bg-[#E1F5EE] border-[#1D9E75]' :
                    serverStatus === 'REJECTED'      ? 'bg-[#FCEBEB] border-[#F09595]' :
                    serverStatus === 'PENDING'       ? 'bg-[#FEF3E0] border-[#F2D49A]' :
                    'bg-white border-[#DDE1EE]'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{label}</p>
                        <p className="text-xs text-[#6B738A] mt-0.5">{hint}</p>
                        {docErrors[type] && (
                          <p className="text-xs text-[#A32D2D] mt-1">{docErrors[type]}</p>
                        )}
                        {!isUploading && !isLocalError && serverStatus === 'REJECTED' && record?.review_note && (
                          <p className="text-xs text-[#A32D2D] mt-1.5 bg-white/60 rounded px-2 py-1">
                            <span className="font-medium">Motivo:</span> {record.review_note}
                          </p>
                        )}
                      </div>

                      {/* Input oculto — siempre presente para poder reemplazar */}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        ref={(el) => { fileRefs.current[type] = el }}
                        onChange={(e) => handleFileChange(type, e)}
                        className="hidden"
                      />

                      <div className="flex-shrink-0">
                        {isUploading ? (
                          <div className="w-5 h-5 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow" />
                        ) : isLocalError ? (
                          <button
                            onClick={() => fileRefs.current[type]?.click()}
                            className="btn-secondary text-xs py-1 px-2.5"
                          >
                            Reintentar
                          </button>
                        ) : serverStatus === 'APPROVED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="badge-green">✓ Aprobado</span>
                            {record?.url && (
                              <button
                                onClick={() => setViewingDoc({ label, url: record.url! })}
                                className="text-xs text-[#6B738A] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                                title="Ver el documento que subiste"
                              >
                                Ver
                              </button>
                            )}
                          </div>
                        ) : serverStatus === 'REJECTED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="badge-red">✕ Rechazado</span>
                            {record?.url && (
                              <button
                                onClick={() => setViewingDoc({ label, url: record.url! })}
                                className="text-xs text-[#6B738A] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                                title="Ver el documento que subiste"
                              >
                                Ver
                              </button>
                            )}
                            <button
                              onClick={() => fileRefs.current[type]?.click()}
                              className="flex items-center gap-1 text-xs text-white bg-[#185FA5] hover:bg-[#0C447C] transition-colors py-1 px-2 rounded"
                              title="Subir un documento corregido"
                            >
                              <IconRefresh />
                              Volver a subir
                            </button>
                          </div>
                        ) : serverStatus === 'PENDING' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-[#FEF3E0] text-[#854F0B] border-[#F2D49A]">
                              En revisión
                            </span>
                            {record?.url && (
                              <button
                                onClick={() => setViewingDoc({ label, url: record.url! })}
                                className="text-xs text-[#6B738A] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                                title="Ver el documento que subiste"
                              >
                                Ver
                              </button>
                            )}
                            <button
                              onClick={() => fileRefs.current[type]?.click()}
                              className="flex items-center gap-1 text-xs text-[#6B738A] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                              title="Subir un documento diferente"
                            >
                              <IconRefresh />
                              Reemplazar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => fileRefs.current[type]?.click()}
                            className="btn-secondary text-xs py-1 px-2.5"
                          >
                            Subir
                          </button>
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

      {viewingDoc && (
        <MyDocViewerModal
          label={viewingDoc.label}
          url={viewingDoc.url}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </DashboardLayout>
  )
}