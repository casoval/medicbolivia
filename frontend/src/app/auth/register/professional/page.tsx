'use client'
// src/app/auth/register/professional/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authAPI, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

const SPECIALTIES = [
  'Medicina General', 'Cardiología', 'Psicología', 'Pediatría',
  'Nutrición', 'Ginecología', 'Traumatología', 'Dermatología',
  'Neurología', 'Oftalmología', 'Odontología', 'Otra especialidad',
]

const DEPARTMENTS = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí',
  'Tarija', 'Beni', 'Pando', 'Chuquisaca'
]

export default function RegisterProfessionalPage() {
  const router = useRouter()
  const setUser  = useAuthStore((s) => s.setUser)
  const setToken = useAuthStore((s) => s.setToken)

  const [form, setForm] = useState({
    phone: '', email: '', password: '', confirm_password: '',
    first_name: '', last_name: '', ci: '',
    birth_date: '', department: '', gender: '',
    specialty: '', languages: 'Español',
  })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm_password) { setError('Las contraseñas no coinciden'); return }
    if (!form.specialty) { setError('Selecciona tu especialidad'); return }
    if (!form.department) { setError('Selecciona tu departamento'); return }
    if (!form.birth_date) { setError('Ingresa tu fecha de nacimiento'); return }

    setLoading(true)
    try {
      const res = await authAPI.registerProfessional({
        phone: form.phone,
        email: form.email,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        ci: form.ci,
        birth_date: form.birth_date,
        department: form.department,
        gender: form.gender || undefined,
        specialty: form.specialty,
        languages: form.languages.split(',').map((l) => l.trim()),
      })
      const { access_token, user } = res.data
      localStorage.setItem('mb_token', access_token)
      setToken(access_token)
      setUser(user)
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
          <Link href="/" className="text-xl font-bold text-[#042C53]">
            Medic<span className="font-normal text-[#6B738A]">Bolivia</span>
          </Link>
          <p className="text-sm text-[#6B738A] mt-1">Registro de profesional de salud</p>
        </div>

        <div className="bg-white border border-[#DDE1EE] rounded-2xl p-6 shadow-sm">

          <div className="bg-[#E6F1FB] border border-[#85B7EB] rounded-xl px-4 py-3 mb-5">
            <p className="text-xs text-[#0C447C] font-medium mb-1">📋 Tu perfil será verificado</p>
            <p className="text-xs text-[#185FA5]">
              Deberás subir tus documentos profesionales. La verificación toma entre 24 y 72 horas hábiles.
            </p>
          </div>

          <h2 className="text-base font-semibold mb-4">Crea tu cuenta profesional</h2>

          {error && (
            <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2.5 rounded-lg mb-4 border border-[#F09595]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">

            {/* Nombre y apellido */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Nombre</label>
                <input name="first_name" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="María" value={form.first_name} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Apellido</label>
                <input name="last_name" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Paz" value={form.last_name} onChange={handleChange} required />
              </div>
            </div>

            {/* CI y fecha de nacimiento */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Cédula de identidad</label>
                <input name="ci" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="5823741" value={form.ci} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Fecha de nacimiento</label>
                <input name="birth_date" type="date" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.birth_date} onChange={handleChange} required />
              </div>
            </div>

            {/* Departamento y género */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Departamento</label>
                <select name="department" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.department} onChange={handleChange} required>
                  <option value="">Seleccionar...</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Género (opcional)</label>
                <select name="gender" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.gender} onChange={handleChange}>
                  <option value="">No especificar</option>
                  <option value="Masculino">Masculino</option>
                  <option value="Femenino">Femenino</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
            </div>

            {/* Especialidad */}
            <div>
              <label className="block text-xs font-medium text-[#6B738A] mb-1">Especialidad</label>
              <select name="specialty" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.specialty} onChange={handleChange} required>
                <option value="">Seleccionar especialidad...</option>
                {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Idiomas */}
            <div>
              <label className="block text-xs font-medium text-[#6B738A] mb-1">Idiomas de atención</label>
              <input name="languages" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Español, Aymara, Quechua" value={form.languages} onChange={handleChange} />
              <p className="text-xs text-[#A0A8BF] mt-0.5">Separa con comas</p>
            </div>

            {/* Teléfono y email */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Celular</label>
                <input name="phone" type="tel" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="72345678" value={form.phone} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Email profesional</label>
                <input name="email" type="email" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="dr@email.com" value={form.email} onChange={handleChange} required />
              </div>
            </div>

            {/* Contraseñas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Contraseña</label>
                <input name="password" type="password" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Mínimo 8 caracteres" value={form.password} onChange={handleChange} required minLength={8} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Confirmar</label>
                <input name="confirm_password" type="password" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Repetir" value={form.confirm_password} onChange={handleChange} required />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-[#0F6E56] text-white py-2.5 rounded-lg font-medium text-sm hover:bg-[#085041] transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
              {loading ? 'Registrando...' : 'Crear cuenta profesional'}
            </button>
          </form>

          <p className="text-center text-sm text-[#6B738A] mt-4 pt-4 border-t border-[#DDE1EE]">
            ¿Ya tienes cuenta?{' '}
            <Link href="/auth/login" className="text-[#185FA5] font-medium hover:underline">Inicia sesión</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
