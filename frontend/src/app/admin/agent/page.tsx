'use client'
// src/app/admin/agent/page.tsx
// Reemplazada por el panel unificado /admin/ia (4 pestañas: bot, recordatorios,
// conversaciones + config del agente, automatización). Se deja este redirect
// en vez de borrar el archivo por si algo externo todavía enlaza /admin/agent.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminAgentRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/ia') }, [router])
  return null
}
