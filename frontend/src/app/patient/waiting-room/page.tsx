'use client'
// src/app/patient/waiting-room/page.tsx
// Sala de espera: muestra QR de pago y estado en tiempo real

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { consultationsAPI, getErrorMessage } from '@/lib/api'
import type { Payment, ConsultationStatus } from '@/types'

const IconHome = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconBot = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconClock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>

const NAV = [
  { label: 'Inicio', href: '/patient/dashboard', icon: <IconHome /> },
  { label: 'Buscar médico', href: '/patient/search', icon: <IconSearch /> },
  { label: 'Agente IA', href: '/patient/agent', icon: <IconBot /> },
  { label: 'Sala de espera', href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas', href: '/patient/history', icon: <IconFile /> },
]

const STATUS_STEPS = [
  { key: 'AGENT_TRIAGING', label: 'Triaje con agente IA', done: true },
  { key: 'WAITING_PAYMENT', label: 'Confirmando pago QR', done: false },
  { key: 'PAYMENT_CONFIRMED', label: 'Pago confirmado', done: false },
  { key: 'WAITING_PROFESSIONAL', label: 'Contactando profesional', done: false },
  { key: 'IN_PROGRESS', label: 'Videoconsulta en curso', done: false },
]

function QRTimer({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    const expiry = new Date(expiresAt).getTime()
    const tick = () => {
      const left = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
      setSecs(left)
      if (left === 0) onExpired()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt, onExpired])

  const m = Math.floor(secs / 60)
  const s = secs % 60
  const pct = Math.round((secs / 300) * 100)

  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-full px-3 py-1 flex items-center gap-2">
        <span className="text-[#854F0B] text-xs">Expira en</span>
        <span className="text-[#854F0B] font-bold text-sm font-mono">
          {m}:{s.toString().padStart(2, '0')}
        </span>
      </div>
      {secs === 0 && <span className="badge-red">QR expirado</span>}
    </div>
  )
}

export default function WaitingRoomPage() {
  const params = useSearchParams()
  const router = useRouter()
  const consultationId = params.get('consultationId')

  const [payment, setPayment] = useState<Payment | null>(null)
  const [status, setStatus] = useState<ConsultationStatus>('WAITING_PAYMENT')
  const [qrExpired, setQrExpired] = useState(false)
  const [loadingQR, setLoadingQR] = useState(false)
  const [error, setError] = useState('')

  // Generar QR al entrar
  useEffect(() => {
    if (consultationId) generateQR()
  }, [consultationId])

  // Polling de estado cada 5 segundos
  useEffect(() => {
    if (!consultationId || status === 'IN_PROGRESS' || status === 'COMPLETED') return
    const id = setInterval(async () => {
      try {
        const res = await consultationsAPI.getMyConsultations()
        const c = res.data.find((c) => c.id === consultationId)
        if (c) {
          setStatus(c.status)
          if (c.status === 'IN_PROGRESS' && c.video_room_url) {
            router.push(`/patient/video?url=${encodeURIComponent(c.video_room_url)}`)
          }
        }
      } catch {}
    }, 5000)
    return () => clearInterval(id)
  }, [consultationId, status])

  async function generateQR() {
    if (!consultationId) return
    setLoadingQR(true)
    setError('')
    try {
      const res = await consultationsAPI.generateQR(consultationId)
      setPayment(res.data)
      setQrExpired(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoadingQR(false)
    }
  }

  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === status)

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
      <div className="max-w-xl">

        <div className="mb-5">
          <h1 className="text-base font-semibold">Sala de espera virtual</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Tu consulta está siendo coordinada</p>
        </div>

        {/* Timeline de estado */}
        <div className="card mb-4">
          <h2 className="text-sm font-semibold mb-3">Estado de tu consulta</h2>
          <div className="space-y-0">
            {STATUS_STEPS.map((step, i) => {
              const isDone = i < currentStepIndex
              const isActive = i === currentStepIndex
              return (
                <div key={step.key} className="flex gap-3 pb-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      isDone ? 'bg-[#E1F5EE] text-[#0F6E56]' :
                      isActive ? 'bg-[#185FA5] text-white' :
                      'bg-[#F5F6FA] text-[#A0A8BF]'
                    }`}>
                      {isDone ? '✓' : i + 1}
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`w-0.5 flex-1 mt-1 min-h-[16px] ${isDone ? 'bg-[#1D9E75]' : 'bg-[#DDE1EE]'}`} />
                    )}
                  </div>
                  <div className="pt-1.5">
                    <p className={`text-sm ${isActive ? 'font-semibold text-[#185FA5]' : isDone ? 'text-[#141820]' : 'text-[#A0A8BF]'}`}>
                      {step.label}
                    </p>
                    {isActive && (
                      <p className="text-xs text-[#6B738A] mt-0.5">
                        {status === 'WAITING_PAYMENT' && 'Escanea el QR con tu app bancaria'}
                        {status === 'PAYMENT_CONFIRMED' && 'Conectando con el profesional...'}
                        {status === 'WAITING_PROFESSIONAL' && 'El agente está contactando al profesional...'}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* QR de pago */}
        {status === 'WAITING_PAYMENT' && (
          <div className="card text-center">
            <h2 className="text-sm font-semibold mb-3">Pago QR</h2>

            {error && (
              <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-3 border border-[#F09595]">
                {error}
              </div>
            )}

            {loadingQR ? (
              <div className="py-8 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow" />
                <p className="text-xs text-[#6B738A]">Generando QR...</p>
              </div>
            ) : payment ? (
              <>
                <div className="bg-[#F5F6FA] rounded-xl p-4 inline-block mb-3">
                  <img
                    src={payment.qr_image_url}
                    alt="QR de pago"
                    width={160}
                    height={160}
                    className="mx-auto"
                  />
                </div>

                <p className="text-2xl font-bold text-[#141820] mb-1">
                  Bs. {parseFloat(payment.amount).toFixed(2)}
                </p>
                <p className="text-xs text-[#6B738A] mb-3">Consulta con {payment.professional_name}</p>

                <QRTimer expiresAt={payment.expires_at} onExpired={() => setQrExpired(true)} />

                {qrExpired && (
                  <button onClick={generateQR} className="btn-secondary mt-3 text-xs">
                    Generar nuevo QR
                  </button>
                )}

                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {['BNB', 'Banco Unión', 'Banco Sol', 'Tigo Money', 'Banco Fie'].map((b) => (
                    <span key={b} className="text-xs border border-[#DDE1EE] px-2 py-0.5 rounded-full text-[#6B738A]">{b}</span>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* Buscando profesional */}
        {(status === 'PAYMENT_CONFIRMED' || status === 'WAITING_PROFESSIONAL') && (
          <div className="card text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#E6F1FB] border-2 border-[#185FA5] flex items-center justify-center text-xl mx-auto mb-3 animate-pulse">
              📡
            </div>
            <p className="text-sm font-semibold mb-1">Contactando al profesional</p>
            <p className="text-xs text-[#6B738A]">Si no responde en 60 segundos, el agente buscará otra opción</p>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
