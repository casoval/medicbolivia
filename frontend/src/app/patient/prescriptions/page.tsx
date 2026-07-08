'use client'
// src/app/patient/prescriptions/page.tsx

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { prescriptionsAPI, buildPrescriptionVerifyUrl } from '@/lib/api'
import type { Medication, Prescription } from '@/types'

function QRCode({ value, size = 140 }: { value: string; size?: number }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&margin=8&color=042C53`
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-white p-3 rounded-xl border-2 border-[#DDE1EE] shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`QR ${value}`} width={size} height={size} className="rounded" />
      </div>
      <p className="text-[10px] font-mono font-bold text-[#185FA5] tracking-widest">{value}</p>
    </div>
  )
}

function PrescriptionCard({ rx }: { rx: Prescription }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const meds: Medication[] = Array.isArray(rx.medications) ? rx.medications : []

  function copyCode() {
    navigator.clipboard.writeText(rx.qr_verify_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="border border-[#DDE1EE] rounded-2xl overflow-hidden bg-white shadow-sm">
      {/* Cabecera */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-full bg-[#E6F1FB] flex items-center justify-center text-lg flex-shrink-0">
          💊
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1F2E]">
            {rx.professional_name ?? 'Médico'}
          </p>
          <p className="text-xs text-[#6B738A] mt-0.5">
            {rx.professional_specialty && <span className="mr-1">{rx.professional_specialty} ·</span>}
            {meds.length} medicamento{meds.length !== 1 ? 's' : ''} ·{' '}
            {new Date(rx.signed_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
          {(rx.professional_department || (rx.professional_sub_specialties && rx.professional_sub_specialties.length > 0)) && (
            <p className="text-xs text-[#A0A8BF] mt-0.5">
              {rx.professional_sub_specialties?.join(', ') || ''}
              {rx.professional_department && rx.professional_sub_specialties?.length ? ' · ' : ''}
              {rx.professional_department || ''}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-[#6B738A] text-xs bg-[#F5F6FA] w-6 h-6 rounded-full flex items-center justify-center">
          {open ? '▲' : '▼'}
        </div>
      </button>

      {/* Detalle */}
      {open && (
        <div className="border-t border-[#DDE1EE]">

          {/* Encabezado receta */}
          <div className="bg-[#042C53] px-4 sm:px-5 py-4 text-white">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
              <div>
                <p className="text-xs text-white/60 uppercase tracking-wide mb-0.5">Médico tratante</p>
                <p className="font-bold text-base">{rx.professional_name ?? '—'}</p>
                <p className="text-sm text-white/80">
                  {rx.professional_specialty}
                  {rx.professional_sub_specialties && rx.professional_sub_specialties.length > 0
                    ? ` · ${rx.professional_sub_specialties.join(', ')}`
                    : ''}
                </p>
                {rx.professional_department && (
                  <p className="text-xs text-white/60 mt-0.5">{rx.professional_department}</p>
                )}
                {rx.cmb_matricula && (
                  <p className="text-xs text-white/60 mt-1">Matrícula CMB: <span className="text-white/90 font-mono">{rx.cmb_matricula}</span></p>
                )}
              </div>
              <div className="text-left sm:text-right flex-shrink-0">
                <p className="text-xs text-white/60 uppercase tracking-wide mb-0.5">Paciente</p>
                <p className="text-sm font-semibold">{rx.patient_name}</p>
                <p className="text-xs text-white/70">CI: {rx.patient_ci}</p>
                <p className="text-xs text-white/70">{rx.patient_age} años</p>
              </div>
            </div>
            <p className="text-xs text-white/50 mt-3">
              Emitida el {new Date(rx.signed_at).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          <div className="px-5 py-4 space-y-4 bg-[#FAFBFC]">

            {/* Medicamentos */}
            <div>
              <p className="text-xs font-bold text-[#6B738A] uppercase tracking-wide mb-2">Medicamentos prescritos</p>
              <div className="space-y-2">
                {meds.map((m, i) => (
                  <div key={i} className="bg-white rounded-xl border border-[#DDE1EE] p-3.5">
                    <div className="flex items-start gap-2">
                      <span className="text-[#185FA5] font-bold text-sm w-5 flex-shrink-0">{i + 1}.</span>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-[#1A1F2E]">{m.name}</p>
                        {m.presentation && <p className="text-xs text-[#6B738A]">{m.presentation}</p>}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {m.dosage    && <span className="text-xs bg-[#E6F1FB] text-[#185FA5] px-2.5 py-1 rounded-full font-medium">💊 {m.dosage}</span>}
                          {m.frequency && <span className="text-xs bg-[#E6F1FB] text-[#185FA5] px-2.5 py-1 rounded-full font-medium">🕐 {m.frequency}</span>}
                          {m.duration  && <span className="text-xs bg-[#E6F1FB] text-[#185FA5] px-2.5 py-1 rounded-full font-medium">📅 {m.duration}</span>}
                        </div>
                        {m.notes && <p className="text-xs text-[#6B738A] mt-1.5 italic">{m.notes}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Indicaciones */}
            {rx.instructions && (
              <div className="bg-[#FAEEDA] rounded-xl px-4 py-3 border border-[#F3D08A]">
                <p className="text-xs font-bold text-[#854F0B] mb-1">📌 Indicaciones del médico</p>
                <p className="text-sm text-[#854F0B] leading-relaxed">{rx.instructions}</p>
              </div>
            )}

            {/* QR + firma digital */}
            <div className="bg-white rounded-xl border border-[#DDE1EE] p-4">
              <p className="text-xs font-bold text-[#6B738A] uppercase tracking-wide mb-4">Verificación y firma digital</p>

              <div className="flex flex-col sm:flex-row gap-5 items-start">
                <div className="flex-shrink-0">
                  <QRCode value={buildPrescriptionVerifyUrl(rx.qr_verify_code)} size={130} />
                  <p className="text-[10px] text-[#6B738A] text-center mt-1 max-w-[130px]">
                    Presenta en farmacia para verificar
                  </p>
                </div>

                <div className="flex-1 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-[#1A1F2E] mb-1">¿Cómo funciona la firma?</p>
                    <p className="text-xs text-[#6B738A] leading-relaxed">
                      Esta receta fue firmada criptográficamente con el algoritmo SHA-256.
                      El hash combina tu CI, los medicamentos, la matrícula del médico y la fecha exacta de emisión.
                      Si alguien altera cualquier dato, el hash cambia y la receta se invalida automáticamente.
                    </p>
                  </div>

                  <div className="bg-[#F5F6FA] rounded-lg p-2.5">
                    <p className="text-[10px] text-[#6B738A] font-semibold mb-1">Hash SHA-256</p>
                    <p className="text-[10px] font-mono text-[#185FA5] break-all leading-relaxed">
                      {rx.digital_hash}
                    </p>
                  </div>

                  <button
                    onClick={copyCode}
                    className={`w-full py-2 rounded-lg text-xs font-medium transition-colors ${
                      copied
                        ? 'bg-[#E1F5EE] text-[#0F6E56]'
                        : 'bg-[#E6F1FB] text-[#185FA5] hover:bg-[#B5D4F4]'
                    }`}
                  >
                    {copied ? '✓ Código copiado' : '📋 Copiar código de verificación'}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

// ── Grupo de recetas del mismo profesional ────────────
function ProfessionalRxGroup({ group }: { group: { key: string; professionalName: string; specialty?: string | null; items: Prescription[] } }) {
  const [open, setOpen] = useState(true)
  const sorted = [...group.items].sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime())

  return (
    <div className="border border-[#DDE1EE] rounded-2xl overflow-hidden bg-white shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-[#F5F6FA] transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {group.professionalName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A1F2E] truncate">{group.professionalName}</p>
          <p className="text-xs text-[#6B738A]">
            {group.specialty ? `${group.specialty} · ` : ''}
            {group.items.length} receta{group.items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="text-[#A0A8BF] text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="divide-y divide-[#DDE1EE]">
          {sorted.map(rx => (
            <div key={rx.id} className="px-2 py-2">
              <PrescriptionCard rx={rx} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PatientPrescriptionsPage() {
  const [viewMode, setViewMode] = useState<'date' | 'professional'>('date')

  const { data: prescriptions = [], isLoading } = useQuery({
    queryKey: ['prescriptions', 'patient'],
    queryFn: () => prescriptionsAPI.getMyPatient(),
  })

  const sortedByDate = [...(prescriptions as Prescription[])].sort(
    (a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime()
  )

  // Agrupar por profesional (nombre + matrícula CMB como clave, para no mezclar homónimos)
  type ProfGroup = { key: string; professionalName: string; specialty?: string | null; items: Prescription[] }
  const groupedByProfessional: ProfGroup[] = Object.values(
    (prescriptions as Prescription[]).reduce((acc: Record<string, ProfGroup>, rx) => {
      const key = rx.cmb_matricula || rx.professional_name || 'desconocido'
      if (!acc[key]) {
        acc[key] = {
          key,
          professionalName: rx.professional_name || 'Médico',
          specialty: rx.professional_specialty,
          items: [],
        }
      }
      acc[key].items.push(rx)
      return acc
    }, {})
  ).sort((a, b) => {
    const latestA = Math.max(...a.items.map(r => new Date(r.signed_at).getTime()))
    const latestB = Math.max(...b.items.map(r => new Date(r.signed_at).getTime()))
    return latestB - latestA
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/prescriptions" role="PATIENT">
      <div className="max-w-2xl">
        <div className="mb-5">
          <h1 className="text-base font-semibold">Mis recetas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Recetas médicas digitales firmadas. Presenta el código QR en cualquier farmacia para verificarlas.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(n => <div key={n} className="h-20 bg-[#F5F6FA] rounded-2xl animate-pulse" />)}
          </div>
        ) : prescriptions.length === 0 ? (
          <div className="card text-center py-14">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm font-semibold text-[#1A1F2E]">Sin recetas aún</p>
            <p className="text-xs text-[#6B738A] mt-1 max-w-xs mx-auto">
              Las recetas que te emita tu médico durante las consultas aparecerán aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#A0A8BF]">
                {sortedByDate.length} receta{sortedByDate.length !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-1 bg-[#F5F6FA] rounded-lg p-1">
                <button
                  onClick={() => setViewMode('date')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'date' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  🕐 Por fecha
                </button>
                <button
                  onClick={() => setViewMode('professional')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${viewMode === 'professional' ? 'bg-white text-[#185FA5] shadow-sm' : 'text-[#6B738A]'}`}
                >
                  🩺 Por profesional
                </button>
              </div>
            </div>

            {viewMode === 'date' ? (
              <div className="space-y-3">
                {sortedByDate.map((rx) => (
                  <PrescriptionCard key={rx.id} rx={rx} />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByProfessional.map(group => (
                  <ProfessionalRxGroup key={group.key} group={group} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}