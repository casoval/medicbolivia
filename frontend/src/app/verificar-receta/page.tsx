'use client'
// src/app/verificar-receta/page.tsx
// Página pública (sin login) para que cualquiera — típicamente una farmacia —
// verifique la autenticidad de una receta digital a partir del código QR.
// Llega acá tanto por link directo (QR escaneado, ?code=...) como escribiendo
// el código a mano.

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { prescriptionsAPI, getErrorMessage } from '@/lib/api'
import { Spinner } from '@/components/ui'
import { QrScannerModal } from '@/components/shared/QrScannerModal'
import type { Medication } from '@/types'
import { getLicenseInfo } from '@/lib/professionalLicense'

interface VerifyResult {
  valid: boolean
  status?: 'ACTIVE' | 'VOIDED'
  prescription_id?: string
  qr_code?: string
  digital_hash?: string
  patient_name?: string
  patient_ci?: string
  patient_age?: number
  medications?: Medication[]
  instructions?: string
  signed_at?: string
  professional_name?: string
  professional_specialty?: string
  professional_sub_specialties?: string[]
  professional_department?: string
  professional_license_number?: string
  cmb_matricula?: string
  professional_signature_url?: string | null
  professional_photo_url?: string | null
  pdf_url?: string | null
  voided_at?: string | null
  void_reason?: string | null
  message: string
}

function fmtFechaHora(iso: string) {
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleString('es-BO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/La_Paz',
  })
}

function VerifyForm() {
  const searchParams = useSearchParams()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)

  async function runVerify(value: string) {
    if (!value.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await prescriptionsAPI.verify(value.trim())
      setResult(res.data as VerifyResult)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Si llegó desde el QR con ?code=..., verifica automáticamente.
  useEffect(() => {
    const fromQuery = searchParams.get('code')
    if (fromQuery) {
      setCode(fromQuery)
      runVerify(fromQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScanResult(scannedCode: string) {
    setScannerOpen(false)
    setCode(scannedCode)
    runVerify(scannedCode)
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Link href="/" className="inline-block mb-4">
          <Image src="/logo1.png" alt="MedicBolivia" width={1262} height={173} className="h-8 w-auto mx-auto" priority />
        </Link>
        <div className="w-14 h-14 rounded-2xl bg-[#E6F1FB] flex items-center justify-center mx-auto mb-3 text-2xl">
          🔍
        </div>
        <h1 className="text-xl font-bold text-[#141820]">Verificar receta médica</h1>
        <p className="text-sm text-[#475569] mt-1">
          Escaneá el código QR de la receta o ingresá el código manualmente para confirmar
          que fue emitida por un profesional verificado en MedicBolivia.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#85B7EB] text-[#185FA5] text-sm font-medium py-3 rounded-xl mb-3 hover:bg-[#E6F1FB] transition-colors"
      >
        <span className="text-lg leading-none">📷</span> Escanear código QR con la cámara
      </button>

      <div className="flex items-center gap-3 mb-3">
        <div className="h-px flex-1 bg-[#DDE1EE]" />
        <span className="text-[11px] text-[#94A3B8]">o ingresá el código a mano</span>
        <div className="h-px flex-1 bg-[#DDE1EE]" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          runVerify(code)
        }}
        className="flex gap-2 mb-6"
      >
        <input
          className="flex-1 rounded-lg border border-[#DDE1EE] px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
          placeholder="Ej: MB-RX-A1B2C3D4E5F6"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-60"
        >
          {loading ? <Spinner size="sm" /> : 'Verificar'}
        </button>
      </form>

      <QrScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onResult={handleScanResult} />

      {error && (
        <div className="text-sm px-3 py-2.5 rounded-lg border bg-[#FCEBEB] text-[#A32D2D] border-[#F09595] mb-4">
          {error}
        </div>
      )}

      {result && !result.valid && (
        <div className="rounded-xl border border-[#F09595] bg-[#FCEBEB] p-5 text-center">
          <p className="text-3xl mb-2">✕</p>
          <p className="font-semibold text-[#A32D2D]">
            {result.status === 'VOIDED' ? 'Receta anulada' : 'Código no válido'}
          </p>
          <p className="text-sm text-[#993C1D] mt-1">{result.message}</p>
          {result.status === 'VOIDED' && result.voided_at && (
            <p className="text-xs text-[#993C1D] mt-2">
              Anulada el {fmtFechaHora(result.voided_at)}
              {result.void_reason ? ` — Motivo: ${result.void_reason}` : ''}
            </p>
          )}
        </div>
      )}

      {result && result.valid && (
        <div className="rounded-xl border border-[#9FE1CB] bg-[#E1F5EE] p-5">
          <div className="text-center mb-4">
            <p className="text-3xl mb-1">✓</p>
            <p className="font-semibold text-[#0F6E56]">Receta válida y auténtica</p>
            <p className="text-xs text-[#0F6E56] mt-0.5">Emitida por MedicBolivia</p>
          </div>

          <div className="bg-white rounded-lg p-4 space-y-3 text-sm">
            <div>
              <p className="text-[10px] uppercase text-[#475569] font-medium">Paciente</p>
              <p className="text-[#141820]">{result.patient_name} · CI {result.patient_ci} · {result.patient_age} años</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[#475569] font-medium">Emitida por</p>
              <p className="text-[#141820]">
                {result.professional_name} — {result.professional_specialty}
                {result.professional_sub_specialties && result.professional_sub_specialties.length > 0
                  ? ` (${result.professional_sub_specialties.join(', ')})` : ''}
                {getLicenseInfo(result) ? ` · ${getLicenseInfo(result)!.label} ${getLicenseInfo(result)!.value}` : ''}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[#475569] font-medium">Fecha de emisión</p>
              <p className="text-[#141820]">{result.signed_at && fmtFechaHora(result.signed_at)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[#475569] font-medium">Medicamentos</p>
              <ul className="mt-1 space-y-1.5">
                {(result.medications ?? []).map((m, i) => (
                  <li key={i} className="text-[#141820]">
                    <span className="font-medium">{m.name}</span>
                    {m.presentation ? ` (${m.presentation})` : ''} — {m.dosage}, {m.frequency}, {m.duration}
                    {m.notes ? <span className="text-[#475569]"> · {m.notes}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            {result.instructions && (
              <div>
                <p className="text-[10px] uppercase text-[#475569] font-medium">Indicaciones</p>
                <p className="text-[#141820] whitespace-pre-wrap">{result.instructions}</p>
              </div>
            )}

            {result.professional_signature_url && (
              <div>
                <p className="text-[10px] uppercase text-[#475569] font-medium mb-1">Firma digital del médico</p>
                <div className="border border-[#ECEEF5] rounded-lg p-2 bg-[#FAFBFC] flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.professional_signature_url} alt={`Firma de ${result.professional_name}`} className="h-16 object-contain" />
                  <p className="text-[10px] text-[#94A3B8] mt-1">{result.professional_name}</p>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-[#ECEEF5]">
              <p className="text-[10px] text-[#475569] font-mono break-all">
                Código: {result.qr_code} · Hash: {result.digital_hash?.slice(0, 16)}…
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="text-center mt-8">
        <Link href="/" className="text-sm text-[#185FA5] hover:underline">
          ← Volver al inicio
        </Link>
      </div>
    </div>
  )
}

export default function VerifyPrescriptionPage() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] px-4 py-10">
      <Suspense fallback={<div className="text-center text-sm text-[#475569]">Cargando...</div>}>
        <VerifyForm />
      </Suspense>
    </div>
  )
}
