'use client'
// src/app/auth/register/professional/page.tsx
import { useState } from 'react'
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

// Especialidad, subespecialidad e idiomas de atención se sacaron de este
// formulario (ago-2026): antes se cargaban acá sin que nadie los
// confirmara, y de paso quedaban "guardados" desde el minuto uno aunque
// la propuesta de especialidad todavía no hubiera sido aprobada por un
// admin. Ahora los tres se completan después, ya con sesión iniciada,
// desde /professional/onboarding y /professional/profile — donde además
// especialidad y matrícula bloquean quedar visible para pacientes hasta
// que un admin las confirme (ver check_and_approve_professional en el
// backend). Esto también simplifica el registro: menos campos para
// decidir antes de siquiera tener cuenta.

const DEPARTMENTS = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí',
  'Tarija', 'Beni', 'Pando', 'Chuquisaca'
]

export default function RegisterProfessionalPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

  const [form, setForm] = useState({
    phone: '', email: '', password: '', confirm_password: '',
    first_name: '', last_name: '', ci: '',
    birth_date: '', department: '', gender: '',
  })

  const [error, setError]   = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [loading, setLoading] = useState(false)

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

    if (form.password !== form.confirm_password) { setError(t('Las contraseñas no coinciden')); return }
    if (!phoneVerified) { setError(t('Verificá tu número de celular por WhatsApp antes de continuar')); return }

    setLoading(true)
    try {
      const res = await authAPI.registerProfessional({
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

      // El onboarding es donde ahora se completa especialidad
      // (obligatoria), subespecialidad (opcional) e idiomas, junto con
      // los documentos — antes de esto el registro ya está terminado.
      router.push('/professional/onboarding')
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
          <p className="text-sm text-[#475569] mt-1">{t('Registro de profesional de salud')}</p>
        </div>

        <div className="bg-white border border-[#DDE1EE] rounded-2xl p-6 shadow-sm">

          <div className="bg-[#E6F1FB] border border-[#85B7EB] rounded-xl px-4 py-3 mb-5">
            <p className="text-xs text-[#0C447C] font-medium mb-1">📋 {t('Tu perfil será verificado')}</p>
            <p className="text-xs text-[#185FA5]">
              {t('Después de crear tu cuenta completarás tu especialidad y subirás tus documentos. La verificación toma entre 24 y 72 horas hábiles.')}
            </p>
          </div>

          <h2 className="text-base font-semibold mb-4">{t('Crea tu cuenta profesional')}</h2>

          {error && (
            <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2.5 rounded-lg mb-4 border border-[#F09595]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">

            {/* Nombre y apellido */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Nombre')} <span className="text-[#E24B4A]">*</span></label>
                <input name="first_name" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="María" value={form.first_name} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Apellido')} <span className="text-[#E24B4A]">*</span></label>
                <input name="last_name" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Paz" value={form.last_name} onChange={handleChange} required />
              </div>
            </div>

            {/* CI y fecha de nacimiento */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Cédula de identidad')} <span className="text-[#E24B4A]">*</span></label>
                <input name="ci" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="5823741" value={form.ci} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Fecha de nacimiento')} <span className="text-[#E24B4A]">*</span></label>
                <SpanishBirthDatePicker name="birth_date" value={form.birth_date} onChange={(v) => setForm((f) => ({ ...f, birth_date: v }))} />
              </div>
            </div>

            {/* Departamento y género */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Departamento')} <span className="text-[#E24B4A]">*</span></label>
                <select name="department" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.department} onChange={handleChange} required>
                  <option value="">{t('Seleccionar...')}</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Género (opcional)')}</label>
                <select name="gender" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.gender} onChange={handleChange}>
                  <option value="">{t('No especificar')}</option>
                  <option value="Masculino">{t('Masculino')}</option>
                  <option value="Femenino">{t('Femenino')}</option>
                  <option value="Otro">{t('Otro')}</option>
                </select>
              </div>
            </div>

            {/* Teléfono */}
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">{t('Celular')} <span className="text-[#E24B4A]">*</span></label>
              <PhoneInput
                value={form.phone}
                onChange={(phone) => { setForm((prev) => ({ ...prev, phone })); setPhoneVerified(false) }}
                required
              />
              <div className="mt-2">
                <PhoneVerification
                  phone={form.phone}
                  verified={phoneVerified}
                  onVerified={() => setPhoneVerified(true)}
                />
              </div>
            </div>

            {/* Email — opcional para profesionales, el celular ya es el
                canal principal de contacto (WhatsApp) */}
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">{t('Email profesional (opcional)')}</label>
              <input name="email" type="email" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="dr@email.com" value={form.email} onChange={handleChange} />
            </div>

            {/* Contraseñas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Contraseña')} <span className="text-[#E24B4A]">*</span></label>
                <PasswordInput name="password" autoComplete="new-password" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder={t('Mínimo 8 caracteres')} value={form.password} onChange={handleChange} required minLength={8} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">{t('Confirmar')} <span className="text-[#E24B4A]">*</span></label>
                <PasswordInput name="confirm_password" autoComplete="new-password" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder={t('Repetir')} value={form.confirm_password} onChange={handleChange} required />
              </div>
            </div>

            <p className="text-xs text-[#64748B]">
              <span className="text-[#E24B4A]">*</span> {t('Campos obligatorios')}
            </p>

            <button type="submit" disabled={loading || !phoneVerified}
              className="w-full bg-[#0F6E56] text-white py-2.5 rounded-lg font-medium text-sm hover:bg-[#085041] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
              {loading ? t('Registrando...') : t('Crear cuenta profesional')}
            </button>
          </form>

          <p className="text-center text-sm text-[#475569] mt-4 pt-4 border-t border-[#DDE1EE]">
            {t('¿Ya tienes cuenta?')}{' '}
            <Link href="/auth/login" className="text-[#185FA5] font-medium hover:underline">{t('Inicia sesión')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
