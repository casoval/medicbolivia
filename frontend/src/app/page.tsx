'use client'
// src/app/page.tsx
// Landing pública de MedicBolivia. Cualquier visitante puede entrar sin
// cuenta. Si ya hay sesión iniciada, redirige directo a su dashboard — igual
// que antes — pero ahora quien NO tiene sesión ve una página real en vez de
// un spinner de "Redirigiendo...".

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/store'
import { faqAPI } from '@/lib/api'
import type { FAQ, FAQAudience } from '@/types'
import { Spinner } from '@/components/ui'
import { Reveal } from '@/components/ui/Reveal'
import { ContactSection } from '@/components/landing/ContactSection'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { MessageCircleHeart, UserCheck, Video, FileCheck2, QrCode, ShieldCheck, BadgeCheck, CalendarCheck2, Clock, Bell, Stethoscope, Mic, Cpu, Mail, Gift, Handshake, Bot } from 'lucide-react'

const TABS: { key: FAQAudience; label: string }[] = [
  { key: 'GENERAL', label: 'General' },
  { key: 'PATIENT', label: 'Paciente' },
  { key: 'PROFESSIONAL', label: 'Profesional' },
]

// Barrita decorativa con degradado azul→verde, usada bajo algunos títulos
// de sección como motivo repetido que amarra los dos colores de la marca.
function SectionAccent() {
  return <div className="w-10 h-1 rounded-full bg-gradient-to-r from-[#185FA5] to-[#11A15A] mx-auto" />
}

function FAQItem({ faq }: { faq: FAQ }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[#DDE1EE] rounded-xl bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="text-sm font-medium text-[#141820]">{faq.question}</span>
        <span className={`text-[#6B738A] transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-[#6B738A] whitespace-pre-wrap">
          {faq.answer}
        </div>
      )}
    </div>
  )
}

function FAQSection() {
  const [tab, setTab] = useState<FAQAudience>('GENERAL')
  const { t } = useLanguage()

  const { data: faqs = [], isLoading } = useQuery({
    queryKey: ['public', 'faqs'],
    queryFn: async () => (await faqAPI.list()).data,
    staleTime: 1000 * 60 * 10,
  })

  const visible = faqs.filter((f) => f.audience === tab)

  return (
    <section id="faq" className="max-w-3xl mx-auto px-4 py-16">
      <h2 className="text-2xl font-bold text-center text-[#141820] mb-2">{t('Preguntas frecuentes')}</h2>
      <SectionAccent />
      <p className="text-sm text-center text-[#6B738A] mt-3 mb-8">
        {t('¿Quiénes somos, cómo funciona la plataforma y qué necesitás saber antes de empezar.')}
      </p>

      <div className="flex justify-center gap-2 mb-6">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors ${
              tab === tb.key
                ? 'bg-[#11A15A] text-white border-[#11A15A]'
                : 'bg-white text-[#6B738A] border-[#DDE1EE]'
            }`}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-[#6B738A] py-8">
          {t('Todavía no hay preguntas cargadas en esta sección.')}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((faq) => <FAQItem key={faq.id} faq={faq} />)}
        </div>
      )}
    </section>
  )
}

function VerifyPrescriptionSection() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const { t } = useLanguage()

  function goVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    router.push(`/verificar-receta?code=${encodeURIComponent(code.trim())}`)
  }

  return (
    <section className="bg-white border-t border-b border-[#DDE1EE]">
      <div className="max-w-3xl mx-auto px-4 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#E7F8EF] flex items-center justify-center mx-auto mb-4">
          <QrCode className="w-6 h-6 text-[#0F6E56]" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-bold text-[#141820] mb-2">{t('Verificar una receta médica')}</h2>
        <p className="text-sm text-[#6B738A] mb-6 max-w-md mx-auto">
          {t('¿Recibiste una receta digital de MedicBolivia? Escaneá el código QR con tu celular, o ingresá el código manualmente para confirmar que es auténtica.')}
        </p>
        <form onSubmit={goVerify} className="flex gap-2 max-w-sm mx-auto">
          <input
            className="flex-1 rounded-lg border border-[#DDE1EE] px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#11A15A]"
            placeholder="Ej: MB-RX-A1B2C3D4E5F6"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className="bg-[#11A15A] text-white text-sm font-medium px-4 py-2.5 rounded-lg whitespace-nowrap hover:bg-[#0F6E56] transition-colors">
            {t('Verificar')}
          </button>
        </form>
        <Link href="/verificar-receta" className="text-xs text-[#0F6E56] hover:underline mt-3 inline-block">
          {t('o abrir la página de verificación completa →')}
        </Link>
      </div>
    </section>
  )
}

