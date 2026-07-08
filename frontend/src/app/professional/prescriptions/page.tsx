'use client'
// src/app/professional/prescriptions/page.tsx

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { Alert, SectionTitle } from '@/components/ui'
import { prescriptionsAPI, consultationsAPI, getErrorMessage, buildPrescriptionVerifyUrl } from '@/lib/api'
import type { Medication, Prescription } from '@/types'

const EMPTY_MED: Medication = { name: '', presentation: '', dosage: '', frequency: '', duration: '', notes: '' }

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtFechaHora(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleString('es-BO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/La_Paz'
  })
}

// QR visual
function QRCode({ value, size = 110 }: { value: string; size?: number }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&margin=6&color=042C53`
  return (
    <div className="bg-white p-2 rounded-lg border border-[#DDE1EE]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`QR ${value}`} width={size} height={size} className="rounded" />
    </div>
  )
}

function PrescriptionCard({
  rx, alreadyReplaced, onVoid, onReissue, isVoiding,
}: {
  rx: Prescription
  alreadyReplaced: boolean
  onVoid: (id: string, reason: string) => void
  onReissue: (rx: Prescription) => void
  isVoiding: boolean
}) {
  const [open, setOpen]           = useState(false)
  const [copied, setCopied]       = useState(false)
  const [voidPanel, setVoidPanel] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const meds: Medication[] = Array.isArray(rx.medications) ? rx.medications : []
  const isVoided = rx.status === 'VOIDED'

  function copyCode() {
    navigator.clipboard.writeText(rx.qr_verify_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function confirmVoid() {
    onVoid(rx.id, voidReason)
    setVoidPanel(false)
    setVoidReason('')
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${isVoided ? 'border-[#F0D9D9] bg-[#FFFBFB]' : 'border-[#DDE1EE]'}`}>
      {/* Cabecera */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${isVoided ? 'bg-[#F5E6E6] text-[#A32D2D]' : 'bg-[#E6F1FB] text-[#185FA5]'}`}>
          💊
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isVoided ? 'text-[#A0A8BF] line-through' : ''}`}>{rx.patient_name}</p>
          <p className="text-xs text-[#6B738A]">
            CI: {rx.patient_ci} · {rx.patient_age} años · {fmtFecha(rx.signed_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isVoided && (
            <span className="text-[10px] bg-[#F5E6E6] text-[#A32D2D] px-2 py-0.5 rounded-full font-medium">Anulada</span>
          )}
          {!isVoided && rx.replaces_prescription_id && (
            <span className="text-[10px] bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full font-medium">Corregida</span>
          )}
          {!isVoided && alreadyReplaced && (
            <span className="text-[10px] bg-[#FAEEDA] text-[#854F0B] px-2 py-0.5 rounded-full font-medium">Reemplazada</span>
          )}
          <span className="hidden sm:block text-[10px] font-mono text-[#6B738A] bg-[#F5F6FA] px-2 py-0.5 rounded-full">
            {rx.qr_verify_code}
          </span>
          <span className="text-[#6B738A] text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Detalle expandible */}
      {open && (
        <div className="bg-[#FAFBFC] border-t border-[#DDE1EE]">
          <div className="px-4 py-4 space-y-3">

            {isVoided && (
              <div className="bg-[#F5E6E6] rounded-lg px-3 py-2.5">
                <p className="text-xs font-semibold text-[#A32D2D]">
                  ⛔ Receta anulada {rx.voided_at ? `el ${fmtFecha(rx.voided_at)}` : ''}
                </p>
                {rx.void_reason && <p className="text-xs text-[#A32D2D] mt-0.5">Motivo: {rx.void_reason}</p>}
                <p className="text-[10px] text-[#A32D2D] mt-1">
                  Esta receta ya no es válida. El hash y QR se conservan solo como registro histórico.
                </p>
              </div>
            )}

            {/* Medicamentos */}
            <div className="space-y-2">
              {meds.map((m, i) => (
                <div key={i} className="bg-white rounded-lg border border-[#DDE1EE] p-3">
                  <div className="flex gap-2">
                    <span className="text-[#185FA5] font-bold text-sm">{i + 1}.</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[#1A1F2E]">{m.name}</p>
                      {m.presentation && <p className="text-xs text-[#6B738A]">{m.presentation}</p>}
                      <div className="flex flex-wrap gap-2 mt-1.5 text-xs">
                        {m.dosage    && <span className="bg-[#E6F1FB] text-[#185FA5] px-2 py-0.5 rounded-full">💊 {m.dosage}</span>}
                        {m.frequency && <span className="bg-[#E6F1FB] text-[#185FA5] px-2 py-0.5 rounded-full">🕐 {m.frequency}</span>}
                        {m.duration  && <span className="bg-[#E6F1FB] text-[#185FA5] px-2 py-0.5 rounded-full">📅 {m.duration}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Indicaciones */}
            {rx.instructions && (
              <div className="bg-[#FAEEDA] rounded-lg px-3 py-2">
                <p className="text-xs font-semibold text-[#854F0B] mb-0.5">📌 Indicaciones</p>
                <p className="text-xs text-[#854F0B]">{rx.instructions}</p>
              </div>
            )}

            {/* QR + firma */}
            <div className="bg-white rounded-lg border border-[#DDE1EE] p-3 flex gap-4 items-start">
              <QRCode value={buildPrescriptionVerifyUrl(rx.qr_verify_code)} size={110} />
              <div className="flex-1 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-[#1A1F2E]">Código QR de verificación</p>
                  <p className="text-[10px] text-[#6B738A] mt-0.5">La farmacia puede escanear este QR para verificar la autenticidad de la receta.</p>
                </div>
                <div className="bg-[#F5F6FA] rounded px-2 py-1.5">
                  <p className="text-[9px] text-[#6B738A] font-semibold mb-0.5">Hash SHA-256</p>
                  <p className="text-[9px] font-mono text-[#185FA5] break-all">{rx.digital_hash}</p>
                </div>
                <button onClick={copyCode} className={`w-full py-1.5 rounded text-[10px] font-medium transition-colors ${copied ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-[#E6F1FB] text-[#185FA5] hover:bg-[#B5D4F4]'}`}>
                  {copied ? '✓ Copiado' : '📋 Copiar código'}
                </button>
              </div>
            </div>

            {/* Anular / reemitir — una receta firmada nunca se edita directamente */}
            {!isVoided && !alreadyReplaced && (
              voidPanel ? (
                <div className="bg-white border border-[#DDE1EE] rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-[#1A1F2E]">¿Por qué anulas esta receta?</p>
                  <textarea
                    className="input text-xs resize-none"
                    rows={2}
                    placeholder="Motivo (opcional, ej: error en la dosis)"
                    value={voidReason}
                    onChange={e => setVoidReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={confirmVoid}
                      disabled={isVoiding}
                      className="flex-1 py-1.5 bg-[#A32D2D] hover:bg-[#832222] disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      {isVoiding ? 'Anulando...' : 'Confirmar anulación'}
                    </button>
                    <button
                      onClick={() => { setVoidPanel(false); setVoidReason('') }}
                      className="px-3 py-1.5 text-xs text-[#6B738A] hover:underline"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setVoidPanel(true)}
                  className="w-full py-1.5 text-xs font-medium text-[#A32D2D] border border-[#F0D9D9] rounded-lg hover:bg-[#F5E6E6] transition-colors"
                >
                  ⛔ Anular receta (por error o corrección)
                </button>
              )
            )}

            {isVoided && !alreadyReplaced && (
              <button
                onClick={() => onReissue(rx)}
                className="w-full py-1.5 text-xs font-medium text-white bg-[#185FA5] hover:bg-[#0C447C] rounded-lg transition-colors"
              >
                ✍️ Reemitir receta corregida
              </button>
            )}

          </div>
        </div>
      )}
    </div>
  )
}

// ── Grupo de recetas de un mismo paciente ────────────
function PatientRxGroup({
  group, alreadyReplacedIds, onVoid, onReissue, isVoiding,
}: {
  group: { patientCi: string; patientName: string; items: Prescription[] }
  alreadyReplacedIds: Set<string>
  onVoid: (id: string, reason: string) => void
  onReissue: (rx: Prescription) => void
  isVoiding: boolean
}) {
  const [open, setOpen] = useState(true)
  const sorted = [...group.items].sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime())

  return (
    <div className="border border-[#DDE1EE] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[#F5F6FA] hover:bg-[#EEF0F6] transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {group.patientName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1F2E] truncate">{group.patientName}</p>
          <p className="text-xs text-[#6B738A]">
            {group.items.length} receta{group.items.length !== 1 ? 's' : ''} · CI: {group.patientCi}
          </p>
        </div>
        <span className="text-[#A0A8BF] text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="divide-y divide-[#DDE1EE]">
          {sorted.map(rx => (
            <div key={rx.id} className="px-2 py-2">
              <PrescriptionCard
                rx={rx}
                alreadyReplaced={alreadyReplacedIds.has(rx.id)}
                onVoid={onVoid}
                onReissue={onReissue}
                isVoiding={isVoiding}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PrescriptionsPage() {
  const qc = useQueryClient()

  const [consultationId, setConsultationId] = useState('')
  const [medications, setMedications]       = useState<Medication[]>([{ ...EMPTY_MED }])
  const [instructions, setInstructions]     = useState('')
  const [success, setSuccess]               = useState('')
  const [error, setError]                   = useState('')
  const [replacesId, setReplacesId]         = useState<string | null>(null)
  const [viewMode, setViewMode]             = useState<'date' | 'patient'>('date')

  const { data: consultations = [], isLoading: loadingConsultations } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then(r => r.data),
  })

  const { data: myPrescriptions = [], isLoading: loadingRx, error: rxError } = useQuery({
    queryKey: ['prescriptions', 'my'],
    queryFn: () => prescriptionsAPI.getMy(),
  })

  // Consultas con una receta ACTIVA vigente (no anulada) — ya no deben
  // ofrecerse de nuevo, para no terminar con más de una receta activa
  // por consulta. Si la única receta de esa consulta fue anulada, sí
  // vuelve a aparecer disponible (la reemisión se hace desde "Reemitir").
  const consultationIdsWithActiveRx = new Set(
    myPrescriptions.filter(p => p.status !== 'VOIDED').map(p => p.consultation_id)
  )

  const completedConsultations = consultations.filter((c: any) =>
    ['COMPLETED', 'IN_PROGRESS'].includes(c.status) &&
    !consultationIdsWithActiveRx.has(c.id)
  )

  const createMutation = useMutation({
    mutationFn: () => prescriptionsAPI.create({
      consultation_id: consultationId,
      medications,
      instructions,
      replaces_prescription_id: replacesId || undefined,
    }),
    onSuccess: () => {
      setSuccess(replacesId ? 'Receta corregida emitida y firmada. Reemplaza a la anulada.' : 'Receta emitida y firmada digitalmente. El paciente ya puede verla.')
      setConsultationId('')
      setMedications([{ ...EMPTY_MED }])
      setInstructions('')
      setReplacesId(null)
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      setTimeout(() => setSuccess(''), 5000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => prescriptionsAPI.void(id, reason || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescriptions'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  function addMedication()       { setMedications(p => [...p, { ...EMPTY_MED }]) }
  function removeMedication(i: number) { setMedications(p => p.filter((_, idx) => idx !== i)) }
  function updateMed(i: number, field: keyof Medication, value: string) {
    setMedications(p => p.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!consultationId) { setError('Selecciona la consulta'); return }
    if (medications.some(m => !m.name || !m.dosage || !m.frequency)) {
      setError('Completa nombre, dosis y frecuencia de todos los medicamentos')
      return
    }
    createMutation.mutate()
  }

  function handleReissue(rx: Prescription) {
    setConsultationId(rx.consultation_id)
    setMedications(rx.medications.map(m => ({ ...m })))
    setInstructions(rx.instructions || '')
    setReplacesId(rx.id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelReissue() {
    setReplacesId(null)
    setConsultationId('')
    setMedications([{ ...EMPTY_MED }])
    setInstructions('')
  }

  // IDs de recetas que ya fueron reemplazadas por una reemisión
  const alreadyReplacedIds = new Set(
    myPrescriptions.filter(p => p.replaces_prescription_id).map(p => p.replaces_prescription_id as string)
  )

  const rxBeingReplaced = replacesId ? myPrescriptions.find(p => p.id === replacesId) : null

  // Agrupar por paciente (CI) para la vista "por paciente"
  type Group = { patientCi: string; patientName: string; items: Prescription[] }
  const groupedByPatient: Group[] = Object.values(
    myPrescriptions.reduce((acc: Record<string, Group>, rx) => {
      if (!acc[rx.patient_ci]) {
        acc[rx.patient_ci] = { patientCi: rx.patient_ci, patientName: rx.patient_name, items: [] }
      }
      acc[rx.patient_ci].items.push(rx)
      return acc
    }, {})
  ).sort((a, b) => {
    const latestA = Math.max(...a.items.map(r => new Date(r.signed_at).getTime()))
    const latestB = Math.max(...b.items.map(r => new Date(r.signed_at).getTime()))
    return latestB - latestA
  })

  const sortedByDate = [...myPrescriptions].sort(
    (a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime()
  )

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/prescriptions" role="PROFESSIONAL">
      <div className="max-w-4xl">
        <div className="mb-5">
          <h1 className="text-base font-semibold">Recetario digital</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Las recetas se firman con SHA-256 vinculado a tu matrícula CMB y quedan disponibles para el paciente
          </p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error}   /></div>}
        {rxError && <div className="mb-4"><Alert type="error"   message={`No se pudieron cargar tus recetas: ${getErrorMessage(rxError)}`} /></div>}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* ── Formulario nueva receta ── */}
          <div className="card">
            <SectionTitle>{replacesId ? 'Reemitir receta corregida' : 'Nueva receta'}</SectionTitle>

            {rxBeingReplaced && (
              <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5 mb-3 flex items-start justify-between gap-2">
                <p className="text-xs text-[#185FA5]">
                  📝 Corrigiendo la receta anulada de <strong>{rxBeingReplaced.patient_name}</strong> ({fmtFecha(rxBeingReplaced.signed_at)}).
                  Los campos se prellenaron; ajústalos y firma de nuevo.
                </p>
                <button onClick={cancelReissue} className="text-xs text-[#185FA5] hover:underline flex-shrink-0">
                  Cancelar
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Consulta asociada */}
              <div>
                <label className="label">Consulta asociada</label>
                {loadingConsultations ? (
                  <div className="h-9 bg-[#F5F6FA] rounded-lg animate-pulse" />
                ) : completedConsultations.length === 0 ? (
                  <div className="bg-[#FAEEDA] rounded-lg px-3 py-2.5">
                    <p className="text-xs text-[#854F0B]">
                      {consultations.some((c: any) => ['COMPLETED', 'IN_PROGRESS'].includes(c.status))
                        ? 'Todas tus consultas completadas o en curso ya tienen una receta activa. Si necesitas corregir una, anúlala y usa "Reemitir".'
                        : 'No hay consultas completadas o en curso para asociar.'}
                    </p>
                  </div>
                ) : (
                  <select
                    className="input"
                    value={consultationId}
                    onChange={e => setConsultationId(e.target.value)}
                    required
                  >
                    <option value="">Seleccionar consulta...</option>
                    {completedConsultations.map((c: any) => {
                      const patientName = [c.patient_first_name, c.patient_last_name].filter(Boolean).join(' ')
                      const when = c.scheduled_at || c.created_at
                      return (
                        <option key={c.id} value={c.id}>
                          {patientName ? `${patientName} · ` : ''}{c.specialty || 'Consulta general'} · {fmtFechaHora(when)}
                        </option>
                      )
                    })}
                  </select>
                )}
              </div>

              {/* Medicamentos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Medicamentos</label>
                  <button type="button" onClick={addMedication} className="text-xs text-[#185FA5] hover:underline font-medium">
                    + Agregar otro
                  </button>
                </div>
                <div className="space-y-3">
                  {medications.map((med, i) => (
                    <div key={i} className="bg-[#F5F6FA] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-[#6B738A]">Medicamento {i + 1}</p>
                        {medications.length > 1 && (
                          <button type="button" onClick={() => removeMedication(i)} className="text-xs text-[#A32D2D] hover:underline">
                            Eliminar
                          </button>
                        )}
                      </div>
                      <input
                        className="input bg-white text-sm"
                        placeholder="Nombre (ej: Amoxicilina 500mg)"
                        value={med.name}
                        onChange={e => updateMed(i, 'name', e.target.value)}
                        required
                      />
                      <input
                        className="input bg-white text-sm"
                        placeholder="Presentación (ej: cápsulas)"
                        value={med.presentation}
                        onChange={e => updateMed(i, 'presentation', e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="input bg-white text-sm"
                          placeholder="Dosis (ej: 1 cápsula)"
                          value={med.dosage}
                          onChange={e => updateMed(i, 'dosage', e.target.value)}
                          required
                        />
                        <input
                          className="input bg-white text-sm"
                          placeholder="Frecuencia (ej: cada 8 hrs)"
                          value={med.frequency}
                          onChange={e => updateMed(i, 'frequency', e.target.value)}
                          required
                        />
                      </div>
                      <input
                        className="input bg-white text-sm"
                        placeholder="Duración (ej: 7 días)"
                        value={med.duration}
                        onChange={e => updateMed(i, 'duration', e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Indicaciones */}
              <div>
                <label className="label">Indicaciones adicionales</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder="Indicaciones para el paciente: horarios, restricciones, controles..."
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                />
              </div>

              {/* Aviso firma */}
              <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5">
                <p className="text-xs text-[#185FA5]">
                  🔒 Al emitir, la receta se firmará con SHA-256 vinculado a tu matrícula CMB.
                  Las farmacias pueden verificar su autenticidad escaneando el QR.
                  {' '}Una vez firmada no se puede editar: si tiene un error, deberás anularla y reemitir una nueva.
                </p>
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {createMutation.isPending && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {createMutation.isPending ? 'Firmando y emitiendo...' : (replacesId ? '✍️ Firmar receta corregida' : '✍️ Firmar y emitir receta')}
              </button>
            </form>
          </div>

          {/* ── Recetas emitidas ── */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Recetas emitidas</SectionTitle>
              {myPrescriptions.length > 0 && (
                <span className="text-xs text-[#6B738A] bg-[#F5F6FA] px-2 py-0.5 rounded-full">
                  {myPrescriptions.length} total
                </span>
              )}
            </div>

            {myPrescriptions.length > 0 && (
              <div className="flex gap-1 mb-3 bg-[#F5F6FA] rounded-lg p-1 w-fit">
                <button
                  onClick={() => setViewMode('date')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'date' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  🕐 Por fecha
                </button>
                <button
                  onClick={() => setViewMode('patient')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'patient' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  👤 Por paciente
                </button>
              </div>
            )}

            {loadingRx ? (
              <div className="space-y-3">
                {[1,2].map(n => <div key={n} className="h-14 bg-[#F5F6FA] rounded-xl animate-pulse" />)}
              </div>
            ) : myPrescriptions.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-sm font-medium text-[#1A1F2E]">Aún no has emitido recetas</p>
                <p className="text-xs text-[#6B738A] mt-1">Las recetas aparecerán aquí una vez que las emitas</p>
              </div>
            ) : viewMode === 'date' ? (
              <div className="space-y-2">
                {sortedByDate.map((rx: Prescription) => (
                  <PrescriptionCard
                    key={rx.id}
                    rx={rx}
                    alreadyReplaced={alreadyReplacedIds.has(rx.id)}
                    onVoid={(id, reason) => voidMutation.mutate({ id, reason })}
                    onReissue={handleReissue}
                    isVoiding={voidMutation.isPending}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByPatient.map(group => (
                  <PatientRxGroup
                    key={group.patientCi}
                    group={group}
                    alreadyReplacedIds={alreadyReplacedIds}
                    onVoid={(id, reason) => voidMutation.mutate({ id, reason })}
                    onReissue={handleReissue}
                    isVoiding={voidMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </DashboardLayout>
  )
}