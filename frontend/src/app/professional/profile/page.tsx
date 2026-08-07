'use client'
// src/app/professional/profile/page.tsx

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { Alert, SectionTitle } from '@/components/ui'
import { professionalsAPI, api, getErrorMessage } from '@/lib/api'
import type { BankAccount, BankAccountUpdateRequest } from '@/lib/api'
import { NotificationsBell } from '@/components/shared/NotificationsBell'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const IconCamera = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
const IconRefresh = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>

// Valor sentinela para "Otro" en el selector de banco — distinto de
// other_label (el texto que se muestra) para no confundirlo con un banco real.
const OTHER_BANK_VALUE = '__OTHER__'

const DOCUMENTS = [
  { type: 'CI_FRONT',           label: 'Cédula de identidad — anverso',    hint: 'Foto clara, todos los datos legibles' },
  { type: 'CI_BACK',            label: 'Cédula de identidad — reverso',    hint: 'Sin reflejos ni bordes cortados' },
  { type: 'PROFESSIONAL_TITLE', label: 'Título en Provisión Nacional',     hint: 'Título universitario habilitante para ejercer' },
  { type: 'HEALTH_MINISTRY',    label: 'Matrícula Profesional emitida por el Ministerio de Salud', hint: 'Matrícula vigente del Ministerio de Salud de Bolivia' },
  { type: 'SPECIALTY_CERT',     label: 'Respaldo de Especialidad y/o Subespecialidad', hint: 'Certificado, diploma o título que respalde tu especialidad o subespecialidad' },
  { type: 'SELFIE_WITH_CI',     label: 'Selfie sosteniendo tu CI',         hint: 'Tu cara y la CI deben ser legibles' },
]

// Idiomas más comunes en Bolivia, para elegir con un toque en vez de
// escribirlos a mano (evita errores de tipeo/espaciado en las comas que
// antes rompían el separado por comas del input de texto libre).
const COMMON_LANGUAGES = [
  'Español', 'Aymara', 'Quechua', 'Guaraní', 'Inglés', 'Portugués', 'Francés',
]

