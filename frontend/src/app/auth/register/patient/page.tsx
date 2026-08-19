'use client'
// src/app/auth/register/patient/page.tsx
// Registro de nuevo paciente

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { authAPI, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { PhoneVerification } from '@/components/ui/PhoneVerification'
import { SpanishBirthDatePicker } from '@/components/ui/SpanishDateTimePicker'
import { PasswordInput } from '@/components/ui'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { ShieldAlert } from 'lucide-react'

const DEPARTMENTS = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí',
  'Tarija', 'Beni', 'Pando', 'Chuquisaca'
]

export default function RegisterPatientPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

  const [form, setForm] = useState({
    phone: '', email: '', password: '', confirm_password: '',
    first_name: '', last_name: '', ci: '',
    birth_date: '', department: '', gender: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)

  // Si un admin desactivó el kill switch de verificación (panel IA →
  // Verificación de registro, típicamente porque el bot de WhatsApp no
  // está disponible), este paso deja de ser obligatorio: se oculta el
  // bloque de PhoneVerification y no se exige phoneVerified para enviar
  // el formulario. Por defecto (mientras carga o si la consulta falla)
  // se asume obligatoria, que es el comportamiento seguro actual.
  const [verificationRequired, setVerificationRequired] = useState(true)
  const [configLoaded, setConfigLoaded] = useState(false)

  // Si un admin cerró el registro de pacientes (panel → Configuración →
  // General → "Registro de pacientes"), no tiene sentido dejar que la
  // persona llene el formulario para que recién al final se le rechace:
  // se bloquea el acceso acá mismo y se le pide que contacte a un
  // administrador.
  // null = "todavía no sabemos" (mientras viaja la consulta). Es a
  // propósito distinto de true/false: si arrancara en true, el formulario
  // se pintaría de entrada y recién cambiaría al aviso cuando llegue la
  // respuesta — un parpadeo confuso (se ve el form medio segundo y de
  // golpe se reemplaza por "deshabilitado"). Con null, mientras se carga
  // no se muestra ni el form ni el aviso, se muestra un loader — así solo
  // se pinta una vez, ya con la respuesta real. Si la consulta falla, se
  // asume abierto (el backend igual lo rechaza si de verdad está cerrado,
  // register_patient valida is_patient_registration_open) para no dejar
  // a alguien bloqueado por un error de red.
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    authAPI.getRegistrationConfig()
      .then((res) => {
        if (!active) return
        setVerificationRequired(res.data.phone_verification_required)
        setRegistrationOpen(res.data.patient_registration_open)
      })
      .catch(() => { if (active) setRegistrationOpen(true) /* falla la consulta: se asume abierto */ })
      .finally(() => { if (active) setConfigLoaded(true) })
    return () => { active = false }
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const missing: string[] = []
    if (!form.first_name.trim()) missing.push(t('Nombre'))
    if (!form.last_name.trim()) missing.push(t('Apellido'))
    if (!form.ci.trim()) missing.push(t('Cédula de identidad'))
    if (!form.birth_date) missing.push(t('Fecha de nacimiento'))
    if (!form.department) missing.push(t('Departamento'))
    if (!form.phone.trim()) missing.push(t('Número de celular'))
    if (!form.password) missing.push(t('Contraseña'))
    if (!form.confirm_password) missing.push(t('Confirmar contraseña'))
    if (missing.length > 0) {
      setError(`${t('Faltan estos campos obligatorios')}: ${missing.join(', ')}`)
      return
    }

    if (form.password !== form.confirm_password) {
      setError(t('Las contraseñas no coinciden'))
      return
    }

    if (verificationRequired && !phoneVerified) {
      setError(t('Verificá tu número de celular por WhatsApp antes de continuar'))
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.registerPatient({
        phone: form.phone,
        email: form.email || undefined,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        ci: form.ci,
        birth_date: form.birth_date,
        department: form.department,
        gender: form.gender || undefined,
      })

      const { user } = res.data
      setAuthenticated(user)

      // Si no completó el onboarding, ir al agente de bienvenida
      router.push(user.onboarding_completed ? '/patient/dashboard' : '/patient/onboarding')
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
          <p className="text-sm text-[#475569] mt-1">{t('Registro de paciente')}</p>
        </div>

        <div className="card">
          {!configLoaded || registrationOpen === null ? (
            // Todavía no sabemos si el registro está abierto: no se pinta
            // ni el formulario ni el aviso, para no arrancar mostrando
            // algo que puede tener que cambiarse un instante después.
            <div className="py-10 flex items-center justify-center" aria-busy="true" aria-label={t('Cargando')}>
              <div className="w-6 h-6 border-2 border-[#DDE1EE] border-t-[#185FA5] rounded-full animate-spin" />
            </div>
          ) : !registrationOpen ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#FCEBEB] flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-6 h-6 text-[#A32D2D]" aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold mb-2">{t('Registro de pacientes deshabilitado')}</h2>
              <p className="text-sm text-[#475569]">
                {t('Por el momento no se están aceptando nuevos registros de pacientes. Por favor contactate con un administrador.')}
              </p>
              <Link href="/auth/login" className="btn-primary w-full text-center mt-6 inline-block">
                {t('Ir a iniciar sesión')}
              </Link>
            </div>
          ) : (
          <>
          <h2 className="text-base font-semibold mb-5">{t('Crea tu cuenta de paciente')}</h2>

          {error && (
            <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-4 border border-[#F09595]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('Nombre')} <span className="text-[#E24B4A]">*</span></label>
                <input name="first_name" className="input" placeholder="Juan" value={form.first_name} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">{t('Apellido')} <span className="text-[#E24B4A]">*</span></label>
                <input name="last_name" className="input" placeholder="Pérez" value={form.last_name} onChange={handleChange} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('Cédula de identidad')} <span className="text-[#E24B4A]">*</span></label>
                <input name="ci" className="input" placeholder="5823741" value={form.ci} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">{t('Fecha de nacimiento')} <span className="text-[#E24B4A]">*</span></label>
                <SpanishBirthDatePicker name="birth_date" value={form.birth_date} onChange={(v) => setForm((f) => ({ ...f, birth_date: v }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('Departamento')} <span className="text-[#E24B4A]">*</span></label>
                <select name="department" className="input" value={form.department} onChange={handleChange} required>
                  <option value="">{t('Seleccionar...')}</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('Género (opcional)')}</label>
                <select name="gender" className="input" value={form.gender} onChange={handleChange}>
                  <option value="">{t('No especificar')}</option>
                  <option value="Masculino">{t('Masculino')}</option>
                  <option value="Femenino">{t('Femenino')}</option>
                  <option value="Otro">{t('Otro')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">{t('Número de celular')} <span className="text-[#E24B4A]">*</span></label>
              <PhoneInput
                value={form.phone}
                onChange={(phone) => { setForm((prev) => ({ ...prev, phone })); setPhoneVerified(false) }}
                required
              />
              {verificationRequired && (
                <div className="mt-2">
                  <PhoneVerification
                    phone={form.phone}
                    verified={phoneVerified}
                    onVerified={() => setPhoneVerified(true)}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="label">{t('Email (opcional)')}</label>
              <input name="email" type="email" className="input" placeholder="juan@email.com" value={form.email} onChange={handleChange} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('Contraseña')} <span className="text-[#E24B4A]">*</span></label>
                <PasswordInput name="password" autoComplete="new-password" className="input" placeholder={t('Mínimo 4 caracteres')} value={form.password} onChange={handleChange} required minLength={4} />
              </div>
              <div>
                <label className="label">{t('Confirmar contraseña')} <span className="text-[#E24B4A]">*</span></label>
                <PasswordInput name="confirm_password" autoComplete="new-password" className="input" placeholder={t('Repetir contraseña')} value={form.confirm_password} onChange={handleChange} required />
              </div>
            </div>

            <p className="text-xs text-[#64748B]">
              <span className="text-[#E24B4A]">*</span> {t('Campos obligatorios')}
            </p>

            <button
              type="submit"
              disabled={loading || !configLoaded || (verificationRequired && !phoneVerified)}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
              {loading ? t('Registrando...') : t('Crear cuenta')}
            </button>
          </form>

          <p className="text-center text-sm text-[#475569] mt-4 pt-4 border-t border-[#DDE1EE]">
            {t('¿Ya tienes cuenta?')}{' '}
            <Link href="/auth/login" className="text-[#185FA5] font-medium hover:underline">
              {t('Inicia sesión')}
            </Link>
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  )
}