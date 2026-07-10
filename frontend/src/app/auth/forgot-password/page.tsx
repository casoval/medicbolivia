'use client'
// src/app/auth/forgot-password/page.tsx
// Recuperación de contraseña vía código de WhatsApp.
//
// Dos pasos:
//   1) Ingresar celular -> POST /auth/password/forgot. Si el número no
//      está registrado, el backend devuelve 404 y se muestra el error
//      acá mismo, sin avanzar al paso 2 (decisión de producto: priorizar
//      claridad para el usuario sobre anti-enumeración estricta — ver
//      nota en el endpoint del backend).
//   2) Ingresar el código recibido + contraseña nueva -> POST
//      /auth/password/reset.

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { passwordResetAPI, getErrorMessage } from '@/lib/api'
import { PhoneInput } from '@/components/ui/PhoneInput'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [expireMinutes, setExpireMinutes] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (cooldown <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [cooldown])

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await passwordResetAPI.forgot(phone)
      setExpireMinutes(res.data.expires_in_minutes)
      setCooldown(60)
      setStep(2)
    } catch (err) {
      // Acá se muestra tal cual el mensaje del backend, incluyendo el
      // caso de "número no está registrado" — es intencional, ver nota
      // arriba.
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleResendCode() {
    if (cooldown > 0) return
    setError('')
    setLoading(true)
    try {
      const res = await passwordResetAPI.forgot(phone)
      setExpireMinutes(res.data.expires_in_minutes)
      setCooldown(60)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }

    setLoading(true)
    try {
      await passwordResetAPI.reset(phone, code, newPassword)
      setSuccess(true)
      setTimeout(() => router.push('/auth/login'), 2500)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Link href="/" className="inline-block">
            <Image src="/logo1.png" alt="MedicBolivia" width={1262} height={173} className="h-8 w-auto mx-auto" priority />
          </Link>
          <p className="text-sm text-[#6B738A] mt-1">Recuperar contraseña</p>
        </div>

        <div className="card">
          {success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#0F6E56]/10 text-[#0F6E56] flex items-center justify-center mx-auto mb-3">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                  <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-base font-semibold mb-1">Contraseña actualizada</h2>
              <p className="text-sm text-[#6B738A]">Te llevamos al inicio de sesión...</p>
            </div>
          ) : step === 1 ? (
            <>
              <h2 className="text-base font-semibold mb-1">¿Olvidaste tu contraseña?</h2>
              <p className="text-sm text-[#6B738A] mb-5">
                Ingresá tu número de celular y te mandamos un código por WhatsApp para restablecerla.
              </p>

              {error && (
                <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-4 border border-[#F09595]">
                  {error}
                </div>
              )}

              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label className="label">Número de celular</label>
                  <PhoneInput value={phone} onChange={setPhone} required />
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                  {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
                  {loading ? 'Enviando...' : 'Enviar código por WhatsApp'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold mb-1">Ingresá el código y tu contraseña nueva</h2>
              <p className="text-sm text-[#6B738A] mb-5">
                Te enviamos un código de 6 dígitos por WhatsApp al{' '}
                <span className="font-medium text-[#3A4155]">+{phone}</span>.
                {expireMinutes != null && <> Vence en {expireMinutes} minutos.</>}
              </p>

              {error && (
                <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-4 border border-[#F09595]">
                  {error}
                </div>
              )}

              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="label">Código de WhatsApp</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="input tracking-widest text-center"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={cooldown > 0 || loading}
                    className="text-xs text-[#185FA5] font-medium mt-1.5 disabled:text-[#A0A8BF] disabled:cursor-not-allowed"
                  >
                    {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
                  </button>
                </div>

                <div>
                  <label className="label">Contraseña nueva</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="input"
                    placeholder="Mínimo 8 caracteres"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>

                <div>
                  <label className="label">Confirmar contraseña nueva</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="input"
                    placeholder="Repetir contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                  {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
                  {loading ? 'Actualizando...' : 'Restablecer contraseña'}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep(1); setError(''); setCode(''); }}
                  className="text-xs text-[#6B738A] hover:underline w-full text-center"
                >
                  Usar otro número
                </button>
              </form>
            </>
          )}

          {!success && (
            <p className="text-center text-sm text-[#6B738A] mt-4 pt-4 border-t border-[#DDE1EE]">
              <Link href="/auth/login" className="text-[#185FA5] font-medium hover:underline">
                Volver a iniciar sesión
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