// Badge de estado para los campos "verificables" del perfil (años de
// experiencia, universidad, matrícula profesional): mientras un admin no
// los apruebe, o si están vacíos, el paciente no los ve — este badge le
// avisa al profesional en qué estado está cada uno.
function VerifyBadge({ hasValue, verified, t }: { hasValue: boolean; verified: boolean; t: (s: string) => string }) {
  if (!hasValue) return null
  return verified ? (
    <span className="ml-2 badge-green align-middle">{t('✓ Verificado')}</span>
  ) : (
    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-[#FEF3E0] text-[#854F0B] border-[#F2D49A] align-middle">
      {t('Pendiente de verificación')}
    </span>
  )
}

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
          <button onClick={onClose} className="text-[#475569] hover:text-[#141820] text-xl">✕</button>
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

// ── Lienzo para dibujar la firma (mouse, dedo o lápiz óptico) ──
// Coordenadas del puntero se remapean del tamaño CSS real (que puede ser
// menor a SIG_WIDTH en pantallas angostas) al espacio lógico de dibujo,
// para que el trazo quede alineado con el dedo/cursor sin importar el
// ancho con el que termine renderizando la tarjeta.
const SIG_WIDTH = 500
const SIG_HEIGHT = 190
const SIG_INK_COLOR = '#0F2240' // mismo tono que INK_COLOR en el backend (app/services/signature_image.py)

function SignaturePad({
  onSave, onCancel, saving,
}: {
  onSave: (blob: Blob) => void
  onCancel: () => void
  saving: boolean
}) {
  const { t } = useLanguage()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIG_WIDTH * dpr
    canvas.height = SIG_HEIGHT * dpr
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.6
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = SIG_INK_COLOR
    }
  }, [])

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    // Remapea de píxeles CSS reales → espacio lógico SIG_WIDTH x SIG_HEIGHT
    const scaleX = SIG_WIDTH / rect.width
    const scaleY = SIG_HEIGHT / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    try { canvasRef.current?.setPointerCapture(e.pointerId) } catch {}
    drawingRef.current = true
    lastPointRef.current = pointFromEvent(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !lastPointRef.current) return
    const point = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    if (!hasDrawn) setHasDrawn(true)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false
    lastPointRef.current = null
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch {}
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  function handleSave() {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onSave(blob)
    }, 'image/png')
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-full max-w-md rounded-xl border-2 border-[#DDE1EE] bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: SIG_HEIGHT, touchAction: 'none', cursor: 'crosshair', display: 'block' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
      <p className="text-xs text-[#64748B]">{t('Dibuja tu firma con el dedo, el mouse o un lápiz óptico')}</p>
      <div className="flex gap-2 flex-wrap justify-center">
        <button onClick={clearCanvas} disabled={!hasDrawn || saving} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
          {t('Borrar')}
        </button>
        <button onClick={handleSave} disabled={!hasDrawn || saving} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
          {saving ? t('Guardando...') : t('Guardar firma')}
        </button>
        <button onClick={onCancel} disabled={saving} className="text-xs text-[#64748B] underline self-center">
          {t('Cancelar')}
        </button>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const { t } = useLanguage()
  const [docStatuses, setDocStatuses] = useState<Record<string, UploadStatus>>({})
  const [docErrors, setDocErrors]     = useState<Record<string, string>>({})
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError]     = useState('')
  const [bio, setBio]     = useState('')
  // Idiomas: chips seleccionables (COMMON_LANGUAGES) + idiomas propios que
  // el profesional va agregando uno por uno — así nunca escribe una coma
  // de más/de menos a mano. Se guarda como array y se junta con ", " solo
  // al mandar al backend (que sigue esperando el mismo string de siempre).
  const [langs, setLangs] = useState<string[]>(['Español'])
  const [customLangInput, setCustomLangInput] = useState('')
  const [years, setYears] = useState('')
  const [university, setUniversity] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  // Universidad y matrícula profesional son datos de una sola edición:
  // una vez que llegan con valor desde el backend, el input se bloquea
  // (ver JSX más abajo) — nunca lo escribió el profesional después de
  // esta carga, así que no hace falta guardar un "valor original" aparte.
  const [universityLocked, setUniversityLocked] = useState(false)
  const [licenseLocked, setLicenseLocked] = useState(false)
  // Visibilidad ante el paciente, controlada por el profesional — solo
  // aplica una vez que el dato está verificado (ver checkboxes en el JSX).
  const [yearsVisible, setYearsVisible] = useState(true)
  const [universityVisible, setUniversityVisible] = useState(true)
  // Estado de verificación de los 3 campos de arriba (los llena el admin,
  // aquí solo se muestran como badge informativo — de solo lectura)
  const [verification, setVerification] = useState({
    years_experience_verified: false,
    university_verified: false,
    professional_license_verified: false,
  })
  const [priceGeneral, setPriceGeneral]     = useState('')
  const [priceUrgent, setPriceUrgent]       = useState('')
  const [priceFollowUp, setPriceFollowUp]   = useState('')
  const [samePriceAll, setSamePriceAll]     = useState(false)
  const [pricesSuccess, setPricesSuccess]   = useState('')
  const [pricesError, setPricesError]       = useState('')
  const [viewingDoc, setViewingDoc] = useState<{ label: string; url: string } | null>(null)

  // ── Datos bancarios para pago (payouts, Fase 1 semi-automática) ──
  const [selectedBank, setSelectedBank]           = useState('')
  const [otherBankName, setOtherBankName]         = useState('')
  const [accountType, setAccountType]             = useState<'AHORRO' | 'CORRIENTE'>('AHORRO')
  const [accountNumber, setAccountNumber]         = useState('')
  const [accountNumberConfirm, setAccountNumberConfirm] = useState('')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [accountHolderCi, setAccountHolderCi]     = useState('')
  const [responsibilityAck, setResponsibilityAck] = useState(false)
  const [bankSuccess, setBankSuccess] = useState('')
  const [bankError, setBankError]     = useState('')

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

  // Detalle completo de mi membresía (la habilita/deshabilita un admin
  // manualmente) — estado actual + historial, para tener toda la info a
  // la vista en mi propio perfil.
  const { data: membership } = useQuery({
    queryKey: ['my-membership'],
    queryFn: professionalsAPI.getMyMembership,
    staleTime: 30_000,
  })

  // Lista cerrada de bancos bolivianos (ASFI) para el selector, y mi
  // cuenta bancaria actual (null si todavía no la registré).
  const { data: bankListData } = useQuery({
    queryKey: ['bank-list'],
    queryFn: professionalsAPI.getBankList,
    staleTime: 5 * 60_000,
  })
  const { data: myBankAccount, refetch: refetchBankAccount } = useQuery<BankAccount | null>({
    queryKey: ['my-bank-account'],
    queryFn: professionalsAPI.getMyBankAccount,
  })

  // Prellenar el nombre del titular con el del profesional la primera vez
  // que carga (puede editarlo si la cuenta está a nombre de otra persona).
  useEffect(() => {
    if (myBankAccount?.account_holder_name && !accountHolderName) {
      setAccountHolderName(myBankAccount.account_holder_name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myBankAccount])

  const saveBankMutation = useMutation({
    mutationFn: (data: BankAccountUpdateRequest) => professionalsAPI.updateMyBankAccount(data),
    onSuccess: () => {
      setBankSuccess(t('Cuenta bancaria guardada. Un administrador la revisará antes del próximo pago.'))
      setBankError('')
      setAccountNumber('')
      setAccountNumberConfirm('')
      setResponsibilityAck(false)
      refetchBankAccount()
    },
    onError: (err) => {
      setBankError(getErrorMessage(err))
      setBankSuccess('')
    },
  })

  function saveBankAccount() {
    setBankSuccess('')
    setBankError('')
    const bankNameFinal = selectedBank === OTHER_BANK_VALUE ? otherBankName.trim() : selectedBank
    if (!bankNameFinal) { setBankError(t('Selecciona o escribe tu banco')); return }
    if (!accountNumber || !accountNumberConfirm) { setBankError(t('Completa el número de cuenta')); return }
    if (!accountHolderName.trim() || !accountHolderCi.trim()) { setBankError(t('Completa el nombre y CI del titular')); return }
    if (!responsibilityAck) { setBankError(t('Debes aceptar la responsabilidad indicada antes de guardar')); return }

    saveBankMutation.mutate({
      bank_name: bankNameFinal,
      account_type: accountType,
      account_number: accountNumber,
      account_number_confirm: accountNumberConfirm,
      account_holder_name: accountHolderName.trim(),
      account_holder_ci: accountHolderCi.trim(),
      responsibility_acknowledged: responsibilityAck,
    })
  }

  function docRecordOf(type: string): DocRecord | undefined {
    return myDocs.find((d) => d.doc_type === type)
  }

  // Foto de perfil
  const [photoPreview, setPhotoPreview]     = useState<string | null>(null)
  const [photoFile, setPhotoFile]           = useState<File | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoRef = useRef<HTMLInputElement | null>(null)

  // Firma para recetas imprimibles — dos caminos de captura: dibujar en
  // lienzo (SignaturePad) o subir foto de la firma en papel (el backend
  // le quita el fondo). 'view' | 'choose' | 'draw' | 'photo'.
  const [signatureUrl, setSignatureUrl]         = useState<string | null>(null)
  const [signatureMode, setSignatureMode]       = useState<'view' | 'choose' | 'draw' | 'photo'>('view')
  const [signatureSaving, setSignatureSaving]   = useState(false)
  const [signatureError, setSignatureError]     = useState('')
  const [signaturePhotoFile, setSignaturePhotoFile]       = useState<File | null>(null)
  const [signaturePhotoPreview, setSignaturePhotoPreview] = useState<string | null>(null)
  const signaturePhotoRef = useRef<HTMLInputElement | null>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Cargar datos actuales del perfil al entrar a la página
  useEffect(() => {
    professionalsAPI.getMyProfile().then((data: any) => {
      if (data.bio)              setBio(data.bio)
      if (data.languages) {
        const parsed = String(data.languages).split(',').map((s: string) => s.trim()).filter(Boolean)
        if (parsed.length > 0) setLangs(parsed)
      }
      if (data.years_experience !== undefined && data.years_experience !== null) setYears(String(data.years_experience))
      if (data.university) { setUniversity(data.university); setUniversityLocked(true) }
      if (data.professional_license_number) { setLicenseNumber(data.professional_license_number); setLicenseLocked(true) }
      if (data.years_experience_visible !== undefined) setYearsVisible(!!data.years_experience_visible)
      if (data.university_visible !== undefined)       setUniversityVisible(!!data.university_visible)
      setVerification({
        years_experience_verified: !!data.years_experience_verified,
        university_verified: !!data.university_verified,
        professional_license_verified: !!data.professional_license_verified,
      })
      if (data.photo_url)        setPhotoPreview(data.photo_url)
      if (data.signature_url)    setSignatureUrl(data.signature_url)
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

  // ── Firma para recetas imprimibles ──
  async function saveSignatureFromCanvas(blob: Blob) {
    setSignatureSaving(true)
    setSignatureError('')
    try {
      const file = new File([blob], 'firma.png', { type: 'image/png' })
      const res = await professionalsAPI.uploadSignature(file)
      setSignatureUrl(res.data.signature_url)
      setSignatureMode('view')
    } catch (err) {
      setSignatureError(getErrorMessage(err))
    } finally {
      setSignatureSaving(false)
    }
  }

  function handleSignaturePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setSignatureError('Solo se aceptan imágenes JPG, PNG o WebP')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setSignatureError('La foto no puede superar 10MB')
      return
    }
    setSignaturePhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setSignaturePhotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
    setSignatureError('')
    setSignatureMode('photo')
  }

  async function saveSignatureFromPhoto() {
    if (!signaturePhotoFile) return
    setSignatureSaving(true)
    setSignatureError('')
    try {
      const res = await professionalsAPI.uploadSignatureFromPhoto(signaturePhotoFile)
      setSignatureUrl(res.data.signature_url)
      setSignatureMode('view')
      setSignaturePhotoFile(null)
      setSignaturePhotoPreview(null)
    } catch (err) {
      setSignatureError(getErrorMessage(err))
    } finally {
      setSignatureSaving(false)
    }
  }

  async function removeSignature() {
    setSignatureSaving(true)
    setSignatureError('')
    try {
      await professionalsAPI.deleteSignature()
      setSignatureUrl(null)
    } catch (err) {
      setSignatureError(getErrorMessage(err))
    } finally {
      setSignatureSaving(false)
    }
  }

  // ── Idiomas: agregar/quitar chips ──
  function toggleLanguage(name: string) {
    setLangs((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
    )
  }
  function addCustomLanguage() {
    const value = customLangInput.trim()
    if (!value) return
    const alreadyThere = langs.some((l) => l.toLowerCase() === value.toLowerCase())
    if (!alreadyThere) setLangs((prev) => [...prev, value])
    setCustomLangInput('')
  }
  function removeLanguage(name: string) {
    setLangs((prev) => prev.filter((l) => l !== name))
  }
  const customLangs = langs.filter((l) => !COMMON_LANGUAGES.includes(l))

  async function saveProfile() {
    setProfileError('')
    try {
      await professionalsAPI.updateProfile({
        bio,
        languages: langs.join(', '),
        years_experience: years,
        years_experience_visible: yearsVisible,
        university,
        university_visible: universityVisible,
        professional_license_number: licenseNumber,
      })
      setUniversityLocked(university.trim() !== '')
      setLicenseLocked(licenseNumber.trim() !== '')
      setProfileSuccess('Perfil actualizado correctamente. Si cambiaste tus años de experiencia, quedan pendientes de una nueva revisión por un administrador antes de volver a mostrarse a los pacientes.')
      setTimeout(() => setProfileSuccess(''), 6000)
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
            <h1 className="text-base font-semibold">{t('Perfil y documentos')}</h1>
            <p className="text-xs text-[#475569] mt-0.5">{t('Tu perfil público y estado de verificación')}</p>
          </div>

          <NotificationsBell role="PROFESSIONAL" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Datos de registro — solo lectura, así el profesional recuerda qué colocó */}
          {registrationData && (
            <div className="card lg:col-span-2">
              <SectionTitle>{t('Datos de registro')}</SectionTitle>
              <p className="text-xs text-[#475569] mb-3">
                Esta es la información que colocaste al registrarte. Para corregir tu CI, fecha de
                nacimiento, departamento o contacto, escribe a soporte.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Nombre completo')}</p>
                  <p className="text-sm">{registrationData.first_name} {registrationData.last_name}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Cédula de identidad')}</p>
                  <p className="text-sm">{registrationData.ci || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Fecha de nacimiento')}</p>
                  <p className="text-sm">
                    {registrationData.birth_date
                      ? new Date(registrationData.birth_date).toLocaleDateString('es-BO')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Departamento')}</p>
                  <p className="text-sm">{registrationData.department || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Género')}</p>
                  <p className="text-sm">{registrationData.gender || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Especialidad')}</p>
                  <p className="text-sm">{registrationData.specialty || '—'}</p>
                </div>
                <div className="sm:col-span-2 md:col-span-1">
                  <p className="text-xs font-medium text-[#475569]">{t('Subespecialidades')}</p>
                  <p className="text-sm">
                    {registrationData.sub_specialties && registrationData.sub_specialties.length > 0
                      ? registrationData.sub_specialties.join(', ')
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Correo electrónico')}</p>
                  <p className="text-sm">{registrationData.email || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#475569]">{t('Celular')}</p>
                  <p className="text-sm">{registrationData.phone || '—'}</p>
                </div>
                {registrationData.cmb_matricula && (
                  <div>
                    <p className="text-xs font-medium text-[#475569]">{t('Matrícula CMB')}</p>
                    <p className="text-sm">{registrationData.cmb_matricula}</p>
                  </div>
                )}
                {registrationData.sedes_number && (
                  <div>
                    <p className="text-xs font-medium text-[#475569]">{t('N° SEDES')}</p>
                    <p className="text-sm">{registrationData.sedes_number}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Documentos de verificación */}
          <div className="card">
            <SectionTitle>{t('Documentos de verificación')}</SectionTitle>
            <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5 mb-3">
              <p className="text-xs text-[#185FA5]">
                {t('La revisión toma entre 24 y 72 horas hábiles. Te avisaremos por SMS cuando tu perfil sea aprobado.')}
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
                        <p className="text-xs text-[#475569] mt-0.5">{hint}</p>
                        {docErrors[type] && (
                          <p className="text-xs text-[#A32D2D] mt-1">{docErrors[type]}</p>
                        )}
                        {!isUploading && !isLocalError && serverStatus === 'REJECTED' && record?.review_note && (
                          <p className="text-xs text-[#A32D2D] mt-1.5 bg-white/60 rounded px-2 py-1">
                            <span className="font-medium">{t('Motivo:')}</span> {record.review_note}
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
                            {t('Reintentar')}
                          </button>
                        ) : serverStatus === 'APPROVED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="badge-green">{t('✓ Aprobado')}</span>
                            {record?.url && (
                              <button
                                onClick={() => setViewingDoc({ label, url: record.url! })}
                                className="text-xs text-[#475569] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                                title="Ver el documento que subiste"
                              >
                                {t('Ver')}
                              </button>
                            )}
                          </div>
                        ) : serverStatus === 'REJECTED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="badge-red">{t('✕ Rechazado')}</span>
                            {record?.url && (
                              <button
                                onClick={() => setViewingDoc({ label, url: record.url! })}
                                className="text-xs text-[#475569] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                                title="Ver el documento que subiste"
                              >
                                {t('Ver')}
                              </button>
                            )}
                            <button
                              onClick={() => fileRefs.current[type]?.click()}
                              className="flex items-center gap-1 text-xs text-white bg-[#185FA5] hover:bg-[#0C447C] transition-colors py-1 px-2 rounded"
                              title="Subir un documento corregido"
                            >
                              <IconRefresh />
                              {t('Volver a subir')}
                            </button>
                          </div>
                        ) : serverStatus === 'PENDING' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border font-medium bg-[#FEF3E0] text-[#854F0B] border-[#F2D49A]">
                              {t('En revisión')}
                            </span>
                            {record?.url && (
                              <button
                                onClick={() => setViewingDoc({ label, url: record.url! })}
                                className="text-xs text-[#475569] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                                title="Ver el documento que subiste"
                              >
                                {t('Ver')}
                              </button>
                            )}
                            <button
                              onClick={() => fileRefs.current[type]?.click()}
                              className="flex items-center gap-1 text-xs text-[#475569] hover:text-[#185FA5] transition-colors py-0.5 px-1.5 rounded border border-[#DDE1EE] hover:border-[#85B7EB] bg-white"
                              title="Subir un documento diferente"
                            >
                              <IconRefresh />
                              {t('Reemplazar')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => fileRefs.current[type]?.click()}
                            className="btn-secondary text-xs py-1 px-2.5"
                          >
                            {t('Subir')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Datos para recetas y seguridad — Matrícula profesional + Firma.
              A diferencia del resto del "Datos del perfil público", estos dos
              SÍ son inhabilitantes: sin ambos verificados y aprobados por un
              admin, el backend bloquea la emisión de recetas y órdenes de
              laboratorio (ver create_prescription / create_lab_order). Por
              eso se agrupan en su propia sección, separados de los campos
              puramente opcionales. */}
          <div className="card">
            <SectionTitle>{t('Datos para recetas y seguridad')}</SectionTitle>
            <p className="text-xs text-[#475569] mb-4">
              {t('A diferencia de los datos del perfil público, estos dos son obligatorios: sin la Matrícula profesional y la Firma aprobadas por un administrador, no vas a poder emitir recetas ni órdenes de laboratorio. Son la base de la validez legal de cada documento y protegen tanto al paciente como a ti — evitan que alguien emita recetas a tu nombre sin estar habilitado.')}
            </p>
            {profileSuccess && <div className="mb-3"><Alert type="success" message={profileSuccess} /></div>}
            {profileError   && <div className="mb-3"><Alert type="error"   message={profileError} /></div>}

            <div className="pb-4 mb-4 border-b border-[#DDE1EE]">
              <p className="text-xs font-semibold text-[#1A1F2E] mb-2">{t('Matrícula profesional')}</p>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  {t('Matrícula profesional (Ministerio de Salud)')}
                  <VerifyBadge hasValue={licenseNumber.trim() !== ''} verified={verification.professional_license_verified} t={t} />
                </label>
                <input
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] disabled:bg-[#F5F6FA] disabled:text-[#64748B]"
                  placeholder={t('Número de tu matrícula del Ministerio de Salud')}
                  value={licenseNumber}
                  disabled={licenseLocked}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                />
                <p className="text-xs text-[#64748B] mt-1">
                  {licenseLocked
                    ? t('Ya quedó registrada y no se puede modificar — es un dato que no cambia. Si necesitas corregirla, contacta a soporte.')
                    : t('Se verifica contra el documento que subas en "Documentos de verificación" — si la dejas vacía, o mientras no esté verificada, el paciente no la verá. Una vez guardada, no se podrá volver a editar.')}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[#1A1F2E] mb-2">{t('Firma para recetas médicas')}</p>
            <p className="text-xs text-[#475569] mb-3">
              {t('Se estampa en el PDF imprimible de tus recetas, para las farmacias que todavía piden papel. La autenticidad real de cada receta siempre la da el código QR, no esta imagen.')}
            </p>
            {signatureError && <div className="mb-3"><Alert type="error" message={signatureError} /></div>}

            {signatureUrl && (() => {
              const sigRecord = docRecordOf('SIGNATURE')
              const sigStatus = sigRecord?.status
              return (
                <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${
                  sigStatus === 'APPROVED' ? 'bg-[#E1F5EE] text-[#1D9E75]' :
                  sigStatus === 'REJECTED' ? 'bg-[#FCEBEB] text-[#C0392B]' :
                  'bg-[#FEF3E0] text-[#8A6D1F]'
                }`}>
                  {sigStatus === 'APPROVED' && t('✓ Firma verificada por un administrador. Ya podés emitir recetas y órdenes de laboratorio.')}
                  {sigStatus === 'REJECTED' && (
                    <>
                      {t('✕ Firma rechazada.')}{sigRecord?.review_note && <> <span className="font-medium">{t('Motivo:')}</span> {sigRecord.review_note}</>}{' '}
                      {t('Subí una nueva para poder emitir recetas y órdenes de laboratorio.')}
                    </>
                  )}
                  {(!sigStatus || sigStatus === 'PENDING') && t('⏳ Firma en revisión (24-72h hábiles). No podés emitir recetas ni órdenes de laboratorio hasta que un administrador la apruebe.')}
                </div>
              )
            })()}

            {/* Input de foto oculto — vive fuera de los bloques condicionales
                para que la ref no se pierda al cambiar de modo */}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              ref={signaturePhotoRef}
              onChange={handleSignaturePhotoChange}
              className="hidden"
            />

            {signatureMode === 'view' && (
              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-xs h-28 rounded-xl border-2 border-dashed border-[#DDE1EE] bg-[#F5F6FA] flex items-center justify-center overflow-hidden">
                  {signatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signatureUrl} alt={t('Firma')} className="max-h-full max-w-full object-contain p-2" />
                  ) : (
                    <p className="text-xs text-[#A0A8BF] px-4 text-center">{t('Todavía no cargaste tu firma')}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSignatureMode('choose')} className="btn-primary text-xs py-1.5 px-3">
                    {signatureUrl ? t('Cambiar firma') : t('Agregar firma')}
                  </button>
                  {signatureUrl && (
                    <button onClick={removeSignature} disabled={signatureSaving} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
                      {t('Quitar')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {signatureMode === 'choose' && (
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <button
                  onClick={() => setSignatureMode('draw')}
                  className="flex-1 border-2 border-[#DDE1EE] rounded-xl p-4 text-center hover:border-[#185FA5] transition-colors"
                >
                  <p className="text-2xl mb-1">✏️</p>
                  <p className="text-sm font-semibold text-[#1A1F2E]">{t('Dibujar firma')}</p>
                  <p className="text-xs text-[#64748B] mt-1">{t('Con el dedo o el mouse')}</p>
                </button>
                <button
                  onClick={() => signaturePhotoRef.current?.click()}
                  className="flex-1 border-2 border-[#DDE1EE] rounded-xl p-4 text-center hover:border-[#185FA5] transition-colors"
                >
                  <p className="text-2xl mb-1">📷</p>
                  <p className="text-sm font-semibold text-[#1A1F2E]">{t('Subir foto de mi firma')}</p>
                  <p className="text-xs text-[#64748B] mt-1">{t('Firmá en papel y fotografiá')}</p>
                </button>
                <button
                  onClick={() => setSignatureMode('view')}
                  className="text-xs text-[#64748B] underline self-center sm:self-auto"
                >
                  {t('Cancelar')}
                </button>
              </div>
            )}

            {signatureMode === 'draw' && (
              <SignaturePad
                saving={signatureSaving}
                onSave={saveSignatureFromCanvas}
                onCancel={() => setSignatureMode('view')}
              />
            )}

            {signatureMode === 'photo' && (
              <div className="flex flex-col items-center gap-3">
                <div className="w-full max-w-xs h-28 rounded-xl border-2 border-[#DDE1EE] bg-[#F5F6FA] flex items-center justify-center overflow-hidden">
                  {signaturePhotoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signaturePhotoPreview} alt={t('Vista previa')} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <p className="text-xs text-[#A0A8BF]">{t('Selecciona una foto')}</p>
                  )}
                </div>
                <p className="text-xs text-[#64748B] text-center max-w-xs">
                  {t('Firmá con tinta oscura sobre una hoja blanca, con buena luz. Le quitamos el fondo automáticamente.')}
                </p>
                <div className="flex gap-2 flex-wrap justify-center">
                  <button onClick={() => signaturePhotoRef.current?.click()} disabled={signatureSaving} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
                    {t('Elegir otra foto')}
                  </button>
                  <button onClick={saveSignatureFromPhoto} disabled={!signaturePhotoFile || signatureSaving} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                    {signatureSaving ? t('Guardando...') : t('Guardar firma')}
                  </button>
                  <button
                    onClick={() => { setSignatureMode('view'); setSignaturePhotoFile(null); setSignaturePhotoPreview(null); setSignatureError('') }}
                    disabled={signatureSaving}
                    className="text-xs text-[#64748B] underline self-center"
                  >
                    {t('Cancelar')}
                  </button>
                </div>
              </div>
            )}
            </div>

            <div className="pt-4 mt-1 border-t border-[#DDE1EE]">
              <button onClick={saveProfile} className="btn-primary text-xs py-1.5 px-3">
                {t('Guardar cambios')}
              </button>
            </div>
          </div>

          {/* Perfil público */}
          <div className="card">
            <SectionTitle>{t('Datos del perfil público')}</SectionTitle>
            <p className="text-xs text-[#475569] mb-3">
              {t('Estos datos son opcionales y no afectan tu capacidad de atender pacientes ni de emitir recetas — solo suman credibilidad frente al paciente una vez verificados por un admin.')}
            </p>
            {profileSuccess && <div className="mb-3"><Alert type="success" message={profileSuccess} /></div>}
            {profileError   && <div className="mb-3"><Alert type="error"   message={profileError} /></div>}

            {/* Foto de perfil */}
            <div className="flex flex-col items-center mb-4">
              <p className="text-xs font-medium text-[#475569] mb-2 self-start">{t('Foto de perfil')}</p>
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
                    {t('Cancelar')}
                  </button>
                </div>
              )}
              <p className="text-xs text-[#64748B] mt-1">{t('JPG, PNG o WebP · Máximo 5MB')}</p>
              <p className="text-xs text-[#185FA5] mt-0.5 text-center">
                {t('Una foto profesional aumenta la confianza de los pacientes')}
              </p>
            </div>

            {/* Datos del perfil */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  {t('Presentación (visible al paciente)')}
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none"
                  rows={4}
                  placeholder={t('Describe tu experiencia, especialidades y estilo de atención...')}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={400}
                />
                <p className="text-xs text-[#64748B] mt-1 text-right">{bio.length}/400</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Idiomas de atención')}</label>
                {/* Chips en vez de texto libre — así nunca hay comas mal
                    puestas o nombres mal escritos: se toca para agregar/
                    quitar, y los que no están en la lista se agregan aparte. */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {COMMON_LANGUAGES.map((lang) => {
                    const active = langs.includes(lang)
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => toggleLanguage(lang)}
                        className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                          active
                            ? 'bg-[#0F6E56] text-white border-[#0F6E56]'
                            : 'bg-white text-[#475569] border-[#DDE1EE] hover:border-[#0F6E56]'
                        }`}
                      >
                        {lang}
                      </button>
                    )
                  })}
                </div>

                {customLangs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {customLangs.map((lang) => (
                      <span
                        key={lang}
                        className="text-xs px-2.5 py-1.5 rounded-full border border-[#185FA5] bg-[#E6F1FB] text-[#185FA5] flex items-center gap-1.5"
                      >
                        {lang}
                        <button
                          type="button"
                          onClick={() => removeLanguage(lang)}
                          className="hover:text-[#0C447C]"
                          title={t('Quitar')}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                    placeholder={t('Ej. Italiano — presiona Agregar')}
                    value={customLangInput}
                    onChange={(e) => setCustomLangInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomLanguage() } }}
                  />
                  <button type="button" onClick={addCustomLanguage} className="btn-secondary text-xs px-3 whitespace-nowrap">
                    {t('Agregar')}
                  </button>
                </div>
                {langs.length === 0 && (
                  <p className="text-xs text-[#A32D2D] mt-1">{t('Elige al menos un idioma')}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  {t('Años de experiencia')}
                  <VerifyBadge hasValue={years.trim() !== ''} verified={verification.years_experience_verified} t={t} />
                </label>
                <input
                  type="number" min={0} max={50}
                  className="w-24 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  placeholder="—"
                  value={years}
                  onChange={(e) => setYears(e.target.value)}
                />
                <p className="text-xs text-[#64748B] mt-1">
                  {t('Si lo dejas vacío, o mientras no esté verificado, el paciente no lo verá. Lo puedes actualizar cuando quieras — cada cambio vuelve a pasar por revisión.')}
                </p>
                {years.trim() !== '' && verification.years_experience_verified && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-[#475569]">
                    <input
                      type="checkbox"
                      checked={yearsVisible}
                      onChange={(e) => setYearsVisible(e.target.checked)}
                    />
                    {t('Mostrar mis años de experiencia al paciente')}
                  </label>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  {t('Universidad')}
                  <VerifyBadge hasValue={university.trim() !== ''} verified={verification.university_verified} t={t} />
                </label>
                <input
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] disabled:bg-[#F5F6FA] disabled:text-[#64748B]"
                  placeholder={t('Ej. Universidad Mayor de San Andrés (opcional)')}
                  value={university}
                  disabled={universityLocked}
                  onChange={(e) => setUniversity(e.target.value)}
                />
                <p className="text-xs text-[#64748B] mt-1">
                  {universityLocked
                    ? t('Ya quedó registrada y no se puede modificar — es un dato que no cambia. Si necesitas corregirla, contacta a soporte.')
                    : t('Se verifica contra tu Título en Provisión Nacional — si la dejas vacía, o mientras no esté verificada, el paciente no la verá. Una vez guardada, no se podrá volver a editar.')}
                </p>
                {university.trim() !== '' && verification.university_verified && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-[#475569]">
                    <input
                      type="checkbox"
                      checked={universityVisible}
                      onChange={(e) => setUniversityVisible(e.target.checked)}
                    />
                    {t('Mostrar mi universidad al paciente')}
                  </label>
                )}
              </div>

              <button onClick={saveProfile} className="btn-primary text-xs py-1.5 px-3">
                {t('Guardar cambios')}
              </button>
            </div>
          </div>

          {/* Precios de consulta */}
          <div className="card">
            <SectionTitle>{t('Precios de consulta')}</SectionTitle>
            <p className="text-xs text-[#475569] mb-3">
              {t('Define cuánto cobras según el tipo de consulta. El paciente ve el precio correspondiente antes de confirmar.')}
            </p>

            {pricesError   && <div className="mb-3"><Alert type="error"   message={pricesError} /></div>}
            {pricesSuccess && <div className="mb-3"><Alert type="success" message={pricesSuccess} /></div>}

            {commission && (
              <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5 mb-4">
                <p className="text-xs text-[#185FA5]">
                  {t('Comisión de la plataforma:')} <span className="font-semibold">{commission.percent}%</span>
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
              <span className="text-xs text-[#3C4257]">{t('Cobrar el mismo precio para las 3 consultas')}</span>
            </label>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
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
                  <p className="text-xs text-[#64748B] mt-1">{t('El paciente agenda una cita para más adelante')}</p>
                )}
              </div>

              {!samePriceAll && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] mb-1">
                      {t('Consulta inmediata (Bs.)')}
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
                    <p className="text-xs text-[#64748B] mt-1">{t('El paciente entra ahora mismo, sin cita previa')}</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#475569] mb-1">
                      {t('Consulta de seguimiento (Bs.)')}
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
                    <p className="text-xs text-[#64748B] mt-1">
                      {t('Solo la ven pacientes que ya tuvieron una consulta completada contigo, y también se agenda con fecha y hora')}
                    </p>
                  </div>
                </>
              )}

              <button onClick={savePrices} className="btn-primary text-xs py-1.5 px-3">
                {t('Guardar precios')}
              </button>
            </div>
          </div>

          {/* Datos bancarios para pago */}
          <div className="card">
            <SectionTitle>{t('Datos bancarios para pago')}</SectionTitle>
            <p className="text-xs text-[#475569] mb-3">
              {t('Acá se te transfiere el % que te corresponde de cada consulta cobrada por QR. Todavía no está automatizado con el banco: un administrador revisa tu cuenta y hace la transferencia manualmente, así que puede demorar unos días.')}
            </p>
            <p className="text-xs text-[#475569] mb-3">
              {t('Es opcional. Si prefieres no registrar una cuenta bancaria, no hay problema — coordina con el equipo de MedicBolivia otra forma de pago.')}
            </p>

            {bankSuccess && <div className="mb-3"><Alert type="success" message={bankSuccess} /></div>}
            {bankError   && <div className="mb-3"><Alert type="error"   message={bankError} /></div>}

            {myBankAccount && (
              <div className="mb-4 p-3 rounded-lg bg-[#F5F6FA] border border-[#DDE1EE]">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-[#141820]">{myBankAccount.bank_name}</p>
                  {myBankAccount.verified ? (
                    <span className="text-xs font-semibold text-[#0F6E56] bg-[#E3F6EF] px-2 py-0.5 rounded-full whitespace-nowrap">
                      ✓ {t('Verificada')}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#B45309] bg-[#FEF3C7] px-2 py-0.5 rounded-full whitespace-nowrap">
                      {t('Pendiente de revisión')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#475569]">
                  {myBankAccount.account_type === 'AHORRO' ? t('Cuenta de ahorro') : t('Cuenta corriente')} · {myBankAccount.account_number_masked}
                </p>
                <p className="text-xs text-[#475569]">{t('Titular')}: {myBankAccount.account_holder_name}</p>
                {!myBankAccount.verified && (
                  <p className="text-xs text-[#B45309] mt-1">
                    {t('Un administrador la revisará antes de incluirte en el próximo pago.')}
                  </p>
                )}
              </div>
            )}

            <p className="text-xs font-semibold text-[#141820] mb-2">
              {myBankAccount ? t('Cambiar cuenta bancaria') : t('Registrar cuenta bancaria')}
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Banco')}</label>
                <select
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
                  value={selectedBank}
                  onChange={(e) => setSelectedBank(e.target.value)}
                >
                  <option value="">{t('Selecciona tu banco')}</option>
                  {(bankListData?.banks || []).map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                  <option value={OTHER_BANK_VALUE}>{bankListData?.other_label || 'Otro'}</option>
                </select>
              </div>

              {selectedBank === OTHER_BANK_VALUE && (
                <div>
                  <label className="block text-xs font-medium text-[#475569] mb-1">
                    {t('Nombre del banco o cooperativa')}
                  </label>
                  <input
                    className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                    placeholder={t('Ej: Cooperativa Jesús Nazareno')}
                    value={otherBankName}
                    onChange={(e) => setOtherBankName(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Tipo de cuenta')}</label>
                <select
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as 'AHORRO' | 'CORRIENTE')}
                >
                  <option value="AHORRO">{t('Cuenta de ahorro')}</option>
                  <option value="CORRIENTE">{t('Cuenta corriente')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Número de cuenta')}</label>
                <input
                  type="text" inputMode="numeric"
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d]/g, ''))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  {t('Confirma tu número de cuenta')}
                </label>
                <input
                  type="text" inputMode="numeric"
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  value={accountNumberConfirm}
                  onChange={(e) => setAccountNumberConfirm(e.target.value.replace(/[^\d]/g, ''))}
                />
                <p className="text-xs text-[#64748B] mt-1">
                  {t('Revisa bien cada dígito — una vez transferido, un error en la cuenta puede ser difícil o imposible de corregir.')}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  {t('Nombre completo del titular')}
                </label>
                <input
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  placeholder={t('Tal como figura en el banco')}
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                />
                <p className="text-xs text-[#64748B] mt-1">
                  {t('Puede ser otra persona, por ejemplo si la cuenta no está a tu nombre')}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('CI del titular')}</label>
                <input
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  value={accountHolderCi}
                  onChange={(e) => setAccountHolderCi(e.target.value)}
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-[#475569] leading-snug">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={responsibilityAck}
                  onChange={(e) => setResponsibilityAck(e.target.checked)}
                />
                <span>
                  {t('Confirmo que el número de cuenta y los datos del titular que ingresé son correctos. Entiendo que MedicBolivia no se hace responsable por transferencias enviadas a una cuenta incorrecta si el error fue mío al registrar los datos, y que corregir un envío ya realizado puede no ser posible o tomar tiempo adicional con el banco.')}
                </span>
              </label>

              <button
                onClick={saveBankAccount}
                disabled={saveBankMutation.isPending}
                className="btn-primary text-xs py-1.5 px-3"
              >
                {saveBankMutation.isPending ? t('Guardando...') : t('Guardar cuenta bancaria')}
              </button>
            </div>
          </div>

          {/* Membresía */}
          <div className="card">
            <SectionTitle>Membresía</SectionTitle>
            <p className="text-xs text-[#475569] mb-3">
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
                <p className="text-xs font-semibold text-[#475569] uppercase tracking-wide mb-2">{t('Historial')}</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {membership.history.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 bg-white border border-[#DDE1EE] rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">
                          {m.period_label || 'Sin etiqueta'}
                        </p>
                        <p className="text-[11px] text-[#475569]">
                          {m.starts_at ? new Date(m.starts_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                          {' → '}
                          {m.ends_at ? new Date(m.ends_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'sin fin'}
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${m.is_current ? 'bg-[#E1F5EE] text-[#0F6E56]' : m.active ? 'bg-[#F5F6FA] text-[#475569]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
                        {m.is_current ? 'Vigente' : m.active ? 'Habilitada' : 'Deshabilitada'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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