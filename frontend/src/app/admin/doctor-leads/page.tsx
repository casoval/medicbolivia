'use client'
// src/app/admin/doctor-leads/page.tsx
// Captación de médicos: buscar en Google Maps + gestionar prospectos
// (leads) hasta invitarlos por WhatsApp a probar la plataforma.

import { useState, useEffect } from 'react'
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

const DEFAULT_INVITE_MESSAGE = (name: string) =>
  `Hola${name ? ' Dr./Dra. ' + name : ''}, le escribimos de MedicBolivia 👋\n\n` +
  `Somos una plataforma de telemedicina en Bolivia donde agentes de inteligencia artificial ` +
  `reciben, orientan y conectan al paciente con usted, y nos encantaría invitarle a probarla ` +
  `sin costo. Con ella puede atender consultas en línea, gestionar su agenda y recetar ` +
  `de forma digital.\n\n¿Le interesaría que le contemos más?\n\nhttps://medicbolivia.com`

// ── Modal: buscar en Google Maps ──
function MapsSearchModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState(DEPARTMENTS[0])
  const [city, setCity] = useState(BOLIVIA_CITIES[DEPARTMENTS[0]][0])
  const [error, setError] = useState('')
  const [importingId, setImportingId] = useState<string | null>(null)

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
      onImported()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setImportingId(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#DDE1EE]">
          <p className="text-sm font-semibold">{t('Buscar médicos en Google Maps')}</p>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl">✕</button>
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
            <p className="text-sm text-[#6B738A] text-center py-8">
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
                  {place.address && <p className="text-xs text-[#6B738A] mt-0.5">{place.address}</p>}
                  {place.rating != null && (
                    <p className="text-xs text-[#A0A8BF] mt-0.5">
                      ⭐ {place.rating} ({place.user_rating_count ?? 0})
                    </p>
                  )}
                </div>
                {place.already_imported ? (
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
    </div>
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
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
          <button onClick={onClose} className="text-sm text-[#6B738A] px-4 py-2">{t('Cancelar')}</button>
          <button
            className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={form.full_name.length < 2 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <Spinner size="sm" /> : t('Guardar')}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
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

  if (!lead.last_invite_status) {
    return <span className="text-xs text-[#A0A8BF]">{t('Sin invitar')}</span>
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
        <span className="text-[10px] text-[#A0A8BF]">{formatInviteDate(lead.last_invite_sent_at)}</span>
      )}
    </div>
  )
}

// ── Modal: invitar por WhatsApp ──
function InviteModal({ lead, onClose, onSent }: { lead: DoctorLead; onClose: () => void; onSent: () => void }) {
  const { t } = useLanguage()
  const [message, setMessage] = useState(DEFAULT_INVITE_MESSAGE(lead.full_name))
  const [includePdf, setIncludePdf] = useState(true)
  const [error, setError] = useState('')

  const inviteMutation = useMutation({
    mutationFn: () => adminAPI.inviteDoctorLead(lead.id, message, includePdf),
    onSuccess: onSent,
    onError: (err) => setError(getErrorMessage(err)),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-1">{t('Invitar por WhatsApp')}</p>
        <p className="text-xs text-[#6B738A] mb-4">{lead.full_name} · {lead.phone}</p>
        {lead.last_invite_status && (
          <div className="mb-3">
            <Alert
              type={lead.last_invite_status === 'SENT' ? 'info' : 'error'}
              message={
                lead.last_invite_status === 'SENT'
                  ? `⚠ ${t('Ya se invitó el')} ${lead.last_invite_sent_at ? formatInviteDate(lead.last_invite_sent_at) : ''}${lead.last_invite_included_pdf ? ` (${t('con PDF')})` : ''}`
                  : `⚠ ${t('El último intento de invitación falló')}${lead.last_invite_sent_at ? ` (${formatInviteDate(lead.last_invite_sent_at)})` : ''}`
              }
            />
          </div>
        )}
        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}
        <textarea
          className="w-full border border-[#DDE1EE] rounded-lg px-3 py-2 text-sm"
          rows={7}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <label className="flex items-start gap-2 mt-3 text-xs text-[#6B738A] cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includePdf}
            onChange={(e) => setIncludePdf(e.target.checked)}
          />
          <span>
            {t('Adjuntar carta de invitación formal en PDF (logo y firma del director médico). El texto de arriba se envía como mensaje junto al archivo.')}
          </span>
        </label>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm text-[#6B738A] px-4 py-2">{t('Cancelar')}</button>
          <button
            className="bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            disabled={message.length < 5 || inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            {inviteMutation.isPending ? <Spinner size="sm" /> : t('Enviar invitación')}
          </button>
        </div>
      </div>
    </div>
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
              <p className="text-xs text-[#6B738A]">{STATUS_LABELS[s]}</p>
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
          <table className="w-full text-sm">
            <thead className="bg-[#F5F6FA] text-[#6B738A] text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{t('Nombre')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Especialidad')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Ciudad')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Teléfono')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Estado')}</th>
                <th className="text-left px-4 py-2 font-medium">{t('Invitación')}</th>
                <th className="text-right px-4 py-2 font-medium">{t('Acciones')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((lead) => (
                <tr key={lead.id} className="border-t border-[#DDE1EE] align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#141820]">{lead.full_name}</p>
                    {lead.clinic_or_hospital && (
                      <p className="text-xs text-[#A0A8BF]">{lead.clinic_or_hospital}</p>
                    )}
                    {lead.maps_url && (
                      <a href={lead.maps_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-[#185FA5] hover:underline">
                        {t('Ver en Maps ↗')}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6B738A]">{lead.specialty || '—'}</td>
                  <td className="px-4 py-3 text-[#6B738A]">{lead.city || '—'}</td>
                  <td className="px-4 py-3 text-[#6B738A]">{lead.phone || '—'}</td>
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
                        disabled={!lead.phone || lead.status === 'NO_CONTACTAR' || !!pendingInvites[lead.id]}
                        title={!lead.phone ? t('Este prospecto no tiene teléfono') : ''}
                        onClick={() => setInviteTarget(lead)}
                      >
                        {lead.last_invite_status ? t('Reinvitar') : t('Invitar')}
                      </button>
                      <button
                        className="text-xs text-[#A32D2D] hover:underline"
                        onClick={() => { if (confirm(t('¿Eliminar este prospecto?'))) deleteMutation.mutate(lead.id) }}
                      >
                        {t('Eliminar')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Paginación simple */}
          {data.total > data.page_size && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#DDE1EE] text-xs text-[#6B738A]">
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
        />
      )}
    </DashboardLayout>
  )
}
