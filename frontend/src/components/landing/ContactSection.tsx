'use client'
// src/components/landing/ContactSection.tsx
// Sección "Contáctanos" de la landing pública. Cualquier visitante puede
// escribir sin necesidad de crear cuenta — el backend guarda la consulta
// y avisa por correo a info@medicbolivia.com (ver backend/app/api/v1/
// endpoints/contact.py).

import { useEffect, useRef, useState } from 'react'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { Reveal } from '@/components/ui/Reveal'
import { contactAPI, getErrorMessage, type ContactInquiryType } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { Send, User, Mail, MapPin, MessageSquare, CheckCircle2 } from 'lucide-react'

// Ciudades capitales de los 9 departamentos de Bolivia. El valor especial
// OTHER_COUNTRY_VALUE dispara el campo libre de "país" en vez de la lista.
const BOLIVIA_CITIES = [
  'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro', 'Potosí',
  'Tarija', 'Beni (Trinidad)', 'Pando (Cobija)', 'Chuquisaca (Sucre)',
]
const OTHER_COUNTRY_VALUE = '__OTHER_COUNTRY__'

const INQUIRY_TYPES: { value: ContactInquiryType; label: string }[] = [
  { value: 'PACIENTE', label: 'Consulta como paciente' },
  { value: 'PROFESIONAL', label: 'Quiero unirme como profesional de salud' },
  { value: 'SOPORTE', label: 'Soporte técnico' },
  { value: 'FACTURACION', label: 'Facturación / pagos' },
  { value: 'OTRO', label: 'Otro' },
]

const INITIAL_FORM = {
  full_name: '',
  city: BOLIVIA_CITIES[0],
  isOtherCountry: false,
  otherCountry: '',
  phone: '',
  email: '',
  inquiry_type: '' as ContactInquiryType | '',
  message: '',
  // Honeypot: campo trampa oculto, ver más abajo en el <input name="website">.
  website: '',
}

// Tres puntitos animados, el mismo lenguaje visual que el "escribiendo..."
// de WhatsApp — aparecen pegados al label de "Mensaje" mientras la persona
// tipea, como una pequeña confirmación de que el formulario está "vivo".
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6E56]/60 animate-bounce-dot [animation-delay:-0.2s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6E56]/60 animate-bounce-dot [animation-delay:-0.1s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6E56]/60 animate-bounce-dot" />
    </span>
  )
}

// Clase común para los inputs: agrega una sombra sutil y un leve "levante"
// al enfocarlos, para que el formulario se sienta más vivo sin exagerar.
const FIELD_TRANSITION =
  'transition-shadow duration-200 focus:shadow-[0_0_0_4px_rgba(17,161,90,0.12)]'

