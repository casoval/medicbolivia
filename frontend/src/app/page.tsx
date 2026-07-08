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
        <div className="w-14 h-14 rounded-2xl bg-[#E6F1FB] flex items-center justify-center mx-auto mb-4 text-2xl">
          🔍
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

function Hero() {
  return (
    <section className="max-w-5xl mx-auto px-4 pt-16 pb-20 text-center">
      <span className="inline-block bg-[#E6F1FB] text-[#185FA5] text-xs font-medium px-3 py-1 rounded-full mb-4">
        🤖 Orientación médica con IA, en segundos
      </span>
      <h1 className="text-3xl sm:text-4xl font-bold text-[#141820] max-w-2xl mx-auto leading-tight">
        Consultas médicas en línea, conectadas por inteligencia artificial
      </h1>
      <p className="text-[#6B738A] max-w-xl mx-auto mt-4">
        Contale tus síntomas a Medi, nuestro agente de orientación, y te conecta con un
        profesional de salud verificado en Bolivia — con videoconsulta, receta digital y pago con QR.
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-8">
        <Link href="/auth/register/patient" className="bg-[#185FA5] text-white font-medium px-6 py-3 rounded-lg hover:bg-[#0C447C] transition-colors">
          Soy paciente — quiero consultar
        </Link>
        <Link href="/auth/register/professional" className="bg-white text-[#141820] border border-[#DDE1EE] font-medium px-6 py-3 rounded-lg hover:bg-[#F5F6FA] transition-colors">
          Soy profesional de salud
        </Link>
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
      <VerifyPrescriptionSection />
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
