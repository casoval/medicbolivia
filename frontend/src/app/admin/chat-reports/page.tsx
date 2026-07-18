'use client'
// src/app/admin/chat-reports/page.tsx
// Panel de revisión de reportes de chat: bloqueos con is_reported=True,
// tanto los que vienen del chat puntual (ChatBlock) como del bloqueo
// integral desde "Mis Pacientes" (ProfessionalPatientVisibility).
// Ver backend/app/api/v1/endpoints/admin.py::list_chat_reports.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { Alert, EmptyState, LoadingScreen } from '@/components/ui'
import { adminAPI, getErrorMessage, type ChatReport } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const CATEGORY_LABELS: Record<string, string> = {
  HARASSMENT: 'Acoso',
  INAPPROPRIATE_CONTENT: 'Contenido inapropiado',
  SPAM: 'Spam',
  PROFESSIONAL_MISCONDUCT: 'Mala conducta profesional',
  NO_SHOW_OR_ABUSE: 'Inasistencia o abuso',
  OTHER: 'Otro',
}

const KIND_LABELS: Record<ChatReport['kind'], string> = {
  CHAT_BLOCK: 'Bloqueo de chat (puntual)',
  PATIENT_VISIBILITY: 'Bloqueo integral (Mis Pacientes)',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/La_Paz' })
}

function ReportCard({ report, onReviewed }: { report: ChatReport; onReviewed: () => void }) {
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  async function handleReview() {
    if (!notes.trim()) {
      setError('Escribe una breve nota de resolución antes de marcarlo como revisado.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await adminAPI.reviewChatReport(report.kind, report.id, notes.trim())
      onReviewed()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border border-[#DDE1EE] rounded-xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#DC2626]">
              {CATEGORY_LABELS[report.reason_category || 'OTHER']}
            </span>
            <span className="text-xs text-[#6B738A]">{KIND_LABELS[report.kind]}</span>
          </div>
          <p className="text-xs text-[#A0A8BF] mt-1">Reportado el {fmtDate(report.created_at)}</p>
        </div>
        {report.status === 'reviewed' && (
          <span className="text-xs text-[#0F6E56] font-medium flex-shrink-0">✓ Revisado</span>
        )}
      </div>

      {report.reason_text && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-[#185FA5] mt-2 hover:underline"
        >
          {expanded ? 'Ocultar detalle' : 'Ver detalle del motivo'}
        </button>
      )}
      {expanded && report.reason_text && (
        <p className="text-sm text-[#141820] bg-[#F5F6FA] rounded-lg p-3 mt-2 whitespace-pre-wrap">
          {report.reason_text}
        </p>
      )}

      {report.status === 'reviewed' ? (
        <div className="mt-3 pt-3 border-t border-[#DDE1EE]">
          <p className="text-xs text-[#6B738A] font-medium mb-1">Notas de resolución</p>
          <p className="text-sm text-[#141820]">{report.admin_resolution_notes}</p>
          <p className="text-xs text-[#A0A8BF] mt-1">Revisado el {fmtDate(report.admin_reviewed_at)}</p>
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-[#DDE1EE] space-y-2">
          {error && <Alert type="error" message={error} />}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Notas de resolución (qué se hizo con este reporte)..."
            className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2 resize-none"
          />
          <button
            onClick={handleReview}
            disabled={submitting}
            className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60"
          >
            {submitting ? 'Guardando...' : 'Marcar como revisado'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function AdminChatReportsPage() {
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending')

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['admin', 'chat-reports', tab],
    queryFn: () => adminAPI.listChatReports(tab),
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'chat-reports'] })
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/chat-reports" role="ADMIN">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Reportes de chat</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Bloqueos que pacientes o profesionales marcaron para que el equipo los revise
          </p>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('pending')}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg ${tab === 'pending' ? 'bg-[#185FA5] text-white' : 'bg-[#F5F6FA] text-[#6B738A]'}`}
          >
            {t('Pendientes')}
          </button>
          <button
            onClick={() => setTab('reviewed')}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg ${tab === 'reviewed' ? 'bg-[#185FA5] text-white' : 'bg-[#F5F6FA] text-[#6B738A]'}`}
          >
            Revisados
          </button>
        </div>

        {isLoading && <LoadingScreen text="Cargando reportes..." />}

        {!isLoading && reports.length === 0 && (
          <EmptyState
            title={tab === 'pending' ? 'No hay reportes pendientes' : 'Todavía no hay reportes revisados'}
            description={tab === 'pending' ? 'Cuando alguien reporte un bloqueo, aparecerá acá.' : ''}
          />
        )}

        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard key={`${r.kind}-${r.id}`} report={r} onReviewed={refresh} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}
