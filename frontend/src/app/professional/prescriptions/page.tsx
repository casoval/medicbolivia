'use client'
// src/app/professional/prescriptions/page.tsx
// Recetario digital del profesional con firma criptográfica

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Alert, LoadingScreen, EmptyState, SectionTitle } from '@/components/ui'
import { prescriptionsAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import type { Medication } from '@/types'

const IconGrid    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
const IconCal     = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
const IconFile    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconStar    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
const IconUser    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>

const NAV = [
  { label: 'Resumen',        href: '/professional/dashboard',     icon: <IconGrid /> },
  { label: 'Consultas',      href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Horarios',       href: '/professional/schedule',      icon: <IconCal /> },
  { label: 'Recetario',      href: '/professional/prescriptions', icon: <IconFile /> },
  { label: 'Calificaciones', href: '/professional/ratings',       icon: <IconStar /> },
  { label: 'Mi perfil',      href: '/professional/profile',       icon: <IconUser /> },
]

const EMPTY_MED: Medication = {
  name: '', presentation: '', dosage: '', frequency: '', duration: '', notes: ''
}

export default function PrescriptionsPage() {
  const qc = useQueryClient()

  // Formulario de nueva receta
  const [consultationId, setConsultationId] = useState('')
  const [medications, setMedications] = useState<Medication[]>([{ ...EMPTY_MED }])
  const [instructions, setInstructions] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  // Consultas completadas (para elegir a qué consulta emitir la receta)
  const { data: consultations = [], isLoading: loadingConsultations } = useQuery({
    queryKey: ['consultations', 'professional'],
    queryFn: () => consultationsAPI.getMyConsultations().then((r) => r.data),
  })

  const completedConsultations = consultations.filter((c) =>
    ['COMPLETED', 'IN_PROGRESS'].includes(c.status)
  )

  // Mutación para crear receta
  const createMutation = useMutation({
    mutationFn: () => prescriptionsAPI.create({ consultation_id: consultationId, medications, instructions }),
    onSuccess: () => {
      setSuccess('Receta emitida y firmada digitalmente. El paciente ya puede verla.')
      setConsultationId('')
      setMedications([{ ...EMPTY_MED }])
      setInstructions('')
      qc.invalidateQueries({ queryKey: ['prescriptions'] })
      setTimeout(() => setSuccess(''), 4000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  function addMedication() {
    setMedications((prev) => [...prev, { ...EMPTY_MED }])
  }

  function removeMedication(i: number) {
    setMedications((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateMed(i: number, field: keyof Medication, value: string) {
    setMedications((prev) => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!consultationId) { setError('Selecciona la consulta'); return }
    if (medications.some((m) => !m.name || !m.dosage || !m.frequency)) {
      setError('Completa el nombre, dosis y frecuencia de todos los medicamentos')
      return
    }
    createMutation.mutate()
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/prescriptions" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Recetario digital</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Las recetas se firman criptográficamente con tu matrícula CMB y quedan disponibles para el paciente
          </p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Formulario */}
          <div className="card">
            <SectionTitle>Nueva receta</SectionTitle>
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Consulta */}
              <div>
                <label className="label">Consulta asociada</label>
                {loadingConsultations ? (
                  <div className="h-9 bg-[#F5F6FA] rounded-lg animate-pulse" />
                ) : (
                  <select
                    className="input"
                    value={consultationId}
                    onChange={(e) => setConsultationId(e.target.value)}
                    required
                  >
                    <option value="">Seleccionar consulta...</option>
                    {completedConsultations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.specialty || 'Consulta'} · {new Date(c.created_at).toLocaleDateString('es-BO')}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Medicamentos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Medicamentos</label>
                  <button type="button" onClick={addMedication} className="text-xs text-[#185FA5] hover:underline">
                    + Agregar otro
                  </button>
                </div>

                <div className="space-y-3">
                  {medications.map((med, i) => (
                    <div key={i} className="bg-[#F5F6FA] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-[#6B738A]">Medicamento {i + 1}</p>
                        {medications.length > 1 && (
                          <button type="button" onClick={() => removeMedication(i)}
                            className="text-xs text-[#A32D2D] hover:underline">
                            Eliminar
                          </button>
                        )}
                      </div>

                      <input
                        className="input bg-white text-sm"
                        placeholder="Nombre del medicamento (ej: Atorvastatina 20mg)"
                        value={med.name}
                        onChange={(e) => updateMed(i, 'name', e.target.value)}
                        required
                      />
                      <input
                        className="input bg-white text-sm"
                        placeholder="Presentación (ej: comprimidos)"
                        value={med.presentation}
                        onChange={(e) => updateMed(i, 'presentation', e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="input bg-white text-sm"
                          placeholder="Dosis (ej: 1 comprimido)"
                          value={med.dosage}
                          onChange={(e) => updateMed(i, 'dosage', e.target.value)}
                          required
                        />
                        <input
                          className="input bg-white text-sm"
                          placeholder="Frecuencia (ej: cada 24 hrs)"
                          value={med.frequency}
                          onChange={(e) => updateMed(i, 'frequency', e.target.value)}
                          required
                        />
                      </div>
                      <input
                        className="input bg-white text-sm"
                        placeholder="Duración (ej: 30 días)"
                        value={med.duration}
                        onChange={(e) => updateMed(i, 'duration', e.target.value)}
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
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </div>

              {/* Aviso firma */}
              <div className="bg-[#E6F1FB] rounded-lg px-3 py-2.5">
                <p className="text-xs text-[#185FA5]">
                  🔒 Al emitir, la receta se firmará con un hash SHA-256 vinculado a tu matrícula CMB.
                  Cualquier farmacia puede verificar su autenticidad escaneando el QR.
                </p>
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {createMutation.isPending && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />
                )}
                {createMutation.isPending ? 'Firmando y emitiendo...' : 'Firmar y emitir receta'}
              </button>
            </form>
          </div>

          {/* Recetas emitidas */}
          <div className="card">
            <SectionTitle>Recetas emitidas</SectionTitle>
            <div className="bg-[#E1F5EE] rounded-lg px-3 py-2.5 mb-3">
              <p className="text-xs text-[#0F6E56]">
                Todas las recetas quedan guardadas y son accesibles para el paciente en cualquier momento.
              </p>
            </div>
            <EmptyState
              title="Aún no has emitido recetas"
              description="Las recetas aparecerán aquí una vez que las emitas"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
