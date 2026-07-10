'use client'
// src/app/page.tsx
// Landing pública de MedicBolivia. Cualquier visitante puede entrar sin
// cuenta. Si ya hay sesión iniciada, redirige directo a su dashboard — igual
// que antes — pero ahora quien NO tiene sesión ve una página real en vez de
// un spinner de "Redirigiendo...".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/store'
import { faqAPI } from '@/lib/api'
import type { FAQ, FAQAudience } from '@/types'
import { Spinner } from '@/components/ui'
import { MessageCircleHeart, UserCheck, Video, FileCheck2, QrCode, ShieldCheck, BadgeCheck, CalendarCheck2, Clock, Bell, Stethoscope, Mic, Cpu } from 'lucide-react'

const TABS: { key: FAQAudience; label: string }[] = [
  { key: 'GENERAL', label: 'General' },
  { key: 'PATIENT', label: 'Paciente' },
  { key: 'PROFESSIONAL', label: 'Profesional' },
]

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

  const { data: faqs = [], isLoading } = useQuery({
    queryKey: ['public', 'faqs'],
    queryFn: async () => (await faqAPI.list()).data,
    staleTime: 1000 * 60 * 10,
  })

  const visible = faqs.filter((f) => f.audience === tab)

  return (
    <section id="faq" className="max-w-3xl mx-auto px-4 py-16">
      <h2 className="text-2xl font-bold text-center text-[#141820] mb-2">Preguntas frecuentes</h2>
      <p className="text-sm text-center text-[#6B738A] mb-8">
        ¿Quiénes somos, cómo funciona la plataforma y qué necesitás saber antes de empezar.
      </p>

      <div className="flex justify-center gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-4 py-2 rounded-full border transition-colors ${
              tab === t.key
                ? 'bg-[#185FA5] text-white border-[#185FA5]'
                : 'bg-white text-[#6B738A] border-[#DDE1EE]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : visible.length === 0 ? (
        <p className="text-center text-sm text-[#6B738A] py-8">
          Todavía no hay preguntas cargadas en esta sección.
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

  function goVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    router.push(`/verificar-receta?code=${encodeURIComponent(code.trim())}`)
  }

  return (
    <section className="bg-white border-t border-b border-[#DDE1EE]">
      <div className="max-w-3xl mx-auto px-4 py-14 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#E6F1FB] flex items-center justify-center mx-auto mb-4">
          <QrCode className="w-6 h-6 text-[#185FA5]" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-bold text-[#141820] mb-2">Verificar una receta médica</h2>
        <p className="text-sm text-[#6B738A] mb-6 max-w-md mx-auto">
          ¿Recibiste una receta digital de MedicBolivia? Escaneá el código QR con tu celular,
          o ingresá el código manualmente para confirmar que es auténtica.
        </p>
        <form onSubmit={goVerify} className="flex gap-2 max-w-sm mx-auto">
          <input
            className="flex-1 rounded-lg border border-[#DDE1EE] px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
            placeholder="Ej: MB-RX-A1B2C3D4E5F6"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2.5 rounded-lg whitespace-nowrap">
            Verificar
          </button>
        </form>
        <Link href="/verificar-receta" className="text-xs text-[#185FA5] hover:underline mt-3 inline-block">
          o abrir la página de verificación completa →
        </Link>
      </div>
    </section>
  )
}

