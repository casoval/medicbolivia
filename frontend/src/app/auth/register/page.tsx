'use client'
// src/app/auth/register/page.tsx
// Paso previo al registro: antes el botón "Registrarme" del header llevaba
// directo a /auth/register/patient, lo que confundía a los profesionales
// que también hacían clic ahí. Esta pantalla deja elegir el camino
// explicando qué gana cada quien, y recién ahí manda al formulario
// correspondiente (/auth/register/patient o /auth/register/professional).

import Link from 'next/link'
import Image from 'next/image'
import { HeartPulse, Stethoscope, Check } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export default function RegisterChoicePage() {
  const { t } = useLanguage()

  const patientPoints = [
    'Consultá por videollamada o chat con médicos verificados',
    'Agendá y gestioná tus citas cuando quieras',
    'Recordatorios automáticos por WhatsApp antes de tu cita',
    'Sin costo de registro ni suscripciones',
  ]

  const professionalPoints = [
    'Recibí pacientes y cobrá de forma segura y confiable',
    'Elegí tus horarios y tus precios de consulta',
    'Un agente IA con voz te guía durante la consulta',
    'Perfil verificado que genera confianza',
    'Cobrá tus consultas directamente, sin intermediarios',
  ]

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-3xl">

        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <Image src="/logo1.png" alt="MedicBolivia" width={1262} height={173} className="h-8 w-auto mx-auto" priority />
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-[#141820] mt-4">
            {t('¿Cómo querés registrarte?')}
          </h1>
          <p className="text-sm text-[#475569] mt-1">
            {t('Elegí la opción que te corresponde — el registro es gratuito para ambos.')}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">

          {/* Paciente */}
          <div className="card flex flex-col">
            <div className="w-11 h-11 rounded-full bg-[#E6F1FB] flex items-center justify-center mb-4">
              <HeartPulse className="w-5 h-5 text-[#185FA5]" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-[#141820] mb-1">{t('Soy paciente')}</h2>
            <p className="text-sm text-[#475569] mb-4">
              {t('Quiero consultar con un médico.')}
            </p>
            <ul className="space-y-2 mb-6 flex-1">
              {patientPoints.map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm text-[#3A4155]">
                  <Check className="w-4 h-4 text-[#185FA5] shrink-0 mt-0.5" aria-hidden="true" />
                  {t(point)}
                </li>
              ))}
            </ul>
            <Link href="/auth/register/patient" className="btn-primary w-full text-center">
              {t('Registrarme como paciente')}
            </Link>
          </div>

          {/* Profesional */}
          <div className="card flex flex-col">
            <div className="w-11 h-11 rounded-full bg-[#E1F5EE] flex items-center justify-center mb-4">
              <Stethoscope className="w-5 h-5 text-[#0F6E56]" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-[#141820] mb-1">{t('Soy profesional de salud')}</h2>
            <p className="text-sm text-[#475569] mb-4">
              {t('Quiero atender pacientes en la plataforma.')}
            </p>
            <ul className="space-y-2 mb-6 flex-1">
              {professionalPoints.map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm text-[#3A4155]">
                  <Check className="w-4 h-4 text-[#0F6E56] shrink-0 mt-0.5" aria-hidden="true" />
                  {t(point)}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/register/professional"
              className="bg-[#11A15A] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#0F6E56] transition-colors w-full text-center"
            >
              {t('Registrarme como profesional')}
            </Link>
          </div>
        </div>

        <p className="text-center text-sm text-[#475569] mt-6">
          {t('¿Ya tienes cuenta?')}{' '}
          <Link href="/auth/login" className="text-[#185FA5] font-medium hover:underline">
            {t('Inicia sesión')}
          </Link>
        </p>
      </div>
    </div>
  )
}
