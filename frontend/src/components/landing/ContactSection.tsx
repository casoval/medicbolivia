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
import { Send, User, Mail, MapPin, MessageSquare, CheckCircle2, Bot } from 'lucide-react'

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
}

// Tres puntitos animados, el mismo lenguaje visual que el "escribiendo..."
// de WhatsApp — se muestran mientras la persona está tipeando el mensaje.
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6E56]/60 animate-bounce-dot [animation-delay:-0.2s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6E56]/60 animate-bounce-dot [animation-delay:-0.1s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-[#0F6E56]/60 animate-bounce-dot" />
    </span>
  )
}

// Mockup decorativo tipo chat de WhatsApp: mientras la persona escribe su
// mensaje en el formulario de al lado, esta "burbuja" cobra vida con los
// puntitos de "escribiendo..." — igual que el equipo lo vería llegar.
function LiveChatMockup({ isTyping, preview }: { isTyping: boolean; preview: string }) {
  return (
    <div className="bg-[#E7F8EF] border border-[#DDE1EE] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-full bg-[#25D366] flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-white" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-medium text-[#141820]">Equipo MedicBolivia</p>
          <p className="text-[10px] text-[#6B738A]">
            {isTyping ? 'en línea' : 'responde a la brevedad'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl rounded-tl-none px-3 py-2.5 text-xs text-[#141820] mb-2 max-w-[90%]">
        Hola 👋 contanos en qué te podemos ayudar y te respondemos por correo o WhatsApp.
      </div>

      {/* Vista previa en vivo de lo que la persona está escribiendo */}
      <div
        className={`ml-auto max-w-[85%] rounded-xl rounded-tr-none px-3 py-2.5 text-xs text-[#141820] text-right transition-colors duration-300 ${
          preview ? 'bg-[#DCF8C6]' : 'bg-white/60 border border-dashed border-[#C7E9DA]'
        }`}
      >
        {preview ? (
          <span className="whitespace-pre-wrap break-words">{preview}</span>
        ) : (
          <span className="text-[#6B738A]">Tu mensaje va a aparecer acá…</span>
        )}
      </div>

      {isTyping && (
        <div className="flex items-center gap-1.5 mt-2 ml-auto w-fit bg-white rounded-full px-2.5 py-1 animate-fade-up">
          <TypingDots />
          <span className="text-[10px] text-[#6B738A]">escribiendo…</span>
        </div>
      )}
    </div>
  )
}

export function ContactSection() {
  const [form, setForm] = useState(INITIAL_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current)
    }
  }, [])

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
      setError('Completá los campos obligatorios antes de enviar.')
      return
    }
    if (form.isOtherCountry && !form.otherCountry.trim()) {
      setError('Escribí el país desde el que nos contactás.')
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
    <section id="contacto" className="max-w-5xl mx-auto px-4 py-16">
      <Reveal className="text-center mb-10">
        <h2 className="text-2xl font-bold text-[#141820] mb-2">Contáctanos</h2>
        <div className="w-10 h-1 rounded-full bg-gradient-to-r from-[#185FA5] to-[#11A15A] mx-auto mb-3" />
        <p className="text-sm text-[#6B738A] max-w-md mx-auto">
          ¿Tenés dudas, sos profesional de salud, o necesitás soporte? Escribinos y te
          respondemos a{' '}
          <a href="mailto:info@medicbolivia.com" className="text-[#0F6E56] font-medium hover:underline">
            info@medicbolivia.com
          </a>.
        </p>
      </Reveal>

      <div className="grid sm:grid-cols-2 gap-8 items-start">
        <Reveal className="order-2 sm:order-1 sm:sticky sm:top-24">
          <LiveChatMockup isTyping={isTyping} preview={form.message} />
        </Reveal>

        <Reveal delayMs={100} className="order-1 sm:order-2">
          {success ? (
            <div className="bg-white border border-[#9FE1CB] rounded-xl p-6 text-center animate-fade-up">
              <div className="w-12 h-12 rounded-full bg-[#E1F5EE] flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6 text-[#0F6E56]" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-[#141820] mb-1">¡Consulta enviada!</p>
              <p className="text-xs text-[#6B738A] mb-4">
                Gracias por escribirnos. Te vamos a responder a la brevedad.
              </p>
              <button
                type="button"
                onClick={() => setSuccess(false)}
                className="text-xs font-medium text-[#0F6E56] hover:underline"
              >
                Enviar otra consulta
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white border border-[#DDE1EE] rounded-xl p-5 space-y-4">
              <div>
                <label className="label flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" aria-hidden="true" /> Nombre completo
                </label>
                <input
                  className="input"
                  name="full_name"
                  value={form.full_name}
                  onChange={handleChange}
                  placeholder="Ej: María Fernández"
                  required
                />
              </div>

              <div>
                <label className="label flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Ciudad
                </label>
                <select
                  className="input"
                  value={form.isOtherCountry ? OTHER_COUNTRY_VALUE : form.city}
                  onChange={handleCitySelect}
                  required
                >
                  {BOLIVIA_CITIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value={OTHER_COUNTRY_VALUE}>Estoy en otro país…</option>
                </select>
                {form.isOtherCountry && (
                  <input
                    className="input mt-2 animate-fade-up"
                    name="otherCountry"
                    value={form.otherCountry}
                    onChange={handleChange}
                    placeholder="¿Desde qué país nos escribís?"
                    required
                  />
                )}
              </div>

              <div>
                <label className="label">Teléfono</label>
                <PhoneInput value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} required />
              </div>

              <div>
                <label className="label flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" /> Correo <span className="text-[#A0A8BF]">(opcional)</span>
                </label>
                <input
                  className="input"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="tucorreo@ejemplo.com"
                />
              </div>

              <div>
                <label className="label">Tipo de consulta</label>
                <select
                  className="input"
                  name="inquiry_type"
                  value={form.inquiry_type}
                  onChange={handleChange}
                  required
                >
                  <option value="" disabled>Elegí una opción…</option>
                  {INQUIRY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> Mensaje
                </label>
                <textarea
                  className="input resize-none"
                  rows={4}
                  value={form.message}
                  onChange={handleMessageChange}
                  placeholder="Contanos en qué te podemos ayudar…"
                  required
                />
              </div>

              {error && <p className="text-xs text-[#A32D2D] bg-[#FCEBEB] border border-[#F09595] rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#11A15A] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#0F6E56] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" aria-hidden="true" />
                    Enviar consulta
                  </>
                )}
              </button>
            </form>
          )}
        </Reveal>
      </div>
    </section>
  )
}
