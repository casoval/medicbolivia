'use client'
// src/app/admin/professionals/page.tsx — con filtro ciudad, contadores en tabs, mas datos y documentos de verificación
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { StatusBadge, LoadingScreen, Alert } from '@/components/ui'
import { api, adminAPI, specialtiesAPI, getErrorMessage, type CommissionPeriod, type CatalogItem, type ProfessionalMembership } from '@/lib/api'
import { ConsultationHistorySection } from '@/components/admin/ConsultationHistorySection'

// ── Selector de fecha en español, semana empieza en lunes ──────────────
// El <input type="date"> nativo usa el idioma/región del SISTEMA
// OPERATIVO del usuario, no el idioma de la página (por eso salía en
// inglés con domingo primero aunque <html lang="es">) — no hay forma
// confiable de forzar eso vía HTML/CSS en todos los navegadores. Este
// componente reemplaza el input nativo para tener control total.
const ES_MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const ES_DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function fmtDateEs(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} de ${ES_MESES[m - 1]} de ${y}`
}

function SpanishDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const today = new Date()
  const [viewY, setViewY] = useState(value ? Number(value.split('-')[0]) : today.getFullYear())
  const [viewM, setViewM] = useState(value ? Number(value.split('-')[1]) - 1 : today.getMonth())

  const firstOfMonth = new Date(viewY, viewM, 1)
  // getDay(): 0=domingo..6=sábado. Convertimos a 0=lunes..6=domingo.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate()

  function pad(n: number) { return String(n).padStart(2, '0') }
  function pick(day: number) {
    onChange(`${viewY}-${pad(viewM + 1)}-${pad(day)}`)
    setOpen(false)
  }
  function changeMonth(delta: number) {
    let m = viewM + delta, y = viewY
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setViewM(m); setViewY(y)
  }

  const selectedDay = value && Number(value.split('-')[0]) === viewY && Number(value.split('-')[1]) - 1 === viewM
    ? Number(value.split('-')[2])
    : null

  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm text-left bg-white">
        {value ? fmtDateEs(value) : 'Elegir fecha…'}
      </button>
      {open && (
        <div className="mt-1 border border-[#DDE1EE] rounded-lg bg-white p-2 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => changeMonth(-1)} className="px-2 text-[#6B738A] hover:text-[#185FA5]">‹</button>
            <span className="text-xs font-semibold text-[#3A4256] capitalize">{ES_MESES[viewM]} {viewY}</span>
            <button type="button" onClick={() => changeMonth(1)} className="px-2 text-[#6B738A] hover:text-[#185FA5]">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {ES_DIAS_CORTOS.map((d) => (
              <span key={d} className="text-[10px] text-[#A0A8BF]">{d}</span>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const isSelected = selectedDay === day
              return (
                <button type="button" key={day} onClick={() => pick(day)}
                  className={`text-xs rounded-md py-1 ${isSelected ? 'bg-[#185FA5] text-white' : 'hover:bg-[#F5F6FA] text-[#3A4256]'}`}>
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const DEPARTMENTS = ['Todos','La Paz','Santa Cruz','Cochabamba','Oruro','Potosi','Tarija','Beni','Pando','Chuquisaca']

const DOC_LABELS: Record<string, string> = {
  CI_FRONT: 'Cédula (frente)',
  CI_BACK: 'Cédula (dorso)',
  PROFESSIONAL_TITLE: 'Título profesional',
  ACADEMIC_DIPLOMA: 'Diploma académico',
  HEALTH_MINISTRY: 'Registro Min. Salud',
  SEDES_REGISTRATION: 'Registro SEDES',
  CMB_MATRICULA: 'Matrícula CMB',
  SPECIALTY_CERT: 'Respaldo de Especialidad y/o Subespecialidad',
  SELFIE_WITH_CI: 'Selfie con cédula',
}

const REQUIRED_DOC_TYPES = ['CI_FRONT', 'CI_BACK', 'PROFESSIONAL_TITLE', 'SEDES_REGISTRATION', 'CMB_MATRICULA', 'SPECIALTY_CERT']

interface ProfessionalDocItem {
  id: string
  doc_type: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  url: string
  review_note?: string | null
  reviewed_at?: string | null
  created_at: string
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().split('?')[0].endsWith('.pdf')
}

interface DocCounts {
  pending: number
  approved: number
  rejected: number
  total: number
}

interface PenaltyBreakdown {
  no_show: number
  immediate_rejected: number
  late_cancel: number
  missing_clinical_note: number
  low_rating: number
}

interface PenaltyInfo {
  score: number
  color: 'yellow' | 'orange' | 'red' | null
  breakdown: PenaltyBreakdown
  since: string | null   // null = cuenta todo el historial; si no, fecha del último reset
}

const PENALTY_META: Record<'yellow' | 'orange' | 'red', { label: string; dot: string; badge: string }> = {
  yellow: { label: 'Leve',     dot: 'bg-[#EAB308]', badge: 'bg-[#FEF9E7] text-[#8A6D0B] border-[#F0D88A]' },
  orange: { label: 'Moderado', dot: 'bg-[#F97316]', badge: 'bg-[#FFF1E6] text-[#9A4E13] border-[#F5B885]' },
  red:    { label: 'Grave',    dot: 'bg-[#DC2626]', badge: 'bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]' },
}

const PENALTY_LABELS: Record<keyof PenaltyBreakdown, string> = {
  no_show:               'Inasistencias a consultas programadas',
  immediate_rejected:    'Consultas inmediatas rechazadas o expiradas',
  late_cancel:           'Cancelaciones tardías con reembolso',
  missing_clinical_note: 'Consultas sin historia clínica',
  low_rating:            'Calificaciones de 1-2 estrellas',
}

interface Professional {
  id: string; name: string; specialty: string; status: string; availability: string
  rating: number; total_ratings: number; total_consultations: number; created_at: string
  bio?: string; languages?: string[]; years_experience?: number; cmb_matricula?: string
  sedes_number?: string; price_general?: number; price_urgent?: number; price_follow_up?: number
  phone?: string; email?: string; ci?: string; birth_date?: string; department?: string; gender?: string
  user_status?: string; photo_url?: string | null; sub_specialties?: string[]; doc_counts?: DocCounts
  penalty?: PenaltyInfo
}

function getAge(birthDate?: string): number | null {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25*24*60*60*1000))
}

function DocBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:  'bg-[#FEF3E0] text-[#854F0B] border-[#F2D49A]',
    APPROVED: 'bg-[#E1F5EE] text-[#0F6E56] border-[#9FE1CB]',
    REJECTED: 'bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]',
  }
  const text: Record<string, string> = { PENDING: 'Pendiente', APPROVED: 'Aprobado', REJECTED: 'Rechazado' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${map[status] || map.PENDING}`}>
      {text[status] || status}
    </span>
  )
}

