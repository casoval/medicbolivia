'use client'
// src/app/patient/professionals/page.tsx
//
// "Mis profesionales" pasó a ser la pestaña "Profesionales consultados"
// dentro de /patient/search (ver components/patient/ConsultedProfessionals.tsx
// y app/patient/search/page.tsx). Esta ruta se conserva solo como redirect
// para no romper marcadores o enlaces viejos que apunten acá.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LoadingScreen } from '@/components/ui'

export default function PatientProfessionalsRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/patient/search?tab=consultados')
  }, [router])

  return <LoadingScreen text="Redirigiendo..." />
}
