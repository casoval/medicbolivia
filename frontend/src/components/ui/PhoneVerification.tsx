'use client'
// src/components/ui/PhoneVerification.tsx
//
// Verificación de número de celular por WhatsApp (OTP de 6 dígitos).
// Se usa en registro de paciente/profesional y puede reusarse en
// cualquier otro flujo que necesite confirmar que la persona controla
// ese número antes de continuar.
//
// Importante: acá conviven DOS tiempos distintos, y el texto los separa
// a propósito para no confundirlos:
//   - "Reenviar código (56s)": cooldown para pedir un código nuevo
//     (evita mandar varios WhatsApp seguidos y disparar el filtro
//     anti-spam de Meta). NO es el tiempo que tenés para escribir el
//     código.
//   - "El código vence en 20 minutos": tiempo real de expiración del
//     código ya enviado (settings.OTP_EXPIRE_MINUTES en el backend).
//     Se muestra el número real que devuelve el backend, no un texto
//     fijo hardcodeado, para que si se cambia la config no queden
//     desincronizados.

import { useState, useEffect, useRef } from 'react'
import { otpAPI, getErrorMessage } from '@/lib/api'

interface PhoneVerificationProps {
  phone: string
  onVerified: () => void
  verified: boolean
}

export function PhoneVerification({ phone, onVerified, verified }: PhoneVerificationProps) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [expireMinutes, setExpireMinutes] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Si el número cambia después de haber enviado un código (la persona
  // corrigió el celular), invalidamos el estado de "enviado" para que no
  // quede la falsa sensación de que ese número nuevo ya está confirmado.
  useEffect(() => {
    setSent(false)
    setCode('')
    setError('')
  }, [phone])

  useEffect(() => {
    if (cooldown <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0))
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [cooldown])

  async function handleSend() {
    if (!phone || phone.length < 8) {
      setError('Ingresá tu número de celular primero')
      return
    }
    setError('')
    setSending(true)
    try {
      const res = await otpAPI.send(phone)
      setSent(true)
      setCode('')
      setCooldown(60)
      setExpireMinutes(res.data.expires_in_minutes)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  async function handleVerify() {
    if (code.length < 4) {
      setError('Ingresá el código completo')
      return
    }
    setError('')
    setVerifying(true)
    try {
      await otpAPI.verify(phone, code)
      onVerified()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  if (verified) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#0F6E56] bg-[#0F6E56]/5 border border-[#0F6E56]/20 rounded-lg px-3 py-2">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
        </svg>
        Número verificado por WhatsApp
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {!sent ? (
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !phone}
          className="btn-secondary w-full flex items-center justify-center gap-2 text-sm py-2"
        >
          {sending && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin-slow" />}
          {sending ? 'Enviando...' : 'Verificar número por WhatsApp'}
        </button>
      ) : (
        <div className="space-y-2 bg-[#F5F6FA] border border-[#DDE1EE] rounded-lg p-3">
          <p className="text-xs text-[#6B738A]">
            Te enviamos un código de 6 dígitos por WhatsApp al{' '}
            <span className="font-medium text-[#3A4155]">+{phone}</span>.
            {expireMinutes != null && (
              <> El código vence en {expireMinutes} minutos.</>
            )}
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input flex-1 tracking-widest text-center"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying || code.length < 4}
              className="btn-primary px-4 flex items-center justify-center gap-2 text-sm"
            >
              {verifying && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
              {verifying ? 'Verificando...' : 'Confirmar'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={cooldown > 0 || sending}
            className="text-xs text-[#185FA5] font-medium disabled:text-[#A0A8BF] disabled:cursor-not-allowed"
          >
            {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-[#A32D2D]">{error}</p>
      )}
    </div>
  )
}