function isRecentlyUploaded(createdAt: string): boolean {
  const hoursSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
  return hoursSince < 24
}

function DocThumbnail({ doc, onExpand, onReview, reviewing }: {
  doc: ProfessionalDocItem
  onExpand: () => void
  onReview: (status: 'APPROVED' | 'REJECTED') => void
  reviewing: boolean
}) {
  const pdf = isPdfUrl(doc.url)
  const isNew = doc.status === 'PENDING' && isRecentlyUploaded(doc.created_at)
  return (
    <div className={`border rounded-xl p-2.5 flex flex-col gap-2 relative ${
      isNew ? 'border-[#185FA5] ring-1 ring-[#85B7EB]' : 'border-[#DDE1EE]'
    }`}>
      {isNew && (
        <span className="absolute -top-2 -right-2 bg-[#185FA5] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
          Nuevo
        </span>
      )}
      <button
        onClick={onExpand}
        className="w-full h-24 rounded-lg overflow-hidden bg-[#F5F6FA] flex items-center justify-center group relative"
      >
        {pdf ? (
          <div className="flex flex-col items-center gap-1 text-[#6B738A]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
            <span className="text-[10px] font-medium">PDF</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.url} alt={DOC_LABELS[doc.doc_type] || doc.doc_type} className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 text-white text-[10px] font-medium transition-opacity">Ver completo</span>
        </div>
      </button>
      <div>
        <p className="text-xs font-medium leading-tight">{DOC_LABELS[doc.doc_type] || doc.doc_type}</p>
        <div className="mt-1"><DocBadge status={doc.status} /></div>
        {doc.status === 'REJECTED' && doc.review_note && (
          <p className="text-[10px] text-[#A32D2D] mt-1 leading-tight">{doc.review_note}</p>
        )}
      </div>
      {doc.status !== 'APPROVED' && (
        <div className="flex gap-1.5">
          <button
            onClick={() => onReview('APPROVED')}
            disabled={reviewing}
            className="flex-1 bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] py-1 rounded-md text-[10px] font-medium disabled:opacity-50"
          >
            Aprobar
          </button>
          <button
            onClick={() => onReview('REJECTED')}
            disabled={reviewing}
            className="flex-1 bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] py-1 rounded-md text-[10px] font-medium disabled:opacity-50"
          >
            Rechazar
          </button>
        </div>
      )}
      {doc.status === 'APPROVED' && (
        <button
          onClick={() => onReview('REJECTED')}
          disabled={reviewing}
          className="text-[10px] text-[#A0A8BF] hover:text-[#A32D2D] disabled:opacity-50"
        >
          Revertir aprobación
        </button>
      )}
    </div>
  )
}

function DocViewerModal({ doc, onClose }: { doc: ProfessionalDocItem; onClose: () => void }) {
  const pdf = isPdfUrl(doc.url)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#DDE1EE]">
          <p className="text-sm font-semibold">{DOC_LABELS[doc.doc_type] || doc.doc_type}</p>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-auto bg-[#F5F6FA] flex items-center justify-center p-4">
          {pdf ? (
            <iframe src={doc.url} className="w-full h-[70vh] rounded-lg bg-white" title={doc.doc_type} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.url} alt={doc.doc_type} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
          )}
        </div>
        <div className="p-3 border-t border-[#DDE1EE] flex justify-end">
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#185FA5] hover:underline">
            Abrir en pestaña nueva ↗
          </a>
        </div>
      </div>
    </div>
  )
}

interface PenaltyDetailItem {
  consultation_id: string
  date: string
  patient_name: string
  reason: keyof PenaltyBreakdown
  reason_label: string
  weight: number
}

