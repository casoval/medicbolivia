'use client'
// src/app/auth/register/patient/page.tsx
// Registro de nuevo paciente

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authAPI, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

const DEPARTMENTS = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí',
  'Tarija', 'Beni', 'Pando', 'Chuquisaca'
]

export default function RegisterPatientPage() {
  const router = useRouter()
  const setUser = useAuthStore((s) => s.setUser)
  const setToken = useAuthStore((s) => s.setToken)

  const [form, setForm] = useState({
    phone: '', email: '', password: '', confirm_password: '',
    first_name: '', last_name: '', ci: '',
    birth_date: '', department: '', gender: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (form.password !== form.confirm_password) {
      setError('Las contraseñas no coinciden')
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

      const { access_token, user } = res.data
      localStorage.setItem('mb_token', access_token)
      setToken(access_token)
      setUser(user)

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
          <Link href="/" className="text-xl font-bold text-[#042C53]">
            Medic<span className="font-normal text-[#6B738A]">Bolivia</span>
          </Link>
          <p className="text-sm text-[#6B738A] mt-1">Registro de paciente</p>
        </div>

        <div className="card">
          <h2 className="text-base font-semibold mb-5">Crea tu cuenta de paciente</h2>

          {error && (
            <div className="bg-[#FCEBEB] text-[#A32D2D] text-sm px-3 py-2 rounded-lg mb-4 border border-[#F09595]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nombre <span className="text-[#E24B4A]">*</span></label>
                <input name="first_name" className="input" placeholder="Juan" value={form.first_name} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">Apellido <span className="text-[#E24B4A]">*</span></label>
                <input name="last_name" className="input" placeholder="Pérez" value={form.last_name} onChange={handleChange} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cédula de identidad <span className="text-[#E24B4A]">*</span></label>
                <input name="ci" className="input" placeholder="5823741" value={form.ci} onChange={handleChange} required />
              </div>
              <div>
                <label className="label">Fecha de nacimiento <span className="text-[#E24B4A]">*</span></label>
                <input name="birth_date" type="date" className="input" value={form.birth_date} onChange={handleChange} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Departamento <span className="text-[#E24B4A]">*</span></label>
                <select name="department" className="input" value={form.department} onChange={handleChange} required>
                  <option value="">Seleccionar...</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Género (opcional)</label>
                <select name="gender" className="input" value={form.gender} onChange={handleChange}>
                  <option value="">No especificar</option>
                  <option value="Masculino">Masculino</option>
                  <option value="Femenino">Femenino</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Número de celular <span className="text-[#E24B4A]">*</span></label>
              <input name="phone" type="tel" className="input" placeholder="72345678" value={form.phone} onChange={handleChange} required />
            </div>

            <div>
              <label className="label">Email (opcional)</label>
              <input name="email" type="email" className="input" placeholder="juan@email.com" value={form.email} onChange={handleChange} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Contraseña <span className="text-[#E24B4A]">*</span></label>
                <input name="password" type="password" className="input" placeholder="Mínimo 8 caracteres" value={form.password} onChange={handleChange} required minLength={8} />
              </div>
              <div>
                <label className="label">Confirmar contraseña <span className="text-[#E24B4A]">*</span></label>
                <input name="confirm_password" type="password" className="input" placeholder="Repetir contraseña" value={form.confirm_password} onChange={handleChange} required />
              </div>
            </div>

            <p className="text-xs text-[#A0A8BF]">
              <span className="text-[#E24B4A]">*</span> Campos obligatorios
            </p>

            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />}
              {loading ? 'Registrando...' : 'Crear cuenta'}
            </button>
          </form>

          <p className="text-center text-sm text-[#6B738A] mt-4 pt-4 border-t border-[#DDE1EE]">
            ¿Ya tienes cuenta?{' '}
            <Link href="/auth/login" className="text-[#185FA5] font-medium hover:underline">
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}