function LandingHeader() {
  const { t } = useLanguage()
  return (
    <header className="border-b border-[#DDE1EE] bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 h-16 sm:h-20 flex items-center justify-between gap-1 sm:gap-2">
        {/* shrink-0: el logo no debe comprimirse aunque el resto de los
            elementos (idioma, login, registro) no entren cómodos en pantallas chicas */}
        <div className="flex items-center shrink-0">
          <Image src="/logo.png" alt="MedicBolivia" width={1779} height={339} className="h-6 sm:h-11 w-auto" priority />
        </div>
        <nav className="hidden sm:flex items-center gap-6 text-sm text-[#6B738A]">
          <Link href="/especialidades" className="hover:text-[#141820]">{t('Especialidades')}</Link>
          <Link href="/telemedicina" className="hover:text-[#141820]">{t('Telemedicina')}</Link>
          <a href="#faq" className="hover:text-[#141820]">{t('Preguntas frecuentes')}</a>
          <Link href="/verificar-receta" className="hover:text-[#141820]">{t('Verificar receta')}</Link>
          <a href="#contacto" className="hover:text-[#141820]">{t('Contacto')}</a>
        </nav>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <LanguageSwitcher variant="light" />
          <Link
            href="/auth/login"
            className="text-xs sm:text-sm font-medium text-[#0F6E56] px-1.5 sm:px-2 py-2 hover:underline sm:hover:no-underline sm:border sm:border-[#11A15A]/40 sm:px-3 sm:rounded-lg sm:hover:bg-[#E7F8EF] sm:transition-colors whitespace-nowrap"
          >
            {t('Iniciar sesión')}
          </Link>
          <Link href="/auth/register/patient" className="bg-[#11A15A] text-white text-xs sm:text-sm font-medium px-2.5 sm:px-4 py-2 rounded-lg hover:bg-[#0F6E56] transition-colors whitespace-nowrap">
            {t('Registrarme')}
          </Link>
        </div>
      </div>
    </header>
  )
}

type HeroSlide = {
  image: string
  imageAlt: string
  // object-position distinto por foto: en la de la familia el sujeto está
  // pegado al borde derecho, en la del lago las dos mujeres quedan más
  // centradas — así el recorte (si hace falta por el min-h) nunca les come
  // la cara ni tapa lo importante de la escena.
  focus: string
  badgeIcon: typeof MessageCircleHeart
  badgeText: string
  // Acento opcional del badge: por defecto es un blanco translúcido; en el
  // slide de la nueva función de voz usamos verde para que se note que es
  // una novedad (y de paso suma un poco de verde a un hero muy azul).
  accent?: 'green'
  title: string
  description: string
}

const HERO_SLIDES: HeroSlide[] = [
  {
    image: '/hero-consulta.jpg',
    imageAlt: 'Familia sonriendo en videoconsulta médica con MedicBolivia',
    focus: 'object-right',
    badgeIcon: MessageCircleHeart,
    badgeText: 'Orientación médica con IA, en segundos',
    title: 'Consultas médicas en línea, conectadas por Agentes IA',
    description:
      'Contale tus síntomas a Medi, nuestro agente de orientación, y te conecta con un profesional de salud verificado en Bolivia — con videoconsulta, receta digital y pago con QR.',
  },
  {
    image: '/hero-consulta1.jpg',
    imageAlt: 'Dos mujeres bolivianas contemplando el lago Titicaca',
    focus: 'object-center',
    badgeIcon: Mic,
    badgeText: 'Nuevo: consultá por voz',
    accent: 'green',
    title: 'Llamá a Medi y contale tu consulta hablando',
    description:
      'Sin escribir nada: llamá por voz a Medi, como una llamada normal, y contale qué te pasa desde donde estés en Bolivia — desde la orilla del lago Titicaca. Te escucha y te conecta al toque con el profesional indicado.',
  },
  {
    image: '/hero-consulta2.jpg',
    imageAlt: 'Hombre caminando por el centro de Sucre en videoconsulta médica con auriculares',
    focus: 'object-right',
    badgeIcon: Cpu,
    badgeText: 'Tecnología de punta',
    title: 'Video en tiempo real, con la misma calidad que un consultorio',
    description:
      'Nuestra plataforma corre sobre videollamada de baja latencia y cifrado de extremo a extremo, optimizada para funcionar bien incluso con datos móviles en la calle — sin cortes, sin esperas, sin importar desde dónde te conectés.',
  },
]

