'use client'
// src/app/admin/doctor-leads/page.tsx
// Captación de médicos: buscar en Google Maps + gestionar prospectos
// (leads) hasta invitarlos por WhatsApp a probar la plataforma.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, EmptyState, SectionTitle, Alert, Spinner } from '@/components/ui'
import {
  adminAPI, getErrorMessage,
  type DoctorLead, type DoctorLeadStatus, type MapsSearchResult,
} from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// Ciudades por departamento — para variar las búsquedas de Google Maps
// más allá de las 9 capitales (útil porque cada búsqueda trae como
// máximo 60 resultados: si "internista" ya te dio el tope en la
// capital, buscar en otra ciudad del mismo departamento te trae
// médicos distintos en vez de repetir los mismos 60).
const BOLIVIA_CITIES: Record<string, string[]> = {
  'La Paz': ['La Paz', 'El Alto', 'Viacha', 'Copacabana', 'Achacachi', 'Caranavi', 'Coroico', 'Patacamaya'],
  'Santa Cruz': [
    'Santa Cruz de la Sierra', 'Montero', 'Warnes', 'La Guardia', 'Cotoca',
    'Camiri', 'Puerto Suárez', 'San Ignacio de Velasco', 'Yapacaní',
  ],
  'Cochabamba': ['Cochabamba', 'Quillacollo', 'Sacaba', 'Colcapirhua', 'Tiquipaya', 'Punata', 'Villa Tunari'],
  'Oruro': ['Oruro', 'Huanuni', 'Challapata'],
  'Potosí': ['Potosí', 'Uyuni', 'Villazón', 'Tupiza', 'Llallagua'],
  'Tarija': ['Tarija', 'Yacuiba', 'Bermejo', 'Villa Montes'],
  'Beni': ['Trinidad', 'Riberalta', 'Guayaramerín', 'San Borja'],
  'Pando': ['Cobija', 'Porvenir'],
  'Chuquisaca': ['Sucre', 'Monteagudo', 'Camargo'],
}
const DEPARTMENTS = Object.keys(BOLIVIA_CITIES)

const STATUS_LABELS: Record<DoctorLeadStatus, string> = {
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  INTERESADO: 'Interesado',
  NO_INTERESADO: 'No interesado',
  REGISTRADO: 'Registrado',
  NO_CONTACTAR: 'No contactar',
}

