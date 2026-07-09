'use client'
// src/app/auth/register/professional/page.tsx
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authAPI, specialtiesAPI, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { PhoneVerification } from '@/components/ui/PhoneVerification'

const NOT_LISTED = '__NOT_LISTED__'

const DEPARTMENTS = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí',
  'Tarija', 'Beni', 'Pando', 'Chuquisaca'
]

const LANGUAGES = [
  'Español', 'Aymara', 'Quechua', 'Guaraní', 'Inglés', 'Portugués', 'Francés',
]

interface CatalogItem {
  id: string
  name: string
}

export default function RegisterProfessionalPage() {
  const router = useRouter()
  const setUser  = useAuthStore((s) => s.setUser)
  const setToken = useAuthStore((s) => s.setToken)

  const [form, setForm] = useState({
    phone: '', email: '', password: '', confirm_password: '',
    first_name: '', last_name: '', ci: '',
    birth_date: '', department: '', gender: '',
    specialty: '',
  })

  // Idiomas: chips multi-select + opción de agregar uno que no esté listado
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['Español'])
  const [languageNotListed, setLanguageNotListed] = useState(false)
  const [customLanguage, setCustomLanguage] = useState('')

  // Catálogo cargado del backend
  const [specialties, setSpecialties] = useState<CatalogItem[]>([])
  const [subSpecialties, setSubSpecialties] = useState<CatalogItem[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)

  // Propuesta de especialidad nueva (cuando no está en la lista)
  const [specialtyNotListed, setSpecialtyNotListed] = useState(false)
  const [specialtyProposal, setSpecialtyProposal] = useState('')

  // Subespecialidad: selección única (lista) del catálogo dependiente
  const [selectedSubSpecialty, setSelectedSubSpecialty] = useState('')
  const [subSpecialtyNotListed, setSubSpecialtyNotListed] = useState(false)
  const [subSpecialtyProposal, setSubSpecialtyProposal] = useState('')

  const [error, setError]   = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [loading, setLoading] = useState(false)

  // Carga el catálogo de especialidades al montar
  useEffect(() => {
    specialtiesAPI.list()
      .then(setSpecialties)
      .catch(() => setError('No se pudo cargar el catálogo de especialidades. Recarga la página.'))
      .finally(() => setLoadingCatalog(false))
  }, [])

  // Carga subespecialidades cada vez que cambia la especialidad elegida
  // (solo si es una especialidad real del catálogo, no una propuesta nueva)
  useEffect(() => {
    setSelectedSubSpecialty('')
    setSubSpecialtyNotListed(false)
    setSubSpecialtyProposal('')
    setSubSpecialties([])

    if (form.specialty && form.specialty !== NOT_LISTED) {
      specialtiesAPI.listSubSpecialties(form.specialty)
        .then(setSubSpecialties)
        .catch(() => setSubSpecialties([]))
    }
  }, [form.specialty])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleSpecialtyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setSpecialtyNotListed(value === NOT_LISTED)
    setForm((prev) => ({ ...prev, specialty: value }))
  }

  function handleSubSpecialtyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setSubSpecialtyNotListed(value === NOT_LISTED)
    setSelectedSubSpecialty(value === NOT_LISTED ? '' : value)
  }

  function toggleLanguage(name: string) {
    setSelectedLanguages((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name]
    )
  }

  const hasNewProposal = specialtyNotListed || subSpecialtyNotListed

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!phoneVerified) { setError('Verificá tu número de celular por WhatsApp antes de continuar'); return }
    if (form.password !== form.confirm_password) { setError('Las contraseñas no coinciden'); return }
    if (!form.department) { setError('Selecciona tu departamento'); return }
    if (!form.birth_date) { setError('Ingresa tu fecha de nacimiento'); return }

    if (!form.specialty) { setError('Selecciona tu especialidad'); return }
    if (specialtyNotListed && !specialtyProposal.trim()) {
      setError('Escribe el nombre de tu especialidad'); return
    }
    if (subSpecialtyNotListed && !subSpecialtyProposal.trim()) {
      setError('Escribe el nombre de tu subespecialidad'); return
    }
    if (selectedLanguages.length === 0 && !customLanguage.trim()) {
      setError('Selecciona al menos un idioma de atención'); return
    }

    // Si la especialidad es nueva, se manda el texto propuesto como
    // specialty del registro — el backend la deja en revisión apenas
    // se crea la propuesta más abajo. El catálogo guarda el id real,
    // así que acá distinguimos cuál de los dos mandar.
    const specialtyToRegister = specialtyNotListed
      ? specialtyProposal.trim()
      : specialties.find((s) => s.id === form.specialty)?.name || form.specialty

    // Subespecialidad ya aprobada (nombre, tal como espera el backend
    // de registro). La propuesta nueva, si hay, se manda aparte después.
    const subSpecialtyNames = selectedSubSpecialty ? [selectedSubSpecialty] : []

    const finalLanguages = customLanguage.trim()
      ? [...selectedLanguages, customLanguage.trim()]
      : selectedLanguages

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
        specialty: specialtyToRegister,
        sub_specialties: subSpecialtyNames,
        languages: finalLanguages,
      })
      const { access_token, user } = res.data
      localStorage.setItem('mb_token', access_token)
      setToken(access_token)
      setUser(user)

      // A partir de acá ya hay token guardado, así que se pueden crear
      // las propuestas (requieren estar autenticado como profesional).
      let specialtyProposalId: string | undefined

      if (specialtyNotListed) {
        const result = await specialtiesAPI.createProposal({
          type: 'SPECIALTY',
          proposed_name: specialtyProposal.trim(),
        })
        specialtyProposalId = result?.proposal?.id
      }

      if (subSpecialtyNotListed) {
        await specialtiesAPI.createProposal({
          type: 'SUB_SPECIALTY',
          proposed_name: subSpecialtyProposal.trim(),
          // Si la especialidad también es nueva, la subespecialidad
          // depende de esa otra propuesta en vez de un id del catálogo.
          ...(specialtyNotListed
            ? { parent_proposal_id: specialtyProposalId }
            : { parent_specialty_id: form.specialty }),
        })
      }

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
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Nombre <span className="text-[#E24B4A]">*</span></label>
                <input name="first_name" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="María" value={form.first_name} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Apellido <span className="text-[#E24B4A]">*</span></label>
                <input name="last_name" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Paz" value={form.last_name} onChange={handleChange} required />
              </div>
            </div>

            {/* CI y fecha de nacimiento */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Cédula de identidad <span className="text-[#E24B4A]">*</span></label>
                <input name="ci" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="5823741" value={form.ci} onChange={handleChange} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Fecha de nacimiento <span className="text-[#E24B4A]">*</span></label>
                <input name="birth_date" type="date" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" value={form.birth_date} onChange={handleChange} required />
              </div>
            </div>

            {/* Departamento y género */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Departamento <span className="text-[#E24B4A]">*</span></label>
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
              <label className="block text-xs font-medium text-[#6B738A] mb-1">Especialidad <span className="text-[#E24B4A]">*</span></label>
              <select
                name="specialty"
                className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
                value={form.specialty}
                onChange={handleSpecialtyChange}
                disabled={loadingCatalog}
                required
              >
                <option value="">{loadingCatalog ? 'Cargando especialidades...' : 'Seleccionar especialidad...'}</option>
                {specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NOT_LISTED}>→ No encuentro mi especialidad</option>
              </select>

              {specialtyNotListed && (
                <div className="mt-2">
                  <input
                    className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
                    placeholder="Escribe el nombre de tu especialidad"
                    value={specialtyProposal}
                    onChange={(e) => setSpecialtyProposal(e.target.value)}
                    required
                  />
                  <p className="text-xs text-[#A0A8BF] mt-1">
                    La revisaremos y te avisaremos cuando esté aprobada.
                  </p>
                </div>
              )}
            </div>

            {/* Subespecialidad — solo si ya hay una especialidad elegida */}
            {form.specialty && (
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">
                  Subespecialidad (opcional)
                </label>

                {subSpecialties.length > 0 && (
                  <select
                    className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white mb-2"
                    value={subSpecialtyNotListed ? NOT_LISTED : selectedSubSpecialty}
                    onChange={handleSubSpecialtyChange}
                  >
                    <option value="">Sin subespecialidad</option>
                    {subSpecialties.map((sub) => (
                      <option key={sub.id} value={sub.name}>{sub.name}</option>
                    ))}
                    {!specialtyNotListed && (
                      <option value={NOT_LISTED}>→ No encuentro mi subespecialidad</option>
                    )}
                  </select>
                )}

                {!specialtyNotListed && subSpecialties.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setSubSpecialtyNotListed((v) => !v)}
                    className="text-xs text-[#185FA5] hover:underline"
                  >
                    {subSpecialtyNotListed ? '✕ Cancelar propuesta' : '→ No encuentro mi subespecialidad'}
                  </button>
                )}

                {specialtyNotListed && (
                  <button
                    type="button"
                    onClick={() => setSubSpecialtyNotListed((v) => !v)}
                    className="text-xs text-[#185FA5] hover:underline"
                  >
                    {subSpecialtyNotListed ? '✕ Cancelar' : '→ Agregar una subespecialidad nueva'}
                  </button>
                )}

                {subSpecialtyNotListed && (
                  <div className="mt-2">
                    <input
                      className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
                      placeholder="Escribe el nombre de tu subespecialidad"
                      value={subSpecialtyProposal}
                      onChange={(e) => setSubSpecialtyProposal(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {hasNewProposal && (
              <div className="bg-[#FFF8E6] border border-[#F0D88A] rounded-xl px-3 py-2.5">
                <p className="text-xs text-[#7A5C0E]">
                  ⏳ Como propusiste {specialtyNotListed && subSpecialtyNotListed
                    ? 'una especialidad y una subespecialidad nuevas'
                    : specialtyNotListed ? 'una especialidad nueva' : 'una subespecialidad nueva'}
                  , tu cuenta quedará <strong>en revisión</strong> hasta que un administrador la apruebe.
                  Igual puedes completar tu registro y subir tus documentos mientras tanto.
                </p>
              </div>
            )}

            {/* Idiomas */}
            <div>
              <label className="block text-xs font-medium text-[#6B738A] mb-1">
                Idiomas de atención <span className="text-[#E24B4A]">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {LANGUAGES.map((lang) => {
                  const active = selectedLanguages.includes(lang)
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => toggleLanguage(lang)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                        active
                          ? 'bg-[#0F6E56] text-white border-[#0F6E56]'
                          : 'bg-white text-[#6B738A] border-[#DDE1EE] hover:border-[#0F6E56]'
                      }`}
                    >
                      {lang}
                    </button>
                  )
                })}
              </div>

              {!languageNotListed ? (
                <button
                  type="button"
                  onClick={() => setLanguageNotListed(true)}
                  className="text-xs text-[#185FA5] hover:underline"
                >
                  → Agregar otro idioma
                </button>
              ) : (
                <div>
                  <input
                    className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
                    placeholder="Ej. Italiano"
                    value={customLanguage}
                    onChange={(e) => setCustomLanguage(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => { setLanguageNotListed(false); setCustomLanguage('') }}
                    className="text-xs text-[#A0A8BF] hover:underline mt-1"
                  >
                    ✕ Cancelar
                  </button>
                </div>
              )}
            </div>

            {/* Teléfono */}
            <div>
              <label className="block text-xs font-medium text-[#6B738A] mb-1">Celular <span className="text-[#E24B4A]">*</span></label>
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
              <label className="block text-xs font-medium text-[#6B738A] mb-1">Email profesional (opcional)</label>
              <input name="email" type="email" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="dr@email.com" value={form.email} onChange={handleChange} />
            </div>

            {/* Contraseñas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Contraseña <span className="text-[#E24B4A]">*</span></label>
                <input name="password" type="password" autoComplete="new-password" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Mínimo 8 caracteres" value={form.password} onChange={handleChange} required minLength={8} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Confirmar <span className="text-[#E24B4A]">*</span></label>
                <input name="confirm_password" type="password" autoComplete="new-password" className="w-full px-3 py-2.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white" placeholder="Repetir" value={form.confirm_password} onChange={handleChange} required />
              </div>
            </div>

            <p className="text-xs text-[#A0A8BF]">
              <span className="text-[#E24B4A]">*</span> Campos obligatorios
            </p>

            <button type="submit" disabled={loading || !phoneVerified}
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