const HERO_INTERVAL_MS = 15000
// El zoom dura EXACTAMENTE lo mismo que el intervalo, así el movimiento no
// se detiene en ningún momento: sigue animando hasta el instante justo en
// que la foto cambia por la siguiente, dando sensación de animación continua.
const HERO_KEN_BURNS_MS = HERO_INTERVAL_MS

// Insignia "en vivo" con punto pulsante: se superpone sobre la foto del Hero
// para que, sin necesidad de scrollear, se entienda de inmediato que hay
// médicos conectados ahora mismo y que la consulta es instantánea.
function LiveDoctorsBadge({ className = '' }: { className?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`inline-flex items-center gap-2 bg-white/95 backdrop-blur-sm rounded-full pl-2.5 pr-4 py-2 shadow-lg ${className}`}>
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#11A15A] opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#11A15A]" />
      </span>
      <span className="text-xs font-semibold text-[#141820] whitespace-nowrap">
        {t('Médicos en línea ahora')} — <span className="text-[#0F6E56]">{t('consulta al instante')}</span>
      </span>
    </div>
  )
}

function HeroCopy({ slide }: { slide: HeroSlide }) {
  const Icon = slide.badgeIcon
  const { t } = useLanguage()
  return (
    <>
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full mb-4 backdrop-blur-sm ${
        slide.accent === 'green' ? 'bg-[#11A15A]/25 text-white' : 'bg-white/15 text-white'
      }`}>
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {t(slide.badgeText)}
      </span>
      <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
        {t(slide.title)}
      </h1>
      <p className="text-white/85 mt-4">
        {t(slide.description)}
      </p>
    </>
  )
}

function HeroDots({ active, onSelect }: { active: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center gap-2 mt-8 sm:mt-6">
      {HERO_SLIDES.map((_, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          aria-label={`Mostrar imagen ${i + 1}`}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === active ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'
          }`}
        />
      ))}
    </div>
  )
}

