'use client'
// src/app/auth/login/page.tsx
// Página de inicio de sesión conectada al backend FastAPI

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/lib/store'
import { getErrorMessage } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const login = useAuthStore((s) => s.login)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(phone, password)
      // Redirigir según el rol
      const user = useAuthStore.getState().user
      if (user?.role === 'PATIENT') router.push('/patient/dashboard')
      else if (user?.role === 'PROFESSIONAL') router.push('/professional/dashboard')
      else if (user?.role === 'ADMIN') router.push('/admin/dashboard')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#042C53]">
            Medic<span className="font-normal text-[#6B738A]">Bolivia</span>
          </h1>
          <p className="text-sm text-[#6B738A] mt-1">Telemedicina con inteligencia artificial</p>
        </div>

        {/* Formulario */}
        <div className="card">
          <h2 className="text-base font-semibold mb-5">Iniciar sesión</h2>

          {error && (
            <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-4 border border-[#F09595]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Número de celular</label>
              <input
                type="tel"
                className="input"
                placeholder="72345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="label">Contraseña</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />
              )}
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-[#DDE1EE] text-center space-y-2">
            <p className="text-sm text-[#6B738A]">
              ¿Eres paciente nuevo?{' '}
              <Link href="/auth/register/patient" className="text-[#185FA5] font-medium hover:underline">
                Regístrate aquí
              </Link>
            </p>
            <p className="text-sm text-[#6B738A]">
              ¿Eres profesional de salud?{' '}
              <Link href="/auth/register/professional" className="text-[#0F6E56] font-medium hover:underline">
                Únete a MedicBolivia
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[#A0A8BF] mt-4">
          Al ingresar aceptas nuestros Términos de Uso y Política de Privacidad
        </p>
      </div>
    </div>
  )
}