function LandingHeader() {
  return (
    <header className="border-b border-[#DDE1EE] bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-20 flex items-center justify-between">
        <div className="flex items-center">
          <Image src="/logo.png" alt="MedicBolivia" width={472} height={128} className="h-32 w-auto" priority />
        </div>
        <nav className="hidden sm:flex items-center gap-6 text-sm text-[#6B738A]">
          <a href="#faq" className="hover:text-[#141820]">Preguntas frecuentes</a>
          <Link href="/verificar-receta" className="hover:text-[#141820]">Verificar receta</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/auth/login" className="text-sm font-medium text-[#185FA5] px-3 py-2 hover:underline">
            Iniciar sesión
          </Link>
          <Link href="/auth/register/patient" className="bg-[#185FA5] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#0C447C] transition-colors">
            Registrarme
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
    title: 'Consultas médicas en línea, conectadas por inteligencia artificial',
    description:
      'Contale tus síntomas a Medi, nuestro agente de orientación, y te conecta con un profesional de salud verificado en Bolivia — con videoconsulta, receta digital y pago con QR.',
  },
  {
    image: '/hero-consulta1.jpg',
    imageAlt: 'Dos mujeres bolivianas contemplando el lago Titicaca',
    focus: 'object-center',
    badgeIcon: Mic,
    badgeText: 'Nuevo: consultá por voz',
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

function HeroCopy({ slide }: { slide: HeroSlide }) {
  const Icon = slide.badgeIcon
  return (
    <>
      <span className="inline-flex items-center gap-1.5 bg-white/15 text-white text-xs font-medium px-3 py-1 rounded-full mb-4 backdrop-blur-sm">
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {slide.badgeText}
      </span>
      <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
        {slide.title}
      </h1>
      <p className="text-white/85 mt-4">
        {slide.description}
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
        </div>
        <div className="bg-gradient-to-b from-[#0C447C] to-[#185FA5] px-4 py-10">
          <div className="max-w-lg mx-auto">
            <div key={active} style={{ animation: 'heroTextIn 0.6s ease-out' }}>
              <HeroCopy slide={slide} />
            </div>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link href="/auth/register/patient" className="bg-white text-[#0C447C] font-medium px-6 py-3 rounded-lg hover:bg-[#E6F1FB] transition-colors">
                Soy paciente — quiero consultar
              </Link>
              <Link href="/auth/register/professional" className="bg-transparent text-white border border-white/50 font-medium px-6 py-3 rounded-lg hover:bg-white/10 transition-colors">
                Soy profesional de salud
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

        <div className="relative h-full max-w-5xl mx-auto px-4 flex items-center">
          <div className="max-w-lg">
            <div key={active} style={{ animation: 'heroTextIn 0.6s ease-out' }}>
              <HeroCopy slide={slide} />
            </div>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link href="/auth/register/patient" className="bg-white text-[#0C447C] font-medium px-6 py-3 rounded-lg hover:bg-[#E6F1FB] transition-colors">
                Soy paciente — quiero consultar
              </Link>
              <Link href="/auth/register/professional" className="bg-transparent text-white border border-white/50 font-medium px-6 py-3 rounded-lg hover:bg-white/10 transition-colors">
                Soy profesional de salud
              </Link>
            </div>
            <HeroDots active={active} onSelect={setActive} />
          </div>
        </div>
      </div>
    </section>
  )
}


function HowItWorksSection() {
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
    },
  ]

  return (
    <section className="max-w-5xl mx-auto px-4 py-16">
      <h2 className="text-2xl font-bold text-center text-[#141820] mb-2">Cómo funciona</h2>
      <p className="text-sm text-center text-[#6B738A] mb-10">
        De la consulta a la receta, en cuatro pasos.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {steps.map((step, i) => (
          <div key={step.title} className="bg-white border border-[#DDE1EE] rounded-xl p-5 text-center">
            <div className="w-11 h-11 rounded-full bg-[#E6F1FB] flex items-center justify-center mx-auto mb-3">
              <step.icon className="w-5 h-5 text-[#185FA5]" aria-hidden="true" />
            </div>
            <p className="text-xs font-medium text-[#185FA5] mb-1">Paso {i + 1}</p>
            <p className="text-sm font-medium text-[#141820] mb-1">{step.title}</p>
            <p className="text-xs text-[#6B738A]">{step.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function AppointmentsSection() {
  return (
    <section className="bg-white border-t border-b border-[#DDE1EE]">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="grid sm:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 bg-[#E6F1FB] text-[#185FA5] text-xs font-medium px-3 py-1 rounded-full mb-4">
              <CalendarCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
              Agenda compartida
            </span>
            <h2 className="text-2xl font-bold text-[#141820] mb-3">
              Agendá tu cita y seguila en un calendario
            </h2>
            <p className="text-sm text-[#6B738A] mb-4">
              Tanto el paciente como el profesional ven la cita en su propio calendario apenas
              se agenda — con fecha, hora y estado siempre actualizados. Nada se coordina por
              mensajes sueltos.
            </p>
            <ul className="space-y-2 text-sm text-[#141820]">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#185FA5]" />
                El paciente elige día y hora disponible del profesional
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#185FA5]" />
                El profesional confirma o reprograma desde su panel
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#185FA5]" />
                Ambos ven el mismo estado de la cita en tiempo real
              </li>
            </ul>
          </div>

          {/* Mini mockup de calendario, solo ilustrativo */}
          <div className="bg-[#F5F6FA] border border-[#DDE1EE] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-[#141820]">Mis próximas citas</p>
              <CalendarCheck2 className="w-4 h-4 text-[#185FA5]" aria-hidden="true" />
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
                      ? 'bg-[#185FA5] text-white font-medium'
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
  return (
    <section className="max-w-5xl mx-auto px-4 py-16">
      <div className="grid sm:grid-cols-2 gap-10 items-center">
        {/* Mini mockup de recordatorio por WhatsApp, solo ilustrativo */}
        <div className="order-2 sm:order-1 bg-[#E7F8EF] border border-[#DDE1EE] rounded-2xl p-5">
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
        </div>

        <div className="order-1 sm:order-2">
          <span className="inline-flex items-center gap-1.5 bg-[#E6F1FB] text-[#185FA5] text-xs font-medium px-3 py-1 rounded-full mb-4">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            Disponible 24/7
          </span>
          <h2 className="text-2xl font-bold text-[#141820] mb-3">
            Agentes de IA que nunca se duermen
          </h2>
          <p className="text-sm text-[#6B738A] mb-4">
            Medi está disponible las 24 horas, los 7 días de la semana, para orientarte,
            conectarte con un profesional y agendar tu cita — sin horario de atención de por medio.
          </p>
          <div className="bg-white border border-[#DDE1EE] rounded-xl p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#E7F8EF] flex items-center justify-center flex-shrink-0">
              <Stethoscope className="w-4 h-4 text-[#0F6E56]" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#141820] mb-1">Recordatorios automáticos por WhatsApp</p>
              <p className="text-xs text-[#6B738A]">
                Una vez agendada la cita, el agente te escribe por WhatsApp antes de la hora
                para recordártela y confirmar que vas a asistir — así ni el paciente ni el
                profesional pierden tiempo con citas a las que nadie se conecta.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TrustSection() {
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
    },
    {
      icon: FileCheck2,
      title: 'Recetas verificables',
      text: 'Cada receta digital tiene un código QR que cualquier farmacia puede validar.',
    },
  ]

  return (
    <section className="bg-white border-t border-b border-[#DDE1EE]">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center text-[#141820] mb-10">
          Atención médica en la que podés confiar
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {points.map((point) => (
            <div key={point.title} className="flex items-start gap-3 bg-[#F5F6FA] rounded-xl p-4">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                <point.icon className="w-5 h-5 text-[#185FA5]" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#141820] mb-1">{point.title}</p>
                <p className="text-xs text-[#6B738A]">{point.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LandingFooter() {
  return (
    <footer className="border-t border-[#DDE1EE] bg-white">
      <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6B738A]">
        <span>© {new Date().getFullYear()} MedicBolivia. Todos los derechos reservados.</span>
        <div className="flex gap-4">
          <a href="#faq" className="hover:text-[#141820]">Preguntas frecuentes</a>
          <Link href="/verificar-receta" className="hover:text-[#141820]">Verificar receta</Link>
          <Link href="/auth/login" className="hover:text-[#141820]">Iniciar sesión</Link>
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
      <HowItWorksSection />
      <AppointmentsSection />
      <AI24_7Section />
      <VerifyPrescriptionSection />
      <TrustSection />
      <FAQSection />
      <LandingFooter />
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const { user, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) return
    if (user?.role === 'PATIENT') router.push('/patient/dashboard')
    else if (user?.role === 'PROFESSIONAL') router.push('/professional/dashboard')
    else if (user?.role === 'ADMIN') router.push('/admin/dashboard')
  }, [isAuthenticated, user, router])

  // Con sesión iniciada: pantalla breve mientras el efecto redirige.
  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow" />
          <p className="text-sm text-[#6B738A]">Redirigiendo...</p>
        </div>
      </div>
    )
  }

  // Sin sesión: landing pública — cualquiera puede entrar.
  return <LandingPage />
}