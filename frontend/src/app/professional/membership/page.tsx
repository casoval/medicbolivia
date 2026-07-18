'use client'
// src/app/professional/membership/page.tsx
//
// Esta pantalla se fusionó con "Mis pacientes" (mostrar la lista de
// vinculados en dos lugares distintos era confuso y redundante — un
// paciente que ya tuvo consulta se vincula automáticamente y aparecía
// en "Mis pacientes" pero no acá, o viceversa). El estado de membresía
// y el botón "Agendar cita" ahora viven directamente en /professional/patients.
// Se deja este redirect para no romper marcadores/enlaces viejos.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LoadingScreen } from '@/components/ui'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export default function MembershipRedirectPage() {
  const router = useRouter()
  const { t } = useLanguage()
  useEffect(() => {
    router.replace('/professional/patients')
  }, [router])
  return <LoadingScreen text={t('Redirigiendo...')} />
}