// ── Variación del saludo ──
// WhatsApp empezó a marcar como spam los envíos automáticos a números no
// registrados (nos costó un baneo) en buena parte porque el saludo era
// siempre el mismo texto para todos los prospectos. Para reducir ese
// parecido, el mensaje se arma combinando piezas al azar en vez de usar
// siempre la misma plantilla fija — tanto para "Enviar invitación" como
// para "Generar invitación" (copiado manual).
const GREETING_OPENERS = ['Hola', 'Buenos días', 'Buenas tardes', 'Qué tal', 'Un gusto saludarle', 'Cordial saludo']
const GREETING_INTROS = [
  'le escribimos de MedicBolivia',
  'le contactamos desde MedicBolivia',
  'le saluda el equipo de MedicBolivia',
  'somos del equipo de MedicBolivia',
  'le escribe el equipo de MedicBolivia',
]
const GREETING_EMOJIS = ['👋', '🩺', '😊', '']
const CLOSING_QUESTIONS = [
  '¿Le interesaría que le contemos más?',
  '¿Le gustaría conocer más detalles?',
  '¿Le parece si le compartimos más información?',
  '¿Podemos contarle un poco más al respecto?',
  '¿Le interesaría conocer cómo funciona?',
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Nombre a usar en el saludo de la invitación: si el admin cargó una
// corrección en invite_name (columna "Nombre para invitación" de la
// tabla) se usa esa; si no, cae de vuelta a full_name — igual que hace
// el backend en _lead_invite_name() (admin.py), para que el mensaje que
// arma este archivo y el PDF que genera el backend siempre saluden con
// el mismo nombre.
function effectiveInviteName(lead: DoctorLead): string {
  return (lead.invite_name && lead.invite_name.trim()) || lead.full_name
}

function buildInviteMessage(name: string): string {
  const opener = randomFrom(GREETING_OPENERS)
  const intro = randomFrom(GREETING_INTROS)
  const emoji = randomFrom(GREETING_EMOJIS)
  const closing = randomFrom(CLOSING_QUESTIONS)
  const namePart = name ? ` Dr./Dra. ${name}` : ''
  return (
    `${opener}${namePart}, ${intro}${emoji ? ' ' + emoji : ''}\n\n` +
    `Somos una plataforma de telemedicina en Bolivia donde agentes de inteligencia artificial ` +
    `reciben, orientan y conectan al paciente con usted, y nos encantaría invitarle a probarla ` +
    `sin costo. Con ella puede atender consultas en línea, gestionar su agenda y recetar ` +
    `de forma digital.\n\n${closing}\n\nhttps://medicbolivia.com`
  )
}

// ── Modal: buscar en Google Maps ──
function MapsSearchModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState(DEPARTMENTS[0])
  const [city, setCity] = useState(BOLIVIA_CITIES[DEPARTMENTS[0]][0])
  const [error, setError] = useState('')
  const [importingId, setImportingId] = useState<string | null>(null)
  // place_id de resultados importados durante esta sesión del modal. La
  // bandera already_imported de cada resultado viene fija desde el momento
  // de la búsqueda, así que sin esto el botón "Agregar como prospecto" se
  // quedaba mostrándose para algo que el admin ya acababa de importar.
  const [justImportedIds, setJustImportedIds] = useState<Set<string>>(new Set())

  const handleDepartmentChange = (dep: string) => {
    setDepartment(dep)
    setCity(BOLIVIA_CITIES[dep][0])
  }

  const searchMutation = useMutation({
    mutationFn: () => adminAPI.searchDoctorsOnMaps(query, city),
    onError: (err) => setError(getErrorMessage(err)),
  })

  const importPlace = async (place: MapsSearchResult) => {
    setError('')
    setImportingId(place.place_id)
    try {
      // Pedimos el detalle (teléfono) solo del resultado elegido — no se
      // gasta cuota en los que el admin no va a importar.
      const details = await adminAPI.getDoctorPlaceDetails(place.place_id)
      await adminAPI.createDoctorLead({
        full_name: details.name || place.name,
        city,
        phone: details.phone_normalized || undefined,
        clinic_or_hospital: details.name,
        address: details.address || place.address || undefined,
        source: 'GOOGLE_PLACES',
        place_id: place.place_id,
        maps_url: details.maps_url || place.maps_url || undefined,
        notes: !details.phone_normalized && details.phone
          ? `Teléfono encontrado sin normalizar: ${details.phone}`
          : undefined,
      } as any)
      setJustImportedIds((prev) => new Set(prev).add(place.place_id))
      onImported()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setImportingId(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#DDE1EE]">
          <p className="text-sm font-semibold">{t('Buscar médicos en Google Maps')}</p>
          <button onClick={onClose} className="text-[#475569] hover:text-[#141820] text-xl">✕</button>
        </div>

        <div className="p-4 border-b border-[#DDE1EE] flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            placeholder={t('Ej: cardiólogo, dermatólogo...')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && query.length >= 2 && searchMutation.mutate()}
          />
          <select
            className="border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            value={department}
            onChange={(e) => handleDepartmentChange(e.target.value)}
          >
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select
            className="border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            {BOLIVIA_CITIES[department].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={query.length < 2 || searchMutation.isPending}
            onClick={() => searchMutation.mutate()}
          >
            {searchMutation.isPending ? <Spinner size="sm" /> : t('Buscar')}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

          {searchMutation.isPending && (
            <LoadingScreen text={t('Buscando en Google Maps (puede tardar unos segundos)...')} />
          )}

          {!searchMutation.isPending && searchMutation.data?.results.length === 0 && (
            <EmptyState title={t('Sin resultados')} description={t('Prueba con otra especialidad o ciudad')} />
          )}

          {!searchMutation.isPending && !searchMutation.data && (
            <p className="text-sm text-[#475569] text-center py-8">
              {t('Escribe una especialidad y ciudad, ej. "pediatra" en "Cochabamba"')}
            </p>
          )}

          <div className="space-y-2">
            {searchMutation.data?.results.map((place) => (
              <div
                key={place.place_id}
                className="border border-[#DDE1EE] rounded-lg p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#141820] truncate">{place.name}</p>
                  {place.address && <p className="text-xs text-[#475569] mt-0.5">{place.address}</p>}
                  {place.rating != null && (
                    <p className="text-xs text-[#64748B] mt-0.5">
                      ⭐ {place.rating} ({place.user_rating_count ?? 0})
                    </p>
                  )}
                </div>
                {place.already_imported || justImportedIds.has(place.place_id) ? (
                  <span className="badge-gray shrink-0">{t('Ya en tu lista')}</span>
                ) : (
                  <button
                    className="shrink-0 text-xs font-medium text-[#185FA5] border border-[#185FA5] rounded-lg px-3 py-1.5 hover:bg-[#E6F1FB] disabled:opacity-50"
                    disabled={importingId === place.place_id}
                    onClick={() => importPlace(place)}
                  >
                    {importingId === place.place_id ? t('Agregando...') : t('Agregar como prospecto')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Modal: agregar prospecto manual ──
function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useLanguage()
  const [form, setForm] = useState({ full_name: '', specialty: '', city: '', phone: '', notes: '' })
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () => adminAPI.createDoctorLead({ ...form, source: 'MANUAL' } as any),
    onSuccess: onCreated,
    onError: (err) => setError(getErrorMessage(err)),
  })

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-4">{t('Agregar prospecto manual')}</p>
        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}
        <div className="space-y-3">
          <input
            className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            placeholder={t('Nombre completo *')}
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            placeholder={t('Especialidad')}
            value={form.specialty}
            onChange={(e) => setForm({ ...form, specialty: e.target.value })}
          />
          <input
            className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            placeholder={t('Ciudad')}
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <input
            className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            placeholder={t('Teléfono (WhatsApp)')}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <textarea
            className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
            placeholder={t('Notas (opcional)')}
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm text-[#475569] px-4 py-2">{t('Cancelar')}</button>
          <button
            className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={form.full_name.length < 2 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <Spinner size="sm" /> : t('Guardar')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// Celda editable de la columna "Nombre para invitación". Google Places a
// veces trae en el nombre datos que no son el nombre del médico
// ("Medicina Interna - Cámara Hiperbárica - Dr. Jorge Oblitas - La Paz"),
// y ese texto completo terminaba usándose para saludar en el WhatsApp/PDF
// de invitación. Acá el admin escribe el nombre correcto SOLO para la
// invitación (no se toca "Nombre", que sigue siendo el dato tal cual vino
// de la búsqueda). Vacío = usa el nombre de arriba (placeholder muestra
// cuál sería ese default).
function InviteNameCell({ lead, onSave }: { lead: DoctorLead; onSave: (value: string) => void }) {
  const { t } = useLanguage()
  const [value, setValue] = useState(lead.invite_name || '')
  const [saved, setSaved] = useState(false)

  // Si otra fuente actualiza el lead (ej. refetch tras guardar), reflejamos
  // el valor del servidor — pero no mientras el admin todavía está
  // escribiendo (se resincroniza recién cuando el input pierde el foco y
  // dispara el guardado, ver commit()).
  useEffect(() => {
    setValue(lead.invite_name || '')
  }, [lead.id, lead.invite_name])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed !== (lead.invite_name || '').trim()) {
      onSave(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="min-w-[160px]">
      <input
        className="w-full border border-[#DDE1EE] rounded-md px-2 py-1 text-xs focus:border-[#185FA5] focus:outline-none"
        placeholder={lead.full_name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {saved && <p className="text-[10px] text-[#0F6E56] mt-0.5">{t('Guardado ✓')}</p>}
    </div>
  )
}

// Badge de estado de invitación para la columna de la tabla. Muestra si el
// último WhatsApp a este lead se mandó bien (SENT) o falló (FAILED) — no
// si el médico lo leyó (eso no se rastrea todavía, ver nota en el backend).
function InviteStatusBadge({ lead, isPending }: { lead: DoctorLead; isPending?: boolean }) {
  const { t } = useLanguage()

  if (isPending) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-[#EEF1FA] text-[#4A5578]">
        <Spinner size="sm" />
        {t('Enviando…')}
      </span>
    )
  }

  if (!lead.last_invite_status && !lead.last_manual_invite_at) {
    return <span className="text-xs text-[#64748B]">{t('Sin invitar')}</span>
  }

  // Si la última acción sobre este lead fue "Generar invitación" (copiado
  // manual, sin envío automático de la plataforma) y es más reciente que
  // cualquier envío automático previo, la columna debe reflejar eso y no
  // el resultado del envío automático viejo — para que el admin no crea
  // que la plataforma mandó algo que en realidad pegó él mismo a mano.
  const manualTime = lead.last_manual_invite_at ? new Date(lead.last_manual_invite_at).getTime() : 0
  const sentTime = lead.last_invite_sent_at ? new Date(lead.last_invite_sent_at).getTime() : 0
  const manualIsLatest = manualTime > 0 && manualTime >= sentTime

  if (manualIsLatest) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex w-fit items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[#EEF1FA] text-[#4A5578]">
          {t('Generado manualmente')}
        </span>
        {lead.last_manual_invite_at && (
          <span className="text-[10px] text-[#64748B]">{formatInviteDate(lead.last_manual_invite_at)}</span>
        )}
      </div>
    )
  }

  const isSent = lead.last_invite_status === 'SENT'
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`inline-flex w-fit items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
          isSent ? 'bg-[#E6F4EF] text-[#0F6E56]' : 'bg-[#FBEAEA] text-[#A32D2D]'
        }`}
        title={!isSent && lead.last_invite_error ? lead.last_invite_error : undefined}
      >
        {isSent ? t('Enviada') : t('Falló')}
        {lead.last_invite_included_pdf && ` · ${t('PDF')}`}
      </span>
      {lead.last_invite_sent_at && (
        <span className="text-[10px] text-[#64748B]">{formatInviteDate(lead.last_invite_sent_at)}</span>
      )}
    </div>
  )
}

// ── Modal: invitar por WhatsApp ──
// Dos formas de contactar al prospecto:
//  · "Enviar invitación"  → la plataforma manda el WhatsApp sola (Celery
//    → whatsapp-service). Es lo de siempre, pero a números todavía no
//    registrados WhatsApp lo está marcando como spam.
//  · "Generar invitación" → NO se manda nada automáticamente. Se copia el
//    mensaje al portapapeles, se abre el PDF en una pestaña nueva, y el
//    admin lo pega/adjunta él mismo en WhatsApp — el primer contacto
//    "manual" que evita el patrón de envío masivo que llevó al baneo.
function InviteModal({
  lead, onClose, onSent, onManualGenerated,
}: {
  lead: DoctorLead
  onClose: () => void
  onSent: () => void
  onManualGenerated: () => void
}) {
  const { t } = useLanguage()
  const [message, setMessage] = useState(() => buildInviteMessage(effectiveInviteName(lead)))
  const [includePdf, setIncludePdf] = useState(true)
  const [error, setError] = useState('')
  const [manualPending, setManualPending] = useState(false)
  const [manualDone, setManualDone] = useState(false)
  const [copyOk, setCopyOk] = useState(false)

  const inviteMutation = useMutation({
    mutationFn: () => adminAPI.inviteDoctorLead(lead.id, message, includePdf),
    onSuccess: onSent,
    onError: (err) => setError(getErrorMessage(err)),
  })

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopyOk(true)
    } catch {
      setError(t('No se pudo copiar automáticamente — selecciona el texto y copiá manualmente.'))
    }
  }

  const handleGenerateManual = async () => {
    setError('')
    setCopyOk(false)
    setManualPending(true)
    try {
      // 1) Copiamos el mensaje al portapapeles para que quede a un solo
      //    "pegar" en WhatsApp. Si el navegador bloquea el portapapeles,
      //    el texto sigue visible arriba para copiarlo a mano.
      try {
        await navigator.clipboard.writeText(message)
        setCopyOk(true)
      } catch {
        // silencioso — ver fallback arriba
      }

      // 2) Si corresponde, el PDF se abre en una pestaña nueva para que
      //    el admin lo descargue o lo adjunte él mismo.
      if (includePdf) {
        const blob = await adminAPI.getDoctorLeadInvitationPdf(lead.id)
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
      }

      // 3) Recién acá dejamos constancia en el backend — así la columna
      //    "Invitación" del listado sabe distinguir esto de un envío
      //    automático.
      await adminAPI.generateManualDoctorLeadInvite(lead.id)
      setManualDone(true)
      onManualGenerated()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setManualPending(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-1">{t('Invitar por WhatsApp')}</p>
        <p className={`text-xs text-[#475569] ${effectiveInviteName(lead) !== lead.full_name ? 'mb-0.5' : 'mb-4'}`}>
          {lead.full_name} · {lead.phone}
        </p>
        {effectiveInviteName(lead) !== lead.full_name && (
          <p className="text-xs text-[#185FA5] mb-4">
            {t('Se saluda como')} <span className="font-medium">Dr./Dra. {effectiveInviteName(lead)}</span>
          </p>
        )}
        {(lead.last_invite_status || lead.last_manual_invite_at) && (
          <div className="mb-3">
            <Alert
              type={lead.last_invite_status === 'FAILED' ? 'error' : 'info'}
              message={
                lead.last_manual_invite_at && (!lead.last_invite_sent_at || new Date(lead.last_manual_invite_at) >= new Date(lead.last_invite_sent_at))
                  ? `⚠ ${t('Ya se generó una invitación manual el')} ${formatInviteDate(lead.last_manual_invite_at)}`
                  : lead.last_invite_status === 'SENT'
                  ? `⚠ ${t('Ya se invitó el')} ${lead.last_invite_sent_at ? formatInviteDate(lead.last_invite_sent_at) : ''}${lead.last_invite_included_pdf ? ` (${t('con PDF')})` : ''}`
                  : `⚠ ${t('El último intento de invitación falló')}${lead.last_invite_sent_at ? ` (${formatInviteDate(lead.last_invite_sent_at)})` : ''}`
              }
            />
          </div>
        )}
        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}
        {manualDone && (
          <div className="mb-3">
            <Alert
              type="success"
              message={
                copyOk
                  ? t('✅ Mensaje copiado al portapapeles' + (includePdf ? ' y PDF abierto en una pestaña nueva' : '') + '. Pegalo en WhatsApp para enviarlo vos mismo.')
                  : t('✅ Invitación generada' + (includePdf ? ' y PDF abierto en una pestaña nueva' : '') + '. No se pudo copiar solo — seleccioná el texto de abajo y copialo manualmente.')
              }
            />
          </div>
        )}

        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-[#475569]">{t('Mensaje')}</span>
          <div className="flex gap-3">
            <button
              type="button"
              className="text-xs text-[#185FA5] hover:underline"
              onClick={() => { setMessage(buildInviteMessage(effectiveInviteName(lead))); setManualDone(false) }}
            >
              {t('🔀 Variar saludo')}
            </button>
            <button type="button" className="text-xs text-[#185FA5] hover:underline" onClick={handleCopy}>
              {t('📋 Copiar')}
            </button>
          </div>
        </div>
        <textarea
          className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
          rows={7}
          value={message}
          onChange={(e) => { setMessage(e.target.value); setManualDone(false) }}
        />
        <label className="flex items-start gap-2 mt-3 text-xs text-[#475569] cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includePdf}
            onChange={(e) => setIncludePdf(e.target.checked)}
          />
          <span>
            {t('Adjuntar carta de invitación formal en PDF (logo y firma del director médico). Al enviar automático va como caption del archivo; al generar manual, se abre en una pestaña nueva para adjuntarlo vos mismo.')}
          </span>
        </label>
        <p className="text-[11px] text-[#64748B] mt-3">
          {t('El saludo varía cada vez para no mandar el mismo texto a todos — WhatsApp trata los mensajes casi idénticos como spam.')}
        </p>
        <div className="flex justify-end gap-2 mt-4 flex-wrap">
          <button onClick={onClose} className="text-sm text-[#475569] px-4 py-2">
            {manualDone ? t('Cerrar') : t('Cancelar')}
          </button>
          <button
            className="border border-[#185FA5] text-[#185FA5] text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={manualPending}
            title={t('No manda nada por WhatsApp: copia el mensaje y abre el PDF para que lo envíes vos mismo.')}
            onClick={handleGenerateManual}
          >
            {manualPending ? <Spinner size="sm" /> : t('Generar invitación')}
          </button>
          <button
            className="bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={message.length < 5 || inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            {inviteMutation.isPending ? <Spinner size="sm" /> : t('Enviar invitación')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function AdminDoctorLeadsPage() {
  const { t } = useLanguage()
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showMapsSearch, setShowMapsSearch] = useState(false)
  const [showAddLead, setShowAddLead] = useState(false)
  const [inviteTarget, setInviteTarget] = useState<DoctorLead | null>(null)
  // Leads con una invitación recién encolada cuyo resultado (SENT/FAILED)
  // todavía no llegó — el envío real lo hace una tarea de Celery en
  // segundo plano (llamada al microservicio de WhatsApp), así que puede
  // tardar unos segundos más que el POST /invite en sí. Mapea
  // lead.id → timestamp (ms) de cuándo se encoló, para poder expirar la
  // espera si algo se traba.
  const [pendingInvites, setPendingInvites] = useState<Record<string, number>>({})
  // Estado del botón "Generar invitación" directo en la fila (alternativa
  // rápida a abrir el modal "Invitar"): 'pending' mientras copia el
  // mensaje + abre el PDF + deja constancia en el backend, 'done'/'error'
  // unos segundos para mostrar feedback inline, y clipboardOk si el
  // navegador dejó copiar solo (si no, el admin igual puede abrir el
  // modal "Invitar" y copiar el texto a mano desde ahí).
  const [quickManual, setQuickManual] = useState<Record<string, { status: 'pending' | 'done' | 'error'; clipboardOk?: boolean; error?: string }>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'doctor-leads', statusFilter, search, page],
    queryFn: () => adminAPI.listDoctorLeads({
      status: statusFilter || undefined,
      search: search || undefined,
      page,
      page_size: 20,
    }),
    // Mientras haya invitaciones pendientes de confirmar, refrescamos
    // solos cada 2.5s en vez de esperar a que el usuario recargue.
    refetchInterval: Object.keys(pendingInvites).length > 0 ? 2500 : false,
  })

  // Cuando el refetch trae un last_invite_sent_at más nuevo que el
  // momento en que se encoló (o si ya pasaron 25s, para no quedar
  // reintentando para siempre si algo falló silenciosamente), dejamos de
  // esperar por ese lead.
  useEffect(() => {
    if (!data || Object.keys(pendingInvites).length === 0) return
    setPendingInvites((prev) => {
      let changed = false
      const next = { ...prev }
      const now = Date.now()
      for (const [leadId, queuedAt] of Object.entries(prev)) {
        const lead = data.items.find((l: DoctorLead) => l.id === leadId)
        const confirmed = lead?.last_invite_sent_at
          && new Date(lead.last_invite_sent_at).getTime() >= queuedAt - 5000
        const expired = now - queuedAt > 25000
        if (confirmed || expired) {
          delete next[leadId]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [data])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'doctor-leads'] })

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; data: Partial<DoctorLead> }) =>
      adminAPI.updateDoctorLead(vars.id, vars.data),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminAPI.deleteDoctorLead(id),
    onSuccess: invalidate,
  })

  // Botón "Generar invitación" directo en la fila — alternativa a abrir el
  // modal "Invitar" cuando el admin solo quiere el flujo rápido: copiar el
  // mensaje (con saludo variado al azar) y abrir el PDF, sin tocar nada.
  // Si quiere editar el mensaje antes o desmarcar el PDF, sigue pudiendo
  // usar "Invitar" → "Generar invitación" dentro del modal, que hace lo
  // mismo con más control.
  const handleQuickGenerate = async (lead: DoctorLead) => {
    setQuickManual((prev) => ({ ...prev, [lead.id]: { status: 'pending' } }))
    const message = buildInviteMessage(effectiveInviteName(lead))
    let clipboardOk = false
    try {
      try {
        await navigator.clipboard.writeText(message)
        clipboardOk = true
      } catch {
        // Sin permiso de portapapeles: seguimos igual, el admin puede
        // abrir "Invitar" y copiar el texto a mano desde el modal.
      }
      const blob = await adminAPI.getDoctorLeadInvitationPdf(lead.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')

      await adminAPI.generateManualDoctorLeadInvite(lead.id)
      invalidate()
      setQuickManual((prev) => ({ ...prev, [lead.id]: { status: 'done', clipboardOk } }))
    } catch (err) {
      setQuickManual((prev) => ({ ...prev, [lead.id]: { status: 'error', error: getErrorMessage(err) } }))
    } finally {
      setTimeout(() => {
        setQuickManual((prev) => {
          if (!prev[lead.id] || prev[lead.id].status === 'pending') return prev
          const next = { ...prev }
          delete next[lead.id]
          return next
        })
      }, 6000)
    }
  }

  const funnel = data?.funnel

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/doctor-leads" role="ADMIN">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <SectionTitle>{t('Captación de médicos')}</SectionTitle>
        <div className="flex gap-2">
          <button
            className="border border-[#185FA5] text-[#185FA5] text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#E6F1FB]"
            onClick={() => setShowAddLead(true)}
          >
            {t('+ Agregar prospecto')}
          </button>
          <button
            className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2 rounded-lg"
            onClick={() => setShowMapsSearch(true)}
          >
            {t('🔍 Buscar en Google Maps')}
          </button>
        </div>
      </div>

      {/* Resumen del embudo */}
      {funnel && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
          {(Object.keys(STATUS_LABELS) as DoctorLeadStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(statusFilter === s ? '' : s); setPage(1) }}
              className={`rounded-xl border p-3 text-left transition-colors ${
                statusFilter === s ? 'border-[#185FA5] bg-[#E6F1FB]' : 'border-[#DDE1EE] bg-white'
              }`}
            >
              <p className="text-xl font-semibold text-[#141820]">{funnel[s] ?? 0}</p>
              <p className="text-xs text-[#475569]">{STATUS_LABELS[s]}</p>
            </button>
          ))}
        </div>
      )}

      {/* Búsqueda */}
      <div className="mb-3">
        <input
          className="w-full sm:w-80 border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
          placeholder={t('Buscar por nombre o teléfono...')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
      </div>

      {isLoading && <LoadingScreen text={t('Cargando prospectos...')} />}

      {!isLoading && data?.items.length === 0 && (
        <EmptyState
          title={t('Sin prospectos todavía')}
          description={t('Busca médicos en Google Maps o agrega uno manualmente para empezar')}
        />
      )}

      {!isLoading && data && data.items.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#DDE1EE] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F5F6FA] text-[#475569] text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t('Nombre')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Nombre para invitación')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Especialidad')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Ciudad')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Teléfono')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Estado')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Invitación')}</th>
                <th className="text-right px-4 py-2 font-medium">{t('Acciones')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((lead) => {
                const quick = quickManual[lead.id]
                const inviteDisabled = !lead.phone || lead.status === 'NO_CONTACTAR'
                return (
                <tr key={lead.id} className="border-t border-[#DDE1EE] align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#141820]">{lead.full_name}</p>
                    {lead.clinic_or_hospital && (
                      <p className="text-xs text-[#64748B]">{lead.clinic_or_hospital}</p>
                    )}
                    {lead.maps_url && (
                      <a href={lead.maps_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-[#185FA5] hover:underline">
                        {t('Ver en Maps ↗')}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <InviteNameCell
                      lead={lead}
                      onSave={(value) => updateMutation.mutate({ id: lead.id, data: { invite_name: value || null } })}
                    />
                  </td>
                  <td className="px-4 py-3 text-[#475569]">{lead.specialty || '—'}</td>
                  <td className="px-4 py-3 text-[#475569]">{lead.city || '—'}</td>
                  <td className="px-4 py-3 text-[#475569]">{lead.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <select
                      className="text-xs border border-[#DDE1EE] rounded-md px-1.5 py-1"
                      value={lead.status}
                      onChange={(e) => updateMutation.mutate({ id: lead.id, data: { status: e.target.value as DoctorLeadStatus } })}
                    >
                      {(Object.keys(STATUS_LABELS) as DoctorLeadStatus[]).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <InviteStatusBadge lead={lead} isPending={!!pendingInvites[lead.id]} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <button
                        className="text-xs font-medium text-[#0F6E56] border border-[#0F6E56] rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={inviteDisabled || !!pendingInvites[lead.id]}
                        title={!lead.phone ? t('Este prospecto no tiene teléfono') : ''}
                        onClick={() => setInviteTarget(lead)}
                      >
                        {lead.last_invite_status || lead.last_manual_invite_at ? t('Reinvitar') : t('Invitar')}
                      </button>
                      <button
                        className="text-xs font-medium text-[#185FA5] border border-[#185FA5] rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={inviteDisabled || quick?.status === 'pending'}
                        title={t('No manda nada por WhatsApp: copia el mensaje y abre el PDF para que lo envíes vos mismo.')}
                        onClick={() => handleQuickGenerate(lead)}
                      >
                        {quick?.status === 'pending' ? <Spinner size="sm" /> : t('📋 Generar invitación')}
                      </button>
                      <button
                        className="text-xs text-[#A32D2D] hover:underline"
                        onClick={() => { if (confirm(t('¿Eliminar este prospecto?'))) deleteMutation.mutate(lead.id) }}
                      >
                        {t('Eliminar')}
                      </button>
                    </div>
                    {quick?.status === 'done' && (
                      <p className="text-[10px] text-[#0F6E56] text-right mt-1">
                        {quick.clipboardOk
                          ? t('✅ Copiado y PDF abierto')
                          : t('✅ PDF abierto (copiá el texto desde "Invitar")')}
                      </p>
                    )}
                    {quick?.status === 'error' && (
                      <p className="text-[10px] text-[#A32D2D] text-right mt-1">{quick.error}</p>
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          {/* Paginación simple */}
          {data.total > data.page_size && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#DDE1EE] text-xs text-[#475569]">
              <span>{t('Página')} {data.page} · {data.total} {t('prospectos')}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">
                  {t('Anterior')}
                </button>
                <button
                  disabled={page * data.page_size >= data.total}
                  onClick={() => setPage((p) => p + 1)}
                  className="disabled:opacity-40"
                >
                  {t('Siguiente')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showMapsSearch && (
        <MapsSearchModal onClose={() => setShowMapsSearch(false)} onImported={invalidate} />
      )}
      {showAddLead && (
        <AddLeadModal onClose={() => setShowAddLead(false)} onCreated={() => { setShowAddLead(false); invalidate() }} />
      )}
      {inviteTarget && (
        <InviteModal
          lead={inviteTarget}
          onClose={() => setInviteTarget(null)}
          onSent={() => {
            setPendingInvites((prev) => ({ ...prev, [inviteTarget.id]: Date.now() }))
            setInviteTarget(null)
            invalidate()
          }}
          onManualGenerated={() => {
            // A diferencia de onSent, NO cerramos el modal: el admin
            // todavía necesita el mensaje visible para pegarlo en
            // WhatsApp (y puede querer generar el PDF sin PDF, variar el
            // saludo de nuevo, etc.). Cierra él mismo con "Cerrar" cuando
            // termine.
            invalidate()
          }}
        />
      )}
    </DashboardLayout>
  )
}
