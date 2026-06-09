'use client'
// src/app/patient/waiting-room/page.tsx

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { consultationsAPI, getErrorMessage } from '@/lib/api'
import type { Payment, ConsultationStatus } from '@/types'

const IconHome   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconBot    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconClock  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>

const NAV = [
  { label: 'Inicio',         href: '/patient/dashboard',    icon: <IconHome /> },
  { label: 'Buscar médico',  href: '/patient/search',       icon: <IconSearch /> },
  { label: 'Agente IA',      href: '/patient/agent',        icon: <IconBot /> },
  { label: 'Sala de espera', href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas',  href: '/patient/history',      icon: <IconFile /> },
]

// Nuevo flujo: médico primero, pago después
const STATUS_STEPS = [
  { key: 'WAITING_PROFESSIONAL', label: 'Esperando al médico',     sub: 'El médico tiene 2 minutos para aceptar' },
  { key: 'WAITING_PAYMENT',      label: 'Confirmar pago QR',        sub: 'Escanea el QR con tu app bancaria (5 min)' },
  { key: 'PAYMENT_CONFIRMED',    label: 'Pago confirmado',          sub: 'Procesando...' },
  { key: 'IN_PROGRESS',          label: 'Videoconsulta en curso',   sub: '' },
]

const ACTIVE_STATUSES = ['WAITING_PROFESSIONAL', 'WAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'IN_PROGRESS']

// Timer genérico con cuenta regresiva
function CountdownTimer({ seconds, label, onExpired }: { seconds: number; label: string; onExpired?: () => void }) {
  const [secs, setSecs] = useState(seconds)
  useEffect(() => {
    if (secs <= 0) { onExpired?.(); return }
    const id = setTimeout(() => setSecs(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [secs])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return (
    <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-full px-3 py-1 inline-flex items-center gap-2">
      <span className="text-[#854F0B] text-xs">{label}</span>
      <span className="text-[#854F0B] font-bold text-sm font-mono">{m}:{s.toString().padStart(2, '0')}</span>
    </div>
  )
}

function QRTimer({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const expiry = new Date(expiresAt.endsWith('Z') ? expiresAt : expiresAt + 'Z').getTime()
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
  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-full px-3 py-1 flex items-center gap-2">
        <span className="text-[#854F0B] text-xs">Expira en</span>
        <span className="text-[#854F0B] font-bold text-sm font-mono">{m}:{s.toString().padStart(2, '0')}</span>
      </div>
      {secs === 0 && <span className="text-xs text-red-500 font-medium">QR expirado</span>}
    </div>
  )
}

export default function WaitingRoomPage() {
  const params = useSearchParams()
  const router = useRouter()
  const consultationIdFromUrl = params.get('consultationId')

  const [resolvedId, setResolvedId] = useState<string | null>(consultationIdFromUrl)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [consultationStatus, setConsultationStatus] = useState<ConsultationStatus | null>(null)
  const [consultationCreatedAt, setConsultationCreatedAt] = useState<string | null>(null)
  const [qrExpired, setQrExpired] = useState(false)
  const [loadingQR, setLoadingQR] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [simulatingPayment, setSimulatingPayment] = useState(false)
  const [error, setError] = useState('')
  const qrGeneratedRef = useRef(false)

  const isDev = process.env.NODE_ENV === 'development'

  useEffect(() => { initPage() }, [])

  async function initPage() {
    setLoadingStatus(true)
    try {
      const res = await consultationsAPI.getMyConsultations()
      const consultations = res.data
      let targetId = consultationIdFromUrl

      if (!targetId) {
        const active = consultations.find((c: any) => ACTIVE_STATUSES.includes(c.status))
        if (active) {
          targetId = active.id
          setResolvedId(active.id)
          window.history.replaceState(null, '', `/patient/waiting-room?consultationId=${active.id}`)
        }
      }

      if (!targetId) { setLoadingStatus(false); return }

      const c = consultations.find((c: any) => c.id === targetId)
      if (c) {
        setConsultationStatus(c.status)
        setConsultationCreatedAt(c.created_at)
        if (c.status === 'WAITING_PAYMENT' && !qrGeneratedRef.current) {
          qrGeneratedRef.current = true
          generateQR(targetId)
        }
      }
    } catch {} finally {
      setLoadingStatus(false)
    }
  }

  // Polling cada 4 segundos
  useEffect(() => {
    if (!resolvedId || !consultationStatus) return
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(consultationStatus)) return

    const id = setInterval(async () => {
      try {
        const res = await consultationsAPI.getMyConsultations()
        const c = res.data.find((c: any) => c.id === resolvedId)
        if (c && c.status !== consultationStatus) {
          setConsultationStatus(c.status)
          // Médico aceptó → generar QR automáticamente
          if (c.status === 'WAITING_PAYMENT' && !qrGeneratedRef.current) {
            qrGeneratedRef.current = true
            generateQR(resolvedId)
          }
          if (c.status === 'IN_PROGRESS' && c.video_room_url) {
            router.push(`/patient/video?url=${encodeURIComponent(c.video_room_url)}`)
          }
        }
      } catch {}
    }, 4000)
    return () => clearInterval(id)
  }, [resolvedId, consultationStatus])

  async function generateQR(id?: string) {
    const cid = id || resolvedId
    if (!cid) return
    setLoadingQR(true)
    setError('')
    try {
      const res = await consultationsAPI.generateQR(cid)
      setPayment(res.data)
      setQrExpired(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoadingQR(false)
    }
  }

  async function simulatePayment() {
    if (!resolvedId) return
    setSimulatingPayment(true)
    setError('')
    try {
      await consultationsAPI.simulatePayment(resolvedId)
      setConsultationStatus('PAYMENT_CONFIRMED')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSimulatingPayment(false)
    }
  }

  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === consultationStatus)

  // Segundos restantes para que el médico acepte (2 min desde created_at)
  const professionalTimeoutSecs = consultationCreatedAt
    ? Math.max(0, 120 - Math.floor((Date.now() - new Date(consultationCreatedAt + 'Z').getTime()) / 1000))
    : 120

  if (loadingStatus) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
        <div className="max-w-xl flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    )
  }

  if (!resolvedId || !consultationStatus) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
        <div className="max-w-xl text-center py-16">
          <p className="text-sm font-semibold mb-2">No tienes ninguna consulta en curso</p>
          <p className="text-xs text-[#6B738A] mb-5">Inicia una consulta con el agente o busca un profesional.</p>
          <div className="flex gap-3 justify-center">
            <a href="/patient/agent" className="btn-primary text-xs">Hablar con Medi</a>
            <a href="/patient/search" className="btn-secondary text-xs">Buscar médico</a>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/waiting-room" role="PATIENT">
      <div className="max-w-xl">

        <div className="mb-5">
          <h1 className="text-base font-semibold">Sala de espera virtual</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Tu consulta está siendo coordinada</p>
        </div>

        {/* Timeline */}
        <div className="card mb-4">
          <h2 className="text-sm font-semibold mb-3">Estado de tu consulta</h2>
          <div className="space-y-0">
            {STATUS_STEPS.map((step, i) => {
              const isDone   = i < currentStepIndex
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
                    {isActive && step.sub && (
                      <p className="text-xs text-[#6B738A] mt-0.5">{step.sub}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Esperando que el médico acepte */}
        {consultationStatus === 'WAITING_PROFESSIONAL' && (
          <div className="card text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#E6F1FB] border-2 border-[#185FA5] flex items-center justify-center text-xl mx-auto mb-3 animate-pulse">
              👨‍⚕️
            </div>
            <p className="text-sm font-semibold mb-1">Esperando respuesta del médico</p>
            <p className="text-xs text-[#6B738A] mb-3">El médico tiene 2 minutos para aceptar tu solicitud</p>
            <CountdownTimer
              seconds={professionalTimeoutSecs}
              label="Tiempo restante"
              onExpired={() => setConsultationStatus('CANCELLED')}
            />
            <p className="text-xs text-[#A0A8BF] mt-3">Si no responde, la consulta se cancelará automáticamente sin costo</p>

            {/* DEV: simular aceptación del médico */}
            {isDev && (
              <div className="mt-4 pt-4 border-t border-dashed border-[#DDE1EE]">
                <p className="text-xs text-[#A0A8BF] mb-2">🛠️ Modo desarrollo</p>
                <button
                  onClick={async () => {
                    await consultationsAPI.acceptConsultation(resolvedId!)
                    setConsultationStatus('WAITING_PAYMENT')
                    qrGeneratedRef.current = true
                    generateQR(resolvedId!)
                  }}
                  className="w-full py-2 px-4 bg-[#185FA5] hover:bg-[#0d4a85] text-white text-sm font-medium rounded-lg transition-colors"
                >
                  🩺 Simular que el médico acepta
                </button>
              </div>
            )}
          </div>
        )}

        {/* QR de pago */}
        {consultationStatus === 'WAITING_PAYMENT' && (
          <div className="card text-center">
            <h2 className="text-sm font-semibold mb-1">Pago QR</h2>
            <p className="text-xs text-[#1D9E75] mb-3">✅ El médico aceptó tu consulta</p>

            {error && (
              <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-3 border border-[#F09595]">
                {error}
              </div>
            )}

            {loadingQR ? (
              <div className="py-8 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-[#6B738A]">Generando QR...</p>
              </div>
            ) : payment ? (
              <>
                <div className="bg-[#F5F6FA] rounded-xl p-4 inline-block mb-3">
                  <img src={payment.qr_image_url} alt="QR de pago" width={160} height={160} className="mx-auto" />
                </div>
                <p className="text-2xl font-bold text-[#141820] mb-1">
                  Bs. {parseFloat(payment.amount).toFixed(2)}
                </p>
                <p className="text-xs text-[#6B738A] mb-3">Consulta con {payment.professional_name}</p>
                <QRTimer expiresAt={payment.expires_at} onExpired={() => setQrExpired(true)} />
                {qrExpired && (
                  <p className="text-xs text-[#A32D2D] mt-2">El tiempo de pago expiró. La consulta fue cancelada automáticamente.</p>
                )}
                <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                  {['BNB', 'Banco Unión', 'Banco Sol', 'Tigo Money', 'Banco Fie'].map((b) => (
                    <span key={b} className="text-xs border border-[#DDE1EE] px-2 py-0.5 rounded-full text-[#6B738A]">{b}</span>
                  ))}
                </div>
              </>
            ) : null}

            {isDev && (
              <div className="mt-4 pt-4 border-t border-dashed border-[#DDE1EE]">
                <p className="text-xs text-[#A0A8BF] mb-2">🛠️ Modo desarrollo</p>
                <div className="flex flex-col gap-2">
                  {!payment && !loadingQR && (
                    <button
                      onClick={() => { qrGeneratedRef.current = false; generateQR() }}
                      className="w-full py-2 px-4 bg-[#185FA5] hover:bg-[#0d4a85] text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      🔄 Reintentar generar QR
                    </button>
                  )}
                  <button
                    onClick={simulatePayment}
                    disabled={simulatingPayment}
                    className="w-full py-2 px-4 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    {simulatingPayment ? 'Procesando...' : '⚡ Saltar pago (simular confirmado)'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pago confirmado */}
        {consultationStatus === 'PAYMENT_CONFIRMED' && (
          <div className="card text-center py-6">
            <div className="w-12 h-12 rounded-full bg-[#E1F5EE] border-2 border-[#1D9E75] flex items-center justify-center text-xl mx-auto mb-3">
              ✅
            </div>
            <p className="text-sm font-semibold mb-1">Pago confirmado</p>
            <p className="text-xs text-[#6B738A]">Conectando con el médico para iniciar la videoconsulta...</p>
          </div>
        )}

        {/* Cancelada */}
        {consultationStatus === 'CANCELLED' && (
          <div className="card text-center py-6">
            <p className="text-sm font-semibold text-[#A32D2D] mb-1">Consulta cancelada</p>
            <p className="text-xs text-[#6B738A] mb-4">No se realizó ningún cobro.</p>
            <a href="/patient/search" className="btn-primary text-xs">Buscar otro médico</a>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}