function Hero() {
  const [active, setActive] = useState(0)
  const { t } = useLanguage()

  useEffect(() => {
    const id = setInterval(() => {
      setActive((prev) => (prev + 1) % HERO_SLIDES.length)
    }, HERO_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const slide = HERO_SLIDES[active]

  return (
    <section className="relative overflow-hidden">
      {/* Animaciones de entrada del texto y del zoom lento (Ken Burns) de la
          foto activa. Se definen una sola vez acá para no tocar tailwind.config. */}
      <style>{`
        @keyframes heroTextIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes heroKenBurns {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
        }
      `}</style>

      {/* ---------- Mobile / tablet chico (< md): contenedor 4:3, recortando
          solo lo que sobra de cada foto según su "focus" — nunca a las
          personas. Las fotos hacen crossfade entre sí cada 3s. ---------- */}
      <div className="md:hidden">
        <div className="relative w-full aspect-[4/3] overflow-hidden">
          {HERO_SLIDES.map((s, i) => (
            <Image
              key={s.image}
              src={s.image}
              alt={s.imageAlt}
              fill
              priority={i === 0}
              sizes="100vw"
              className={`object-cover ${s.focus} transition-opacity duration-[2000ms] ease-in-out ${
                i === active ? 'opacity-100' : 'opacity-0'
              }`}
              style={i === active ? { animation: `heroKenBurns ${HERO_KEN_BURNS_MS}ms ease-out forwards` } : undefined}
            />
          ))}
          <LiveDoctorsBadge className="absolute top-3 left-3" />
        </div>
        <div className="bg-gradient-to-b from-[#0C447C] via-[#185FA5] to-[#0F6E56] px-4 py-10">
          <div className="max-w-lg mx-auto">
            <div key={active} style={{ animation: 'heroTextIn 0.6s ease-out' }}>
              <HeroCopy slide={slide} />
            </div>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link href="/auth/register/patient" className="bg-white text-[#0C447C] font-medium px-6 py-3 rounded-lg hover:bg-[#E6F1FB] transition-colors">
                {t('Soy paciente — quiero consultar')}
              </Link>
              <Link href="/auth/register/professional" className="bg-transparent text-white border border-[#3DDC84]/80 font-medium px-6 py-3 rounded-lg hover:bg-[#11A15A]/15 transition-colors">
                {t('Soy profesional de salud')}
              </Link>
            </div>
            <HeroDots active={active} onSelect={setActive} />
          </div>
        </div>
      </div>

      {/* ---------- Desktop / tablet grande (>= md): foto de fondo con
          crossfade + zoom lento entre las dos imágenes, texto superpuesto a
          la izquierda que se anima cada vez que cambia el slide. ---------- */}
      <div className="hidden md:block relative w-full aspect-[2/1] min-h-[420px] max-h-[680px] overflow-hidden">
        {HERO_SLIDES.map((s, i) => (
          <Image
            key={s.image}
            src={s.image}
            alt={s.imageAlt}
            fill
            priority={i === 0}
            sizes="100vw"
            className={`object-cover ${s.focus} transition-opacity duration-[2000ms] ease-in-out ${
              i === active ? 'opacity-100' : 'opacity-0'
            }`}
            style={i === active ? { animation: `heroKenBurns ${HERO_KEN_BURNS_MS}ms ease-out forwards` } : undefined}
          />
        ))}

        {/* Velo: opaco a la izquierda (para que el texto se lea), transparente
            hacia la derecha (para que se vea la foto). Un poco más marcado
            que antes para que también funcione bien sobre la foto del lago,
            más clara y luminosa que la de la familia. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#041424]/85 via-[#041424]/55 to-[#041424]/10" />

        <LiveDoctorsBadge className="absolute top-6 left-4 sm:left-6 z-10" />

        <div className="relative h-full max-w-5xl mx-auto px-4 flex items-center">
          <div className="max-w-lg">
            <div key={active} style={{ animation: 'heroTextIn 0.6s ease-out' }}>
              <HeroCopy slide={slide} />
            </div>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link href="/auth/register/patient" className="bg-white text-[#0C447C] font-medium px-6 py-3 rounded-lg hover:bg-[#E6F1FB] transition-colors">
                {t('Soy paciente — quiero consultar')}
              </Link>
              <Link href="/auth/register/professional" className="bg-transparent text-white border border-[#3DDC84]/80 font-medium px-6 py-3 rounded-lg hover:bg-[#11A15A]/15 transition-colors">
                {t('Soy profesional de salud')}
              </Link>
            </div>
            <HeroDots active={active} onSelect={setActive} />
          </div>
        </div>
      </div>
    </section>
  )
}


// Banner llamativo ubicado justo debajo del Hero: es el primer mensaje
// "fuerte" que ve cualquier visitante, así que concentra las tres promesas
// más importantes de la plataforma (gratis, sin intermediarios, IA 24/7)
// en un formato imposible de pasar por alto.
function FreeAndDirectSection() {
  const { t } = useLanguage()
  const points = [
    {
      icon: Gift,
      title: '100% gratis, para siempre',
      text: 'Registrate como paciente o como profesional de salud sin pagar nada. Sin suscripciones, sin letra chica, sin sorpresas.',
    },
    {
      icon: Handshake,
      title: 'Contacto directo, sin intermediarios',
      text: 'Hablás cara a cara con tu médico. La consulta es entre vos y el profesional — sin aseguradoras, oficinas ni filtros en el medio.',
    },
    {
      icon: Bot,
      title: 'IA por texto o por voz, las 24 horas',
      text: 'Escribile o llamale a Medi cuando quieras. Te escucha, entiende tu síntoma y te conecta al toque con el profesional indicado para vos.',
    },
  ]

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[#0C447C] via-[#185FA5] to-[#0F6E56]">
      {/* Manchas decorativas sutiles, solo estética */}
      <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/5" aria-hidden="true" />
      <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-white/5" aria-hidden="true" />

      <div className="relative max-w-5xl mx-auto px-4 py-14 sm:py-16 text-center">
        <span className="inline-flex items-center gap-1.5 bg-[#3DDC84] text-[#0C2A1E] text-xs font-bold px-3 py-1.5 rounded-full mb-5 uppercase tracking-wide">
          <Gift className="w-3.5 h-3.5" aria-hidden="true" />
          {t('Registro 100% gratuito')}
        </span>
        <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight max-w-2xl mx-auto">
          {t('Tu salud, sin costo de entrada y sin intermediarios')}
        </h2>
        <p className="text-white/85 text-sm sm:text-base mt-4 max-w-xl mx-auto">
          {t('Pacientes y profesionales se registran gratis y se conectan directamente entre sí, acompañados por agentes de IA que están despiertos las 24 horas, por texto o por voz, para llevarte siempre con el médico indicado.')}
        </p>

        <div className="grid sm:grid-cols-3 gap-4 mt-10 text-left">
          {points.map((point, i) => (
            <Reveal key={point.title} delayMs={i * 120}>
              <div className="h-full bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-5">
                <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center mb-3">
                  <point.icon className="w-5 h-5 text-white" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-white mb-1.5">{t(point.title)}</p>
                <p className="text-xs text-white/80">{t(point.text)}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-3 mt-10">
          <Link href="/auth/register/patient" className="bg-white text-[#0C447C] font-semibold px-6 py-3 rounded-lg hover:bg-[#E6F1FB] transition-colors">
            {t('Registrarme gratis como paciente')}
          </Link>
          <Link href="/auth/register/professional" className="bg-[#11A15A] text-white font-semibold px-6 py-3 rounded-lg hover:bg-[#0F6E56] transition-colors">
            {t('Registrarme gratis como profesional')}
          </Link>
        </div>
      </div>
    </section>
  )
}

function HowItWorksSection() {
  const { t } = useLanguage()
  const steps = [
    {
      icon: MessageCircleHeart,
      title: 'Contale tus síntomas a Medi',
      text: 'Nuestro agente de IA te hace un par de preguntas para entender qué te pasa.',
    },
    {
      icon: UserCheck,
      title: 'Te conecta con un profesional',
      text: 'Medi busca un médico verificado y disponible según tu síntoma.',
      done: true,
    },
    {
      icon: Video,
      title: 'Videoconsulta y pago con QR',
      text: 'Hablás con el profesional en tiempo real y pagás de forma simple.',
    },
    {
      icon: FileCheck2,
      title: 'Recibí tu receta digital',
      text: 'Queda verificable con QR, lista para presentar en cualquier farmacia.',
      done: true,
    },
  ]

  return (
    <section className="max-w-5xl mx-auto px-4 py-16">
      <h2 className="text-2xl font-bold text-center text-[#141820] mb-2">{t('Cómo funciona')}</h2>
      <SectionAccent />
      <p className="text-sm text-center text-[#6B738A] mt-3 mb-10">
        {t('De la consulta a la receta, en cuatro pasos.')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {steps.map((step, i) => (
          <div key={step.title} className="bg-white border border-[#DDE1EE] rounded-xl p-5 text-center">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center mx-auto mb-3 ${
              step.done ? 'bg-[#E7F8EF]' : 'bg-[#E6F1FB]'
            }`}>
              <step.icon className={`w-5 h-5 ${step.done ? 'text-[#0F6E56]' : 'text-[#185FA5]'}`} aria-hidden="true" />
            </div>
            <p className={`text-xs font-medium mb-1 ${step.done ? 'text-[#0F6E56]' : 'text-[#185FA5]'}`}>{t('Paso')} {i + 1}</p>
            <p className="text-sm font-medium text-[#141820] mb-1">{t(step.title)}</p>
            <p className="text-xs text-[#6B738A]">{t(step.text)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function AppointmentsSection() {
  const { t } = useLanguage()
  return (
    <section className="bg-white border-t border-b border-[#DDE1EE]">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="grid sm:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 bg-[#E7F8EF] text-[#0F6E56] text-xs font-medium px-3 py-1 rounded-full mb-4">
              <CalendarCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('Agenda compartida')}
            </span>
            <h2 className="text-2xl font-bold text-[#141820] mb-3">
              {t('Agendá tu cita y seguila en un calendario')}
            </h2>
            <p className="text-sm text-[#6B738A] mb-4">
              {t('Tanto el paciente como el profesional ven la cita en su propio calendario apenas se agenda — con fecha, hora y estado siempre actualizados. Nada se coordina por mensajes sueltos.')}
            </p>
            <ul className="space-y-2 text-sm text-[#141820]">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#11A15A]" />
                {t('El paciente elige día y hora disponible del profesional')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#185FA5]" />
                {t('El profesional confirma o reprograma desde su panel')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#11A15A]" />
                {t('Ambos ven el mismo estado de la cita en tiempo real')}
              </li>
            </ul>
          </div>

          {/* Mini mockup de calendario, solo ilustrativo — los nombres de
              ejemplo (Dra. Rojas, Dr. Vargas) no están en el glosario, así
              que quedan en español a propósito, son solo datos de muestra */}
          <div className="bg-[#F5F6FA] border border-[#DDE1EE] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[#141820]">{t('Mis próximas citas')}</p>
              <CalendarCheck2 className="w-4 h-4 text-[#11A15A]" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[#6B738A] mb-1">
              {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1 mb-4">
              {Array.from({ length: 28 }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square rounded-md flex items-center justify-center text-[10px] ${
                    [9, 16, 22].includes(i)
                      ? 'bg-[#11A15A] text-white font-medium'
                      : 'bg-white text-[#6B738A]'
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="bg-white rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-[#141820]">Dra. Rojas — Pediatría</span>
                <span className="text-xs text-[#185FA5] font-medium">10:00</span>
              </div>
              <div className="bg-white rounded-lg px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-[#141820]">Dr. Vargas — Clínica general</span>
                <span className="text-xs text-[#185FA5] font-medium">17:30</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function AI24_7Section() {
  const { t } = useLanguage()
  return (
    <section className="max-w-5xl mx-auto px-4 py-16">
      <div className="grid sm:grid-cols-2 gap-10 items-center">
        {/* Mini mockup de recordatorio por WhatsApp, solo ilustrativo — el
            texto de la conversación de ejemplo queda en español a propósito */}
        <Reveal className="order-2 sm:order-1 bg-[#E7F8EF] border border-[#DDE1EE] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-[#25D366] flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-white" aria-hidden="true" />
            </div>
            <p className="text-xs font-medium text-[#141820]">Medi · WhatsApp</p>
          </div>
          <div className="bg-white rounded-xl rounded-tl-none px-3 py-2.5 text-xs text-[#141820] mb-2 max-w-[85%]">
            Hola Carla 👋 te recuerdo tu cita con la Dra. Rojas hoy a las 10:00.
            ¿Confirmás que vas a poder conectarte?
          </div>
          <div className="bg-[#DCF8C6] rounded-xl rounded-tr-none px-3 py-2.5 text-xs text-[#141820] ml-auto max-w-[70%] text-right">
            Sí, ahí estaré
          </div>
        </Reveal>

        <Reveal delayMs={100} className="order-1 sm:order-2">
          <span className="inline-flex items-center gap-1.5 bg-[#E7F8EF] text-[#0F6E56] text-xs font-medium px-3 py-1 rounded-full mb-4">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {t('Disponible 24/7')}
          </span>
          <h2 className="text-2xl font-bold text-[#141820] mb-3">
            {t('Agentes de IA que nunca se duermen')}
          </h2>
          <p className="text-sm text-[#6B738A] mb-4">
            {t('Medi está disponible las 24 horas, los 7 días de la semana, para orientarte, conectarte con un profesional y agendar tu cita — sin horario de atención de por medio.')}
          </p>
          <div className="bg-white border border-[#DDE1EE] rounded-xl p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#E7F8EF] flex items-center justify-center flex-shrink-0">
              <Stethoscope className="w-4 h-4 text-[#0F6E56]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#141820] mb-1">{t('Recordatorios automáticos por WhatsApp')}</p>
              <p className="text-xs text-[#6B738A]">
                {t('Una vez agendada la cita, el agente te escribe por WhatsApp antes de la hora para recordártela y confirmar que vas a asistir — así ni el paciente ni el profesional pierden tiempo con citas a las que nadie se conecta.')}
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function TrustSection() {
  const { t } = useLanguage()
  const points = [
    {
      icon: BadgeCheck,
      title: 'Profesionales verificados',
      text: 'Cada médico pasa por un proceso de verificación de título y matrícula antes de atender.',
    },
    {
      icon: ShieldCheck,
      title: 'Consultas seguras',
      text: 'Videoconsulta cifrada y datos médicos protegidos en todo momento.',
      green: true,
    },
    {
      icon: FileCheck2,
      title: 'Recetas verificables',
      text: 'Cada receta digital tiene un código QR que cualquier farmacia puede validar.',
      green: true,
    },
  ]

  return (
    <section className="bg-gradient-to-b from-white via-[#F7FBF9] to-white border-t border-b border-[#DDE1EE]">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center text-[#141820] mb-3">
          {t('Atención médica en la que podés confiar')}
        </h2>
        <SectionAccent />
        <div className="grid sm:grid-cols-3 gap-4 mt-7">
          {points.map((point, i) => (
            <Reveal key={point.title} delayMs={i * 120}>
              <div className="flex items-start gap-3 bg-[#F5F6FA] rounded-xl p-4">
                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                  <point.icon className={`w-5 h-5 ${point.green ? 'text-[#0F6E56]' : 'text-[#185FA5]'}`} aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#141820] mb-1">{t(point.title)}</p>
                  <p className="text-xs text-[#6B738A]">{t(point.text)}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function LandingFooter() {
  const { t } = useLanguage()
  return (
    <footer className="border-t border-[#DDE1EE] bg-white">
      <div className="h-1 bg-gradient-to-r from-[#185FA5] to-[#11A15A]" />
      <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6B738A]">
        <div className="flex flex-col items-center sm:items-start gap-1">
          <span>© {new Date().getFullYear()} MedicBolivia. {t('Todos los derechos reservados.')}</span>
          <a href="mailto:info@medicbolivia.com" className="flex items-center gap-1.5 hover:text-[#141820]">
            <Mail className="w-3.5 h-3.5" aria-hidden="true" /> info@medicbolivia.com
          </a>
        </div>
        <div className="flex gap-4">
          <Link href="/especialidades" className="hover:text-[#141820]">{t('Especialidades')}</Link>
          <Link href="/telemedicina" className="hover:text-[#141820]">{t('Telemedicina')}</Link>
          <a href="#contacto" className="hover:text-[#141820]">{t('Contacto')}</a>
          <a href="#faq" className="hover:text-[#141820]">{t('Preguntas frecuentes')}</a>
          <Link href="/verificar-receta" className="hover:text-[#141820]">{t('Verificar receta')}</Link>
          <Link href="/auth/login" className="hover:text-[#141820]">{t('Iniciar sesión')}</Link>
        </div>
      </div>
    </footer>
  )
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <LandingHeader />
      <Hero />
      <FreeAndDirectSection />
      <HowItWorksSection />
      <AppointmentsSection />
      <AI24_7Section />
      <VerifyPrescriptionSection />
      <TrustSection />
      <ContactSection />
      <FAQSection />
      <LandingFooter />
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isAuthenticated } = useAuthStore()
  const { t } = useLanguage()

  // Si el usuario llegó desde el logo de su panel (link "medicbolivia.com"
  // en el DashboardLayout), queremos que vea la landing pública tal cual,
  // sin que lo rebote de nuevo a su dashboard.
  const stayOnLanding = searchParams.get('home') === '1'

  useEffect(() => {
    if (!isAuthenticated) return
    if (stayOnLanding) return
    if (user?.role === 'PATIENT') router.push('/patient/dashboard')
    else if (user?.role === 'PROFESSIONAL') router.push('/professional/dashboard')
    else if (user?.role === 'ADMIN') router.push('/admin/dashboard')
  }, [isAuthenticated, user, router, stayOnLanding])

  // Con sesión iniciada: pantalla breve mientras el efecto redirige
  // (salvo que venga del logo, en cuyo caso mostramos la landing directo).
  if (isAuthenticated && !stayOnLanding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#11A15A] border-t-transparent rounded-full animate-spin-slow" />
          <p className="text-sm text-[#6B738A]">{t('Redirigiendo...')}</p>
        </div>
      </div>
    )
  }

  // Sin sesión: landing pública — cualquiera puede entrar.
  return <LandingPage />
}