export function ContactSection() {
  const [form, setForm] = useState(INITIAL_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { t } = useLanguage()

  useEffect(() => {
    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current)
    }
  }, [])

  // Progreso del formulario: cuántos de los 5 campos obligatorios ya están
  // completos. Alimenta la barra animada de arriba del formulario.
  const requiredDone = [
    form.full_name.trim().length > 0,
    form.isOtherCountry ? form.otherCountry.trim().length > 0 : form.city.trim().length > 0,
    form.phone.length > 0,
    form.inquiry_type.length > 0,
    form.message.trim().length > 0,
  ].filter(Boolean).length
  const progressPct = Math.round((requiredDone / 5) * 100)

  function handleMessageChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setForm((prev) => ({ ...prev, message: e.target.value }))
    setIsTyping(true)
    if (typingTimeout.current) clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => setIsTyping(false), 900)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleCitySelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setForm((prev) => ({
      ...prev,
      isOtherCountry: value === OTHER_COUNTRY_VALUE,
      city: value === OTHER_COUNTRY_VALUE ? '' : value,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.full_name.trim() || !form.phone || !form.inquiry_type || !form.message.trim()) {
      setError(t('Completá los campos obligatorios antes de enviar.'))
      return
    }
    if (form.isOtherCountry && !form.otherCountry.trim()) {
      setError(t('Escribí el país desde el que nos contactás.'))
      return
    }

    setLoading(true)
    try {
      await contactAPI.send({
        full_name: form.full_name.trim(),
        city: form.isOtherCountry ? null : form.city,
        country: form.isOtherCountry ? form.otherCountry.trim() : 'Bolivia',
        phone: form.phone,
        email: form.email.trim() || undefined,
        inquiry_type: form.inquiry_type,
        message: form.message.trim(),
        website: form.website,
      })
      setSuccess(true)
      setForm(INITIAL_FORM)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="contacto" className="max-w-2xl mx-auto px-4 py-16">
      <Reveal className="text-center mb-10">
        <h2 className="text-2xl font-bold text-[#141820] mb-2">{t('Contáctanos')}</h2>
        <div className="w-10 h-1 rounded-full bg-gradient-to-r from-[#185FA5] to-[#11A15A] mx-auto mb-3" />
        <p className="text-sm text-[#6B738A] max-w-md mx-auto">
          {t('¿Tenés dudas, sos profesional de salud, o necesitás soporte? Escribinos y te respondemos a')}{' '}
          <a href="mailto:info@medicbolivia.com" className="text-[#0F6E56] font-medium hover:underline">
            info@medicbolivia.com
          </a>.
        </p>
      </Reveal>

      <Reveal>
        {success ? (
          <div className="bg-white border border-[#9FE1CB] rounded-xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-[#E1F5EE] flex items-center justify-center mx-auto mb-3 opacity-0 animate-pop-in">
              <CheckCircle2 className="w-6 h-6 text-[#0F6E56]" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-[#141820] mb-1">{t('¡Consulta enviada!')}</p>
            <p className="text-xs text-[#6B738A] mb-4">
              {t('Gracias por escribirnos. Te vamos a responder a la brevedad.')}
            </p>
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className="text-xs font-medium text-[#0F6E56] hover:underline"
            >
              {t('Enviar otra consulta')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-[#DDE1EE] rounded-xl p-5 space-y-4">
            {/* Honeypot anti-spam: invisible y fuera del flujo de tabulación
                para una persona real, pero un bot que autorellena todos los
                inputs del formulario sí suele completarlo. Si llega con
                algo, el backend descarta la consulta en silencio. */}
            <div className="absolute left-[-9999px] w-px h-px overflow-hidden" aria-hidden="true">
              <label htmlFor="website">{t('No completar este campo')}</label>
              <input
                type="text"
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={form.website}
                onChange={handleChange}
              />
            </div>

            {/* Barra de progreso: se llena a medida que se completan los
                campos obligatorios, degradado azul -> verde de la marca. */}
            <div className="h-1.5 w-full bg-[#EEF1F8] rounded-full overflow-hidden -mt-1 mb-1">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#185FA5] to-[#11A15A] transition-[width] duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <Reveal delayMs={0}>
              <label className="label flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" aria-hidden="true" /> {t('Nombre completo')}
              </label>
              <input
                className={`input ${FIELD_TRANSITION}`}
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                placeholder="Ej: María Fernández"
                required
              />
            </Reveal>

            <Reveal delayMs={60}>
              <label className="label flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> {t('Ciudad')}
              </label>
              <select
                className={`input ${FIELD_TRANSITION}`}
                value={form.isOtherCountry ? OTHER_COUNTRY_VALUE : form.city}
                onChange={handleCitySelect}
                required
              >
                {BOLIVIA_CITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value={OTHER_COUNTRY_VALUE}>{t('Estoy en otro país…')}</option>
              </select>
              {form.isOtherCountry && (
                <input
                  className={`input mt-2 animate-fade-up ${FIELD_TRANSITION}`}
                  name="otherCountry"
                  value={form.otherCountry}
                  onChange={handleChange}
                  placeholder="¿Desde qué país nos escribís?"
                  required
                />
              )}
            </Reveal>

            <Reveal delayMs={120}>
              <label className="label">{t('Teléfono')}</label>
              <PhoneInput value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} required />
            </Reveal>

            <Reveal delayMs={180}>
              <label className="label flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" aria-hidden="true" /> {t('Correo')} <span className="text-[#A0A8BF]">({t('opcional')})</span>
              </label>
              <input
                className={`input ${FIELD_TRANSITION}`}
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="tucorreo@ejemplo.com"
              />
            </Reveal>

            <Reveal delayMs={240}>
              <label className="label">{t('Tipo de consulta')}</label>
              <select
                className={`input ${FIELD_TRANSITION}`}
                name="inquiry_type"
                value={form.inquiry_type}
                onChange={handleChange}
                required
              >
                <option value="" disabled>{t('Elegí una opción…')}</option>
                {INQUIRY_TYPES.map((it) => (
                  <option key={it.value} value={it.value}>{t(it.label)}</option>
                ))}
              </select>
            </Reveal>

            <Reveal delayMs={300}>
              <div className="flex items-center gap-2 mb-0">
                <label className="label flex items-center gap-1.5 mb-0">
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> {t('Mensaje')}
                </label>
                {isTyping && (
                  <span className="flex items-center gap-1 animate-fade-up">
                    <TypingDots />
                    <span className="text-[10px] text-[#6B738A]">{t('escribiendo…')}</span>
                  </span>
                )}
              </div>
              <textarea
                className={`input resize-none ${FIELD_TRANSITION}`}
                rows={4}
                value={form.message}
                onChange={handleMessageChange}
                placeholder={t('Contanos en qué te podemos ayudar…')}
                required
              />
            </Reveal>

            {error && <p className="text-xs text-[#A32D2D] bg-[#FCEBEB] border border-[#F09595] rounded-lg px-3 py-2 animate-fade-up">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="group w-full bg-[#11A15A] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#0F6E56] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />
                  {t('Enviando…')}
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                  {t('Enviar consulta')}
                </>
              )}
            </button>
          </form>
        )}
      </Reveal>
    </section>
  )
}