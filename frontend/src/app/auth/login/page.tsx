'use client'
// src/app/auth/login/page.tsx
// Página de inicio de sesión conectada al backend FastAPI

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useAuthStore } from '@/lib/store'
import { getErrorMessage } from '@/lib/api'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// Puntos clave reutilizados del material de marca (afiches)
const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path
          d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    title: 'Teleconsultas fáciles y seguras',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    ),
    title: 'Médicos especialistas disponibles 24/7',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path
          d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M9.5 12l1.8 1.8L14.5 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: 'Tecnología segura y datos protegidos',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path
          d="M9.5 3a6.5 6.5 0 1 0 4.6 11.1L19 19M9.5 3a6.5 6.5 0 0 1 4.6 11.1"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M7 11h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
    title: 'IA que mejora cada diagnóstico',
  },
]

export default function LoginPage() {
  const router = useRouter()
  const login = useAuthStore((s) => s.login)
  const { t } = useLanguage()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeFeature, setActiveFeature] = useState(0)

  // Rota automáticamente la feature destacada del panel cada 3.5s
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % FEATURES.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [])

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
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-0 items-center">

        {/* Panel informativo — solo visible en desktop (lg+) */}
        <div className="hidden lg:flex flex-col pr-10">
          <div className="flex items-center justify-between mb-8 -ml-2 animate-fade-up">
            <Link href="/" className="w-fit">
              <Image
                src="/logo.png"
                alt="MedicBolivia"
                width={1779}
                height={339}
                className="w-96 h-auto"
                priority
              />
            </Link>
            <LanguageSwitcher variant="light" />
          </div>

          <h2
            className="text-2xl font-bold text-[#042C53] leading-snug mb-3 animate-fade-up"
            style={{ animationDelay: '120ms' }}
          >
            {t('Tu atención médica,')}<br />{t('donde estés')}
          </h2>
          <p
            className="text-sm text-[#6B738A] mb-8 max-w-xs animate-fade-up"
            style={{ animationDelay: '220ms' }}
          >
            {t('Telemedicina con inteligencia artificial al servicio de la salud boliviana.')}
          </p>

          {/* Carrusel de features — rota automáticamente */}
          <div
            className="relative h-16 animate-fade-up"
            style={{ animationDelay: '320ms' }}
          >
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`absolute inset-0 flex items-center gap-3 transition-all duration-500 ${
                  i === activeFeature
                    ? 'opacity-100 translate-x-0'
                    : 'opacity-0 translate-x-2 pointer-events-none'
                }`}
              >
                <span className="flex items-center justify-center w-10 h-10 rounded-full border border-[#0F6E56]/30 text-[#0F6E56] shrink-0">
                  {f.icon}
                </span>
                <span className="text-base text-[#3A4155] font-medium">{t(f.title)}</span>
              </div>
            ))}
          </div>

          {/* Indicadores del carrusel */}
          <div className="flex gap-2 mt-4">
            {FEATURES.map((f, i) => (
              <button
                key={f.title}
                type="button"
                aria-label={`Ver: ${f.title}`}
                onClick={() => setActiveFeature(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === activeFeature ? 'w-8 bg-[#0F6E56]' : 'w-3 bg-[#0F6E56]/25'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Columna del formulario */}
        <div className="w-full max-w-sm mx-auto">

          {/* Volver a la página principal — visible siempre, arriba de todo en esta columna */}
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-[#6B738A] hover:text-[#185FA5] mb-4 animate-fade-up"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('Volver al inicio')}
          </Link>

          {/* Logo — visible solo en mobile/tablet (el panel de la izquierda ya lo muestra en desktop) */}
          <Link href="/" className="block text-center mb-6 lg:hidden animate-fade-up">
            <Image
              src="/logo.png"
              alt="MedicBolivia"
              width={1779}
              height={339}
              className="w-56 h-auto mx-auto"
              priority
            />
          </Link>

          {/* Mini-banner de features — solo mobile/tablet, rota automáticamente */}
          <div
            className="lg:hidden mb-6 bg-white rounded-xl border border-[#DDE1EE] px-4 py-3 animate-fade-up"
            style={{ animationDelay: '120ms' }}
          >
            <div className="relative h-9 overflow-hidden">
              {FEATURES.map((f, i) => (
                <div
                  key={f.title}
                  className={`absolute inset-0 flex items-center gap-2 transition-all duration-500 ${
                    i === activeFeature
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 translate-x-2 pointer-events-none'
                  }`}
                >
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#0F6E56]/10 text-[#0F6E56] shrink-0">
                    {f.icon}
                  </span>
                  <span className="text-xs text-[#3A4155] font-medium">{t(f.title)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2 justify-center">
              {FEATURES.map((f, i) => (
                <span
                  key={f.title}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i === activeFeature ? 'w-5 bg-[#0F6E56]' : 'w-2 bg-[#0F6E56]/25'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Formulario */}
          <div className="card animate-fade-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-base font-semibold mb-5">{t('Iniciar sesión')}</h2>

            {error && (
              <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-4 border border-[#F09595]">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">{t('Número de celular')}</label>
                <PhoneInput
                  value={phone}
                  onChange={setPhone}
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">{t('Contraseña')}</label>
                  <Link href="/auth/forgot-password" className="text-xs text-[#185FA5] font-medium hover:underline">
                    {t('¿Olvidaste tu contraseña?')}
                  </Link>
                </div>
                <input
                  type="password"
                  autoComplete="current-password"
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
                {loading ? t('Ingresando...') : t('Ingresar')}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-[#DDE1EE] text-center space-y-2">
              <p className="text-sm text-[#6B738A]">
                {t('¿Eres paciente nuevo?')}{' '}
                <Link href="/auth/register/patient" className="text-[#185FA5] font-medium hover:underline">
                  {t('Regístrate aquí')}
                </Link>
              </p>
              <p className="text-sm text-[#6B738A]">
                {t('¿Eres profesional de salud?')}{' '}
                <Link href="/auth/register/professional" className="text-[#0F6E56] font-medium hover:underline">
                  {t('Únete a MedicBolivia')}
                </Link>
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-[#A0A8BF] mt-4">
            {t('Al ingresar aceptas nuestros Términos de Uso y Política de Privacidad')}
          </p>
        </div>
      </div>
    </div>
  )
}