function PenaltyDetailSection({ professionalId, penalty }: { professionalId: string; penalty: PenaltyInfo }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'professionals', professionalId, 'penalty-detail'],
    queryFn: () => api.get(`/admin/professionals/${professionalId}/penalty-detail`).then(r => r.data as { since: string | null; items: PenaltyDetailItem[] }),
    enabled: expanded,
  })

  const resetMutation = useMutation({
    mutationFn: () => api.post(`/admin/professionals/${professionalId}/reset-penalties`),
    onSuccess: () => {
      setConfirmingReset(false)
      qc.invalidateQueries({ queryKey: ['admin', 'professionals', 'all'] })
      qc.invalidateQueries({ queryKey: ['admin', 'professionals', professionalId, 'penalty-detail'] })
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">
          Penalizaciones {penalty.since ? `· desde ${new Date(penalty.since).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })}` : '· historial completo'}
        </p>
      </div>

      <div className={`rounded-xl p-3 border ${PENALTY_META[penalty.color!].badge}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${PENALTY_META[penalty.color!].dot}`} />
            {PENALTY_META[penalty.color!].label}
          </span>
          <span className="text-sm font-bold">{penalty.score} pts</span>
        </div>
        <ul className="space-y-1 mb-2">
          {(Object.keys(PENALTY_LABELS) as (keyof PenaltyBreakdown)[])
            .filter((k) => penalty.breakdown[k] > 0)
            .map((k) => (
              <li key={k} className="text-xs flex items-center justify-between">
                <span>{PENALTY_LABELS[k]}</span>
                <span className="font-medium">×{penalty.breakdown[k]}</span>
              </li>
            ))}
        </ul>

        <div className="flex items-center gap-2 pt-2 border-t border-black/10">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium underline underline-offset-2 hover:opacity-70"
          >
            {expanded ? 'Ocultar detalle' : 'Ver qué consultas la generan'}
          </button>
          <span className="flex-1" />
          {!confirmingReset ? (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg bg-white/70 hover:bg-white transition-colors"
            >
              🧹 Limpiar penalizaciones
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs">¿Seguro?</span>
              <button
                type="button"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="text-xs font-medium px-2 py-1 rounded-lg bg-[#0F6E56] text-white hover:bg-[#0B5643] transition-colors"
              >
                {resetMutation.isPending ? 'Limpiando...' : 'Sí, limpiar'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="text-xs font-medium px-2 py-1 rounded-lg bg-white/70 hover:bg-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
          {isLoading && <p className="text-xs text-[#6B738A] text-center py-3">Cargando detalle...</p>}
          {!isLoading && data?.items.length === 0 && (
            <p className="text-xs text-[#6B738A] text-center py-3">No hay consultas penalizadas en este período.</p>
          )}
          {!isLoading && data?.items.map((item, i) => (
            <div key={`${item.consultation_id}-${item.reason}-${i}`} className="bg-[#F5F6FA] rounded-lg p-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{item.patient_name}</p>
                <p className="text-[10px] text-[#6B738A]">
                  {new Date(item.date).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })} · {item.reason_label}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-[#A32D2D] flex-shrink-0">+{item.weight} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProfessionalDocsSection({ professionalId }: { professionalId: string }) {
  const qc = useQueryClient()
  const [expandedDoc, setExpandedDoc] = useState<ProfessionalDocItem | null>(null)
  const [docError, setDocError] = useState('')

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['admin', 'professionals', professionalId, 'documents'],
    queryFn: () => api.get(`/admin/professionals/${professionalId}/documents`).then(r => r.data as ProfessionalDocItem[]),
    refetchInterval: 12000, // así el admin ve sin recargar cuando el profesional sube/reemplaza un doc
  })

  const reviewMutation = useMutation({
    mutationFn: ({ docId, status }: { docId: string; status: 'APPROVED' | 'REJECTED' }) => {
      const review_note = status === 'REJECTED' ? window.prompt('Motivo del rechazo (visible para el profesional):') || '' : null
      return api.patch(`/admin/documents/${docId}/review`, { status, review_note })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'professionals', professionalId, 'documents'] })
      qc.invalidateQueries({ queryKey: ['admin', 'professionals', 'all'] })
    },
    onError: (err) => setDocError(getErrorMessage(err)),
  })

  if (isLoading) {
    return <p className="text-xs text-[#6B738A] py-4 text-center">Cargando documentos...</p>
  }

  const missing = REQUIRED_DOC_TYPES.filter((t) => !docs.some((d) => d.doc_type === t))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">Documentos de verificación</p>
        <span className="text-[10px] text-[#A0A8BF]">{docs.length} subido{docs.length !== 1 ? 's' : ''}</span>
      </div>

      {docError && <div className="mb-2"><Alert type="error" message={docError} /></div>}

      {docs.length === 0 ? (
        <p className="text-sm text-[#6B738A] bg-[#F5F6FA] rounded-xl p-3 text-center">
          Este profesional todavía no subió ningún documento
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {docs.map((doc) => (
            <DocThumbnail
              key={doc.id}
              doc={doc}
              onExpand={() => setExpandedDoc(doc)}
              onReview={(status) => reviewMutation.mutate({ docId: doc.id, status })}
              reviewing={reviewMutation.isPending}
            />
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <p className="text-[10px] text-[#A0A8BF] mt-2">
          Falta subir: {missing.map((t) => DOC_LABELS[t] || t).join(', ')}
        </p>
      )}

      {expandedDoc && <DocViewerModal doc={expandedDoc} onClose={() => setExpandedDoc(null)} />}
    </div>
  )
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Comisión INDIVIDUAL para este profesional puntual: puede ser PERMANENTE
// (ej. "este profesional siempre paga 20%, sin importar la comisión global")
// o una PROMOCIÓN con fecha de inicio/fin (ej. "5% los primeros 3 meses").
// Si no hay ninguna activa, se le aplica la comisión global de la plataforma
// (o la promo global vigente, si hay una).
function ProfessionalCommissionSection({ professionalId }: { professionalId: string }) {
  const [periods, setPeriods] = useState<CommissionPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState(false)

  const [mode, setMode] = useState<'permanent' | 'promo'>('permanent')
  const [percent, setPercent] = useState('20')
  const [label, setLabel] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')

  function load() {
    setLoading(true)
    adminAPI.listCommissionPeriods({ professional_id: professionalId, scope: 'PROFESSIONAL' })
      .then(setPeriods)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [professionalId])

  async function createPeriod() {
    setError('')
    const p = Number(percent)
    if (Number.isNaN(p) || p < 0 || p > 100) {
      setError('El porcentaje debe estar entre 0 y 100')
      return
    }
    // Permanente: arranca hoy y no tiene fecha de fin.
    // Promoción: el admin elige desde/hasta explícitamente.
    if (mode === 'promo' && !startsAt) {
      setError('Indica la fecha de inicio de la promoción')
      return
    }
    const effectiveStartsAt = mode === 'permanent'
      ? new Date().toISOString()
      : new Date(startsAt).toISOString()
    const effectiveEndsAt = mode === 'permanent'
      ? null
      : (endsAt ? new Date(endsAt).toISOString() : null)

    setCreating(true)
    try {
      await adminAPI.createCommissionPeriod({
        scope: 'PROFESSIONAL',
        professional_id: professionalId,
        percent: p,
        label: label || (mode === 'permanent' ? 'Comisión fija' : undefined),
        starts_at: effectiveStartsAt,
        ends_at: effectiveEndsAt,
      })
      setLabel(''); setStartsAt(''); setEndsAt('')
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  async function deactivate(id: string) {
    try {
      await adminAPI.deactivateCommissionPeriod(id)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const now = Date.now()
  const current = periods.find((p) => {
    if (!p.active) return false
    const started = new Date(p.starts_at).getTime()
    const ended = p.ends_at ? new Date(p.ends_at).getTime() : null
    return started <= now && (!ended || ended > now)
  })
  const currentIsPermanent = !!current && !current.ends_at

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">Comisión individual</p>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-[#185FA5] hover:underline">
          {open ? 'Ocultar' : current ? 'Editar' : 'Configurar'}
        </button>
      </div>

      {current ? (
        <div className="bg-[#E1F5EE] rounded-lg px-3 py-2 mb-2">
          <p className="text-xs text-[#0F6E56]">
            Este profesional tiene una comisión {currentIsPermanent ? 'fija (permanente)' : 'promocional'} del{' '}
            <span className="font-semibold">{current.percent}%</span>
            {current.label ? ` (${current.label})` : ''}
            {currentIsPermanent ? '.' : current.ends_at ? ` vigente hasta el ${fmtDate(current.ends_at)}.` : ' vigente.'}
          </p>
        </div>
      ) : (
        <p className="text-xs text-[#A0A8BF] mb-2">Sin comisión individual — usa la comisión general de la plataforma.</p>
      )}

      {open && (
        <div className="bg-[#F5F6FA] rounded-lg p-3 space-y-2">
          {error && <div><Alert type="error" message={error} /></div>}

          <div className="flex rounded-lg overflow-hidden border border-[#DDE1EE] text-xs">
            <button
              onClick={() => setMode('permanent')}
              className={`flex-1 py-1.5 ${mode === 'permanent' ? 'bg-[#185FA5] text-white' : 'bg-white text-[#6B738A]'}`}
            >
              Permanente
            </button>
            <button
              onClick={() => setMode('promo')}
              className={`flex-1 py-1.5 ${mode === 'promo' ? 'bg-[#185FA5] text-white' : 'bg-white text-[#6B738A]'}`}
            >
              Promoción con fecha
            </button>
          </div>
          <p className="text-[10px] text-[#A0A8BF]">
            {mode === 'permanent'
              ? 'Aplica desde hoy y no tiene fecha de fin. Reemplaza la comisión general para este profesional hasta que la desactives.'
              : 'Aplica solo entre las fechas indicadas (ej. "5% los primeros 3 meses"). Al terminar, vuelve a aplicarse la comisión permanente o la general.'}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-[#6B738A] mb-1">% comisión</label>
              <input type="number" min={0} max={100} value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[#6B738A] mb-1">Etiqueta (opcional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder={mode === 'permanent' ? 'Comisión fija' : 'Bienvenida'}
                className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
            </div>
            {mode === 'promo' && (
              <>
                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Desde</label>
                  <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Hasta (opcional)</label>
                  <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
                </div>
              </>
            )}
          </div>
          <button onClick={createPeriod} disabled={creating}
            className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60">
            {creating ? 'Guardando…' : mode === 'permanent' ? 'Fijar comisión permanente' : 'Crear promoción individual'}
          </button>

          {!loading && periods.length > 0 && (
            <div className="pt-2 border-t border-[#DDE1EE] space-y-1">
              {periods.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span>
                    {p.percent}% {p.label && `— ${p.label}`} · desde {fmtDate(p.starts_at)}
                    {p.ends_at ? ` hasta ${fmtDate(p.ends_at)}` : ' · permanente'}
                    {!p.active && ' (desactivada)'}
                  </span>
                  {p.active && (
                    <button onClick={() => deactivate(p.id)} className="text-[#A32D2D] hover:underline">
                      Desactivar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Membresía mensual (comisión 0% + agendamiento directo de pacientes
// vinculados). A diferencia de la comisión individual (arriba), esto NO se
// cobra dentro de la plataforma — el admin la activa manualmente cuando
// confirma que el profesional pagó por fuera, y queda un registro por mes.
function ProfessionalMembershipSection({ professionalId }: { professionalId: string }) {
  const [memberships, setMemberships] = useState<ProfessionalMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [open, setOpen] = useState(false)

  const [periodLabel, setPeriodLabel] = useState('')
  const [note, setNote] = useState('')
  // 'today' = arranca hoy; 'custom' = el admin elige la fecha de inicio.
  const [startMode, setStartMode] = useState<'today' | 'custom'>('today')
  const [customStart, setCustomStart] = useState('')
  const [months, setMonths] = useState(1)

  const [renewMonths, setRenewMonths] = useState(1)

  function load() {
    setLoading(true)
    adminAPI.listMemberships(professionalId)
      .then(setMemberships)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [professionalId])

  // El backend ya calcula is_current; no lo recalculamos a mano acá para
  // no desincronizarnos si cambia la regla de vigencia.
  const current = memberships.find((m) => m.is_current)

  async function enableMembership() {
    setError('')
    if (startMode === 'custom' && !customStart) {
      setError('Elige la fecha de inicio o usa "Empezar hoy"')
      return
    }
    if (months < 1) {
      setError('Mínimo 1 mes')
      return
    }
    setCreating(true)
    try {
      await adminAPI.createMembership({
        professional_id: professionalId,
        period_label: periodLabel.trim() || undefined,
        starts_at: startMode === 'custom' ? `${customStart}T00:00:00` : undefined,
        months,
        note: note || undefined,
      })
      setPeriodLabel(''); setNote(''); setCustomStart(''); setStartMode('today'); setMonths(1)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  async function renewMembership(id: string) {
    setError('')
    if (renewMonths < 1) {
      setError('Mínimo 1 mes')
      return
    }
    setRenewing(true)
    try {
      // El backend rechaza esto si la membresía ya venció: en ese caso
      // hay que dar de alta una nueva (no se puede "revivir" una vencida).
      await adminAPI.renewMembership(id, { months: renewMonths })
      setRenewMonths(1)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRenewing(false)
    }
  }

  async function disableMembership(id: string) {
    try {
      await adminAPI.updateMembership(id, { active: false, ends_at: new Date().toISOString() })
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">Membresía mensual</p>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-[#185FA5] hover:underline">
          {open ? 'Ocultar' : current ? 'Ver / deshabilitar' : 'Habilitar'}
        </button>
      </div>

      {current ? (
        <div className="bg-[#FFF4E0] rounded-lg px-3 py-2 mb-2">
          <p className="text-xs text-[#8A5A00]">
            Membresía <span className="font-semibold">activa</span>{current.period_label ? ` (${current.period_label})` : ''} — comisión 0% y puede
            agendar directamente a sus pacientes vinculados.
            {current.ends_at ? ` Vigente hasta el ${fmtDate(current.ends_at)}.` : ''}
          </p>
        </div>
      ) : (
        <p className="text-xs text-[#A0A8BF] mb-2">Sin membresía activa — paga comisión normal por cada consulta.</p>
      )}

      {open && (
        <div className="bg-[#F5F6FA] rounded-lg p-3 space-y-2">
          {error && <div><Alert type="error" message={error} /></div>}

          {current ? (
            <>
              <p className="text-[10px] text-[#A0A8BF]">
                {current.ends_at
                  ? `Sigue vigente hasta el ${fmtDate(current.ends_at)} — puedes renovarla desde ya (se suma a esa fecha) o deshabilitarla antes de tiempo.`
                  : 'No tiene fecha de vencimiento (indefinida) — puedes deshabilitarla cuando corresponda.'}
              </p>
              <div className="flex items-end gap-2">
                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Meses a renovar</label>
                  <input type="number" min={1} step={1} value={renewMonths}
                    onChange={(e) => setRenewMonths(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-24 px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
                </div>
                <button onClick={() => renewMembership(current.id)} disabled={renewing}
                  className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60">
                  {renewing ? 'Renovando…' : `Renovar ${renewMonths} mes${renewMonths > 1 ? 'es' : ''}`}
                </button>
              </div>
              <button onClick={() => disableMembership(current.id)}
                className="text-xs text-[#A32D2D] hover:underline">
                Deshabilitar membresía ahora
              </button>
            </>
          ) : (
            <>
              <p className="text-[10px] text-[#A0A8BF]">
                Actívala solo después de confirmar el pago del profesional por fuera de la plataforma. Queda un
                registro histórico por mes — no se borra, solo se desactiva. El vencimiento se calcula solo
                (inicio + meses pagados, mes calendario exacto).
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Nota de período (opcional)</label>
                  <input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)}
                    placeholder="Ej. 2026-07, o cualquier referencia tuya"
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Meses pagados</label>
                  <input type="number" min={1} step={1} value={months}
                    onChange={(e) => setMonths(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-[#6B738A] mb-1">Inicio</label>
                  <div className="flex items-center gap-3 mb-1">
                    <label className="flex items-center gap-1 text-xs text-[#3A4256]">
                      <input type="radio" checked={startMode === 'today'}
                        onChange={() => setStartMode('today')} />
                      Empezar hoy
                    </label>
                    <label className="flex items-center gap-1 text-xs text-[#3A4256]">
                      <input type="radio" checked={startMode === 'custom'}
                        onChange={() => setStartMode('custom')} />
                      Elegir fecha
                    </label>
                  </div>
                  {startMode === 'custom' && (
                    <SpanishDatePicker value={customStart} onChange={setCustomStart} />
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-[#6B738A] mb-1">Nota (opcional)</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Ej. Pago recibido por QR personal, ref. 123"
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm" />
                </div>
              </div>
              <button onClick={enableMembership} disabled={creating}
                className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60">
                {creating ? 'Guardando…' : 'Habilitar membresía'}
              </button>
            </>
          )}

          {!loading && memberships.length > 0 && (
            <div className="pt-2 border-t border-[#DDE1EE] space-y-1">
              {memberships.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs">
                  <span>
                    {m.period_label ? `${m.period_label} · ` : ''}desde {fmtDate(m.starts_at)}
                    {m.ends_at ? ` hasta ${fmtDate(m.ends_at)}` : ' · sin fecha de fin'}
                    {m.is_current && ' (vigente)'}
                    {!m.active && ' (deshabilitada)'}
                    {m.note && ` — ${m.note}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProfessionalModal({ professional: pro, onClose, onAction, loading }: {
  professional: Professional; onClose: () => void
  onAction: (id: string, status: string) => void; loading: boolean
}) {
  const qc = useQueryClient()
  const [local, setLocal] = useState(pro) // copia mostrada, se actualiza tras guardar
  const [editing, setEditing] = useState(false)
  const [confirmLogin, setConfirmLogin] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveWarnings, setSaveWarnings] = useState<string[]>([])

  // Catálogo real de especialidades/subespecialidades (el mismo que usa
  // Admin → Especialidades), para que el selector no muestre una lista
  // inventada aparte del resto de la plataforma.
  const { data: specialtyCatalog = [] } = useQuery({
    queryKey: ['specialties', 'catalog'],
    queryFn: () => specialtiesAPI.list(),
    staleTime: 60_000,
  })

  const nameParts = local.name.split(' ')
  const emptyForm = {
    first_name: nameParts[0] || '',
    last_name: nameParts.slice(1).join(' ') || '',
    ci: local.ci || '',
    birth_date: local.birth_date ? local.birth_date.slice(0, 10) : '',
    department: local.department || 'La Paz',
    gender: local.gender || '',
    phone: local.phone || '',
    email: local.email || '',
    specialty: local.specialty,
    sub_specialties: local.sub_specialties || [] as string[],
    bio: local.bio || '',
    languages: local.languages?.join(', ') || 'Español',
    years_experience: String(local.years_experience ?? 0),
    price_general: String(local.price_general ?? 0),
    price_urgent: String(local.price_urgent ?? 0),
    price_follow_up: String(local.price_follow_up ?? 0),
    cmb_matricula: local.cmb_matricula || '',
    sedes_number: local.sedes_number || '',
  }
  const [form, setForm] = useState(emptyForm)

  const selectedSpecialtyId = specialtyCatalog.find((s: CatalogItem) => s.name === form.specialty)?.id
  const { data: subSpecialtyCatalog = [] } = useQuery({
    queryKey: ['specialties', 'sub', selectedSpecialtyId],
    queryFn: () => specialtiesAPI.listSubSpecialties(selectedSpecialtyId as string),
    enabled: !!selectedSpecialtyId,
    staleTime: 60_000,
  })

  function toggleSubSpecialty(name: string) {
    setForm((f) => ({
      ...f,
      sub_specialties: f.sub_specialties.includes(name)
        ? f.sub_specialties.filter((s) => s !== name)
        : [...f.sub_specialties, name],
    }))
  }

  // El login es solo por número de celular (el email es solo dato de
  // contacto), así que solo el teléfono dispara la advertencia.
  const loginFieldChanged = form.phone !== (local.phone || '')

  const saveMutation = useMutation({
    mutationFn: () => adminAPI.updateProfessional(local.id, {
      first_name: form.first_name,
      last_name: form.last_name,
      ci: form.ci,
      birth_date: form.birth_date || undefined,
      department: form.department,
      gender: form.gender || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      specialty: form.specialty,
      sub_specialties: form.sub_specialties,
      bio: form.bio || undefined,
      languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
      years_experience: Number(form.years_experience) || 0,
      price_general: Number(form.price_general) || undefined,
      price_urgent: Number(form.price_urgent) || undefined,
      price_follow_up: Number(form.price_follow_up) || undefined,
      cmb_matricula: form.cmb_matricula || undefined,
      sedes_number: form.sedes_number || undefined,
    }),
    onSuccess: (res) => {
      setLocal((prev) => ({
        ...prev,
        name: `${form.first_name} ${form.last_name}`.trim(),
        ci: form.ci,
        birth_date: form.birth_date,
        department: form.department,
        gender: form.gender,
        phone: form.phone,
        email: form.email,
        specialty: form.specialty,
        sub_specialties: form.sub_specialties,
        bio: form.bio,
        languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
        years_experience: Number(form.years_experience) || 0,
        price_general: Number(form.price_general) || 0,
        price_urgent: Number(form.price_urgent) || 0,
        price_follow_up: Number(form.price_follow_up) || 0,
        cmb_matricula: form.cmb_matricula,
        sedes_number: form.sedes_number,
      }))
      setSaveWarnings(res.warnings || [])
      setEditing(false)
      setSaveError('')
      qc.invalidateQueries({ queryKey: ['admin', 'professionals'] })
    },
    onError: (err) => setSaveError(getErrorMessage(err)),
  })

  function startEdit() {
    setForm(emptyForm)
    setConfirmLogin(false)
    setSaveError('')
    setEditing(true)
  }

  const age = getAge(local.birth_date)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#DDE1EE]">
          <div className="flex items-center gap-3">
            {local.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={local.photo_url}
                alt={local.name}
                className="w-12 h-12 rounded-full object-cover border border-[#DDE1EE]"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-base font-bold">
                {local.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
              </div>
            )}
            <div>
              <h3 className="text-base font-semibold">{local.name}</h3>
              <p className="text-xs text-[#6B738A]">{local.specialty}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
              <StatusBadge status={local.status} />
              <p className="text-xs text-[#6B738A] mt-1">Estado</p>
            </div>
            <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-[#EF9F27]">{Number(local.rating).toFixed(1)} ★</p>
              <p className="text-xs text-[#6B738A]">{local.total_ratings} calificaciones</p>
            </div>
            <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-[#185FA5]">{local.total_consultations}</p>
              <p className="text-xs text-[#6B738A]">Consultas</p>
            </div>
          </div>

          {saveWarnings.length > 0 && (
            <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-xl p-3">
              {saveWarnings.map((w, i) => (
                <p key={i} className="text-xs text-[#854F0B]">⚠ {w}</p>
              ))}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">Datos personales y profesionales</p>
              {!editing && (
                <button onClick={startEdit} className="text-xs text-[#185FA5] hover:underline">Editar</button>
              )}
            </div>

            {!editing ? (
              <div className="bg-[#F5F6FA] rounded-xl p-3 grid grid-cols-2 gap-3">
                <div><p className="text-xs text-[#A0A8BF]">Telefono</p><p className="text-sm font-medium">{local.phone || 'No disponible'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Email</p><p className="text-sm font-medium truncate">{local.email || 'No especificado'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Cedula</p><p className="text-sm font-medium">{local.ci || 'No disponible'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Fecha de nacimiento</p><p className="text-sm font-medium">{local.birth_date ? new Date(local.birth_date).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No especificada'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Edad</p><p className="text-sm font-medium">{age ? `${age} anios` : 'No especificada'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Ciudad / Departamento</p><p className="text-sm font-medium">{local.department || 'No especificado'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Genero</p><p className="text-sm font-medium">{local.gender || 'No especificado'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Especialidad</p><p className="text-sm font-medium">{local.specialty}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Experiencia</p><p className="text-sm font-medium">{local.years_experience ? `${local.years_experience} anios` : 'No especificada'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Idiomas</p><p className="text-sm font-medium">{local.languages?.join(', ') || 'Espanol'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Sub-especialidades</p><p className="text-sm font-medium">{local.sub_specialties?.length ? local.sub_specialties.join(', ') : 'No especificadas'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Matrícula CMB</p><p className="text-sm font-medium">{local.cmb_matricula || 'No especificada'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Registro SEDES</p><p className="text-sm font-medium">{local.sedes_number || 'No especificado'}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Registrado el</p><p className="text-sm font-medium">{new Date(local.created_at).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                <div><p className="text-xs text-[#A0A8BF]">Estado de cuenta</p><p className="text-sm font-medium">{local.user_status === 'ACTIVE' ? 'Activa' : local.user_status === 'SUSPENDED' ? 'Suspendida' : (local.user_status || 'No disponible')}</p></div>
              </div>
            ) : (
              <div className="bg-[#F5F6FA] rounded-xl p-3 space-y-3">
                {saveError && <Alert type="error" message={saveError} />}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Nombre</label>
                    <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Apellido</label>
                    <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">CI</label>
                    <input value={form.ci} onChange={(e) => setForm({ ...form, ci: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Fecha de nacimiento</label>
                    <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Departamento</label>
                    <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white">
                      {DEPARTMENTS.filter((d) => d !== 'Todos').map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Género</label>
                    <input value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Especialidad</label>
                    <select value={form.specialty}
                      onChange={(e) => setForm({ ...form, specialty: e.target.value, sub_specialties: [] })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white">
                      {!specialtyCatalog.some((s: CatalogItem) => s.name === form.specialty) && (
                        <option value={form.specialty}>{form.specialty} (fuera de catálogo)</option>
                      )}
                      {specialtyCatalog.map((s: CatalogItem) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Años de experiencia</label>
                    <input type="number" min={0} max={80} value={form.years_experience}
                      onChange={(e) => setForm({ ...form, years_experience: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Idiomas (coma)</label>
                    <input value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Matrícula CMB</label>
                    <input value={form.cmb_matricula} onChange={(e) => setForm({ ...form, cmb_matricula: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Registro SEDES</label>
                    <input value={form.sedes_number} onChange={(e) => setForm({ ...form, sedes_number: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Sub-especialidades</label>
                  {!selectedSpecialtyId ? (
                    <p className="text-xs text-[#A0A8BF]">Elige una especialidad del catálogo para ver sus sub-especialidades.</p>
                  ) : subSpecialtyCatalog.length === 0 ? (
                    <p className="text-xs text-[#A0A8BF]">Esta especialidad no tiene sub-especialidades en el catálogo.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {subSpecialtyCatalog.map((s: CatalogItem) => (
                        <label key={s.id} className="flex items-center gap-1.5 bg-white border border-[#DDE1EE] rounded-full px-2.5 py-1 text-xs cursor-pointer">
                          <input type="checkbox" checked={form.sub_specialties.includes(s.name)}
                            onChange={() => toggleSubSpecialty(s.name)} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                  {form.sub_specialties.some((name) => !subSpecialtyCatalog.some((s: CatalogItem) => s.name === name)) && (
                    <p className="text-[10px] text-[#A0A8BF] mt-1">
                      También tiene guardadas: {form.sub_specialties.filter((name) => !subSpecialtyCatalog.some((s: CatalogItem) => s.name === name)).join(', ')} (fuera del catálogo actual de esta especialidad — se mantienen a menos que las quites de la lista de arriba).
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Presentación / bio</label>
                  <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3}
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white resize-none" />
                </div>

                {/* Precios */}
                <div>
                  <p className="text-xs text-[#6B738A] mb-1">Precios de consulta (Bs.)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#A0A8BF] mb-1">General</label>
                      <input type="number" min={0} value={form.price_general}
                        onChange={(e) => setForm({ ...form, price_general: e.target.value })}
                        className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#A0A8BF] mb-1">Urgente</label>
                      <input type="number" min={0} value={form.price_urgent}
                        onChange={(e) => setForm({ ...form, price_urgent: e.target.value })}
                        className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#A0A8BF] mb-1">Seguimiento</label>
                      <input type="number" min={0} value={form.price_follow_up}
                        onChange={(e) => setForm({ ...form, price_follow_up: e.target.value })}
                        className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[#6B738A] mb-1">Email</label>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                </div>

                {/* Teléfono — es el único dato usado para iniciar sesión */}
                <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-lg p-2.5 space-y-2">
                  <p className="text-[11px] text-[#854F0B]">
                    ⚠ El profesional inicia sesión con su número de celular. Si lo cambias, ya no podrá
                    entrar con el número anterior — asegúrate de avisarle.
                  </p>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Teléfono</label>
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  {loginFieldChanged && (
                    <label className="flex items-start gap-2 text-[11px] text-[#854F0B]">
                      <input type="checkbox" checked={confirmLogin} onChange={(e) => setConfirmLogin(e.target.checked)}
                        className="mt-0.5" />
                      Entiendo que esto cambia cómo el profesional inicia sesión.
                    </label>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5 px-3">Cancelar</button>
                  <button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || (loginFieldChanged && !confirmLogin)}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
                  >
                    {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {local.penalty && local.penalty.color && (
            <PenaltyDetailSection professionalId={local.id} penalty={local.penalty} />
          )}

          {!editing && (
            <div>
              <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Precios de consulta</p>
              <div className="bg-[#F5F6FA] rounded-xl p-3 grid grid-cols-3 gap-3">
                <div className="text-center"><p className="text-sm font-bold text-[#185FA5]">Bs. {local.price_general || 0}</p><p className="text-xs text-[#6B738A]">General</p></div>
                <div className="text-center"><p className="text-sm font-bold text-[#A32D2D]">Bs. {local.price_urgent || 0}</p><p className="text-xs text-[#6B738A]">Urgente</p></div>
                <div className="text-center"><p className="text-sm font-bold text-[#0F6E56]">Bs. {local.price_follow_up || 0}</p><p className="text-xs text-[#6B738A]">Seguimiento</p></div>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-[#DDE1EE]">
            <ProfessionalCommissionSection professionalId={local.id} />
          </div>
          <div className="pt-2 border-t border-[#DDE1EE]">
            <ProfessionalMembershipSection professionalId={local.id} />
          </div>
          {!editing && local.bio && (
            <div>
              <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Presentacion</p>
              <p className="text-sm text-[#3A4155] bg-[#F5F6FA] rounded-xl p-3 leading-relaxed">{local.bio}</p>
            </div>
          )}
          <div className="pt-2 border-t border-[#DDE1EE]">
            <ProfessionalDocsSection professionalId={local.id} />
          </div>
          <div className="pt-2 border-t border-[#DDE1EE]">
            <ConsultationHistorySection endpoint={`/admin/professionals/${local.id}/history`} counterpartField="patient_name" />
          </div>
          <div className="pt-2 border-t border-[#DDE1EE]">
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-3">Acciones</p>
            <div className="flex gap-2 flex-wrap">
              {(local.status === 'PENDING_DOCS' || local.status === 'UNDER_REVIEW') && (<>
                <button onClick={() => onAction(local.id,'APPROVED')} disabled={loading}
                  className="flex-1 bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] py-2 rounded-lg text-xs font-medium disabled:opacity-50">Aprobar</button>
                <button onClick={() => onAction(local.id,'REJECTED')} disabled={loading}
                  className="flex-1 bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] py-2 rounded-lg text-xs font-medium disabled:opacity-50">Rechazar</button>
              </>)}
              {local.status === 'APPROVED' && (
                <button onClick={() => onAction(local.id,'SUSPENDED')} disabled={loading}
                  className="bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50">Suspender cuenta</button>
              )}
              {local.status === 'SUSPENDED' && (
                <button onClick={() => onAction(local.id,'APPROVED')} disabled={loading}
                  className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50">Reactivar cuenta</button>
              )}
              <button onClick={onClose} className="btn-secondary text-xs px-4 py-2">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pestaña "Membresías": lista de profesionales con su estado de
// membresía y gestión inline (habilitar/renovar/deshabilitar) sin tener
// que abrir el detalle completo de cada uno. ──────────────────────────
function MembershipStatusBadge({ m }: { m?: ProfessionalMembership }) {
  if (!m) {
    return (
      <span className="text-[10px] px-2 py-1 rounded-full border font-medium bg-[#F5F6FA] text-[#6B738A] border-[#DDE1EE] flex-shrink-0 whitespace-nowrap">
        Sin membresía
      </span>
    )
  }
  return (
    <span className="text-[10px] px-2 py-1 rounded-full border font-medium bg-[#FFF4E0] text-[#8A5A00] border-[#F3D08B] flex-shrink-0 whitespace-nowrap">
      🟢 Activa{m.ends_at ? ` hasta ${fmtDate(m.ends_at)}` : ''}
    </span>
  )
}

function MembershipsTabPanel({ professionals, membershipByPro, loading }: {
  professionals: Professional[]
  membershipByPro: Map<string, ProfessionalMembership>
  loading: boolean
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Activos primero, luego el resto en orden alfabético — así el admin
  // ve de un vistazo quién está pagando ahora mismo.
  const sorted = [...professionals].sort((a, b) => {
    const aActive = membershipByPro.has(a.id) ? 1 : 0
    const bActive = membershipByPro.has(b.id) ? 1 : 0
    if (aActive !== bActive) return bActive - aActive
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="card">
      {loading ? (
        <LoadingScreen />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-[#6B738A] text-center py-8">No hay profesionales para mostrar</p>
      ) : (
        <div className="divide-y divide-[#DDE1EE]">
          {sorted.map((pro) => {
            const current = membershipByPro.get(pro.id)
            const isOpen = expandedId === pro.id
            return (
              <div key={pro.id}>
                <div
                  className="py-3 flex items-center gap-3 hover:bg-[#F5F6FA] -mx-4 px-4 cursor-pointer transition-colors rounded-lg"
                  onClick={() => setExpandedId(isOpen ? null : pro.id)}
                >
                  {pro.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pro.photo_url} alt={pro.name} className="w-10 h-10 rounded-full object-cover border border-[#DDE1EE] flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {pro.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{pro.name}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="text-xs text-[#6B738A]">{pro.specialty}</span>
                      {pro.department && <span className="text-xs text-[#A0A8BF]">· {pro.department}</span>}
                    </div>
                  </div>
                  <MembershipStatusBadge m={current} />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="2"
                    className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
                {isOpen && (
                  <div className="pb-4 px-1">
                    <ProfessionalMembershipSection professionalId={pro.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AdminProfessionalsPage() {
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  // Permite llegar directo a una pestaña desde otra página, ej. el aviso
  // de "profesionales pendientes" en /admin/dashboard → /admin/professionals?tab=PENDING_DOCS
  const initialTab = (searchParams.get('tab') as 'APPROVED'|'PENDING_DOCS'|'SUSPENDED'|'MEMBERSHIPS' | null)
  const [tab, setTab]           = useState<'APPROVED'|'PENDING_DOCS'|'SUSPENDED'|'MEMBERSHIPS'>(
    initialTab && ['APPROVED', 'PENDING_DOCS', 'SUSPENDED', 'MEMBERSHIPS'].includes(initialTab) ? initialTab : 'APPROVED'
  )
  const [success, setSuccess]   = useState('')
  const [error, setError]       = useState('')
  const [selected, setSelected] = useState<Professional|null>(null)
  const [search, setSearch]     = useState('')
  const [department, setDepartment] = useState('Todos')
  const [penaltyFilter, setPenaltyFilter] = useState<'Todos' | 'yellow' | 'orange' | 'red'>('Todos')

  const { data: allPros = [], isLoading } = useQuery({
    queryKey: ['admin', 'professionals', 'all'],
    queryFn: () => api.get('/admin/professionals').then(r => r.data),
    refetchInterval: 15000,
  })

  // Todos los registros de membresía, de todos los profesionales, en un
  // solo request (sin professional_id) — para la pestaña "Membresías".
  // Se carga solo cuando esa pestaña está activa.
  const { data: allMemberships = [], isLoading: loadingMemberships } = useQuery({
    queryKey: ['admin', 'memberships', 'all'],
    queryFn: () => adminAPI.listMemberships(),
    enabled: tab === 'MEMBERSHIPS',
    refetchInterval: tab === 'MEMBERSHIPS' ? 15000 : false,
  })

  // Membresía vigente por profesional (is_current=true), calculada una
  // sola vez a partir del listado completo.
  const currentMembershipByPro = new Map<string, ProfessionalMembership>()
  for (const m of allMemberships as ProfessionalMembership[]) {
    if (m.is_current) currentMembershipByPro.set(m.professional_id, m)
  }

  // Counts for each tab
  const counts = {
    APPROVED:    allPros.filter((p:Professional) => p.status === 'APPROVED').length,
    PENDING_DOCS: allPros.filter((p:Professional) => ['PENDING_DOCS','UNDER_REVIEW'].includes(p.status)).length,
    SUSPENDED:   allPros.filter((p:Professional) => p.status === 'SUSPENDED').length,
    MEMBERSHIPS: currentMembershipByPro.size,
  }

  // Filter by tab + search + department
  const filtered = allPros.filter((p: Professional) => {
    const matchTab = tab === 'APPROVED'
      ? p.status === 'APPROVED'
      : tab === 'PENDING_DOCS'
      ? ['PENDING_DOCS','UNDER_REVIEW'].includes(p.status)
      : tab === 'SUSPENDED'
      ? p.status === 'SUSPENDED'
      : true // MEMBERSHIPS: todos los estados, la membresía puede haberse habilitado antes o después
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.specialty.toLowerCase().includes(search.toLowerCase()) ||
      p.phone?.includes(search)
    const matchDept = department === 'Todos' || p.department === department
    const matchPenalty = penaltyFilter === 'Todos' || p.penalty?.color === penaltyFilter
    return matchTab && matchSearch && matchDept && matchPenalty
  })

  const verifyMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/professionals/${id}/verify`, null, { params: { new_status: status } }),
    onSuccess: (_, { status }) => {
      const msgs: Record<string,string> = { APPROVED:'Profesional aprobado', REJECTED:'Profesional rechazado', SUSPENDED:'Profesional suspendido' }
      setSuccess(msgs[status] || 'Estado actualizado')
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['admin','professionals'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/professionals" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Gestion de profesionales</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Clic en un profesional para ver su detalle completo</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        {/* Tabs con contadores */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit flex-wrap">
          {([
            { key: 'APPROVED',    label: 'Activos' },
            { key: 'PENDING_DOCS',label: 'Pendientes' },
            { key: 'SUSPENDED',   label: 'Suspendidos' },
            { key: 'MEMBERSHIPS', label: 'Membresías' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                tab === key ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
              }`}>
              {label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                tab === key ? 'bg-[#185FA5] text-white' : 'bg-[#DDE1EE] text-[#6B738A]'
              }`}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A8BF]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="w-full pl-8 pr-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
              placeholder="Buscar por nombre, especialidad o celular..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
            value={department} onChange={(e) => setDepartment(e.target.value)}>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
            value={penaltyFilter} onChange={(e) => setPenaltyFilter(e.target.value as typeof penaltyFilter)}>
            <option value="Todos">Todas las penalizaciones</option>
            <option value="yellow">🟡 Leve</option>
            <option value="orange">🟠 Moderado</option>
            <option value="red">🔴 Grave</option>
          </select>
        </div>

        {tab === 'MEMBERSHIPS' ? (
          <MembershipsTabPanel
            professionals={filtered}
            membershipByPro={currentMembershipByPro}
            loading={loadingMemberships}
          />
        ) : isLoading ? <LoadingScreen /> : (
          <div className="card">
            {filtered.length === 0 ? (
              <p className="text-sm text-[#6B738A] text-center py-8">No hay profesionales en este estado</p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {filtered.map((pro: Professional) => {
                  const age = getAge(pro.birth_date)
                  const pendingDocs = pro.doc_counts?.pending || 0
                  return (
                    <div key={pro.id}
                      className="py-3 flex items-center gap-3 hover:bg-[#F5F6FA] -mx-4 px-4 cursor-pointer transition-colors rounded-lg"
                      onClick={() => setSelected(pro)}>
                      <div className="relative flex-shrink-0">
                        {pro.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={pro.photo_url}
                            alt={pro.name}
                            className="w-10 h-10 rounded-full object-cover border border-[#DDE1EE]"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-xs font-bold">
                            {pro.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                          </div>
                        )}
                        {pendingDocs > 0 && (
                          <span
                            className="absolute -top-1 -right-1 bg-[#185FA5] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white"
                            title={`${pendingDocs} documento${pendingDocs > 1 ? 's' : ''} sin revisar`}
                          >
                            {pendingDocs}
                          </span>
                        )}
                        {pro.penalty?.color && (
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${PENALTY_META[pro.penalty.color].dot}`}
                            title={`Penalización: ${PENALTY_META[pro.penalty.color].label} (${pro.penalty.score} pts)`}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{pro.name}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <span className="text-xs text-[#6B738A]">{pro.specialty}</span>
                          {pro.department && <span className="text-xs text-[#A0A8BF]">· {pro.department}</span>}
                          {age && <span className="text-xs text-[#A0A8BF]">· {age} años</span>}
                          {pro.phone && <span className="text-xs text-[#A0A8BF]">· {pro.phone}</span>}
                        </div>
                      </div>
                      {pendingDocs > 0 && (
                        <span className="text-[10px] px-2 py-1 rounded-full border font-medium bg-[#E6F1FB] text-[#185FA5] border-[#85B7EB] flex-shrink-0 whitespace-nowrap">
                          📄 {pendingDocs} por revisar
                        </span>
                      )}
                      {pro.penalty?.color && (
                        <span className={`text-[10px] px-2 py-1 rounded-full border font-medium flex-shrink-0 whitespace-nowrap ${PENALTY_META[pro.penalty.color].badge}`}>
                          ⚠ {PENALTY_META[pro.penalty.color].label} · {pro.penalty.score} pts
                        </span>
                      )}
                      {pro.rating > 0 && (
                        <span className="text-xs text-[#EF9F27] flex-shrink-0">★ {Number(pro.rating).toFixed(1)}</span>
                      )}
                      <StatusBadge status={pro.status} />
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="2" className="flex-shrink-0">
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <ProfessionalModal professional={selected} onClose={() => setSelected(null)}
          onAction={(id, status) => verifyMutation.mutate({ id, status })}
          loading={verifyMutation.isPending} />
      )}
    </DashboardLayout>
  )
}