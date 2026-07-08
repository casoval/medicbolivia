'use client'
// src/app/mantenimiento/page.tsx
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { maintenanceAPI } from '@/lib/api'

const POLL_MS = 10000

export default function MaintenancePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      setChecking(true)
      try {
        const { maintenance_mode } = await maintenanceAPI.check()
        if (!cancelled && !maintenance_mode) {
          router.replace('/')
        }
      } catch {
        // Si falla el chequeo (ej. backend caído), simplemente reintenta en el próximo ciclo
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    check()
    const interval = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA] px-6 overflow-hidden relative">
      <style>{`
        @keyframes mb-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes mb-breathe {
          0%, 100% { transform: scale(1); opacity: .5; }
          50% { transform: scale(1.15); opacity: .85; }
        }
        @keyframes mb-spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .mb-float { animation: mb-float 3.2s ease-in-out infinite; }
        .mb-breathe { animation: mb-breathe 2.6s ease-in-out infinite; }
        .mb-spin-slow { animation: mb-spin-slow 7s linear infinite; }
      `}</style>

      {/* Blobs de fondo */}
      <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-[#185FA5]/10 mb-breathe" />
      <div
        className="absolute -bottom-24 -right-16 w-80 h-80 rounded-full bg-[#185FA5]/10 mb-breathe"
        style={{ animationDelay: '1.2s' }}
      />

      <div className="relative text-center max-w-sm mb-float">
        <div className="relative mx-auto mb-6 w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-[#185FA5]/15 mb-breathe" />
          <svg
            className="relative mb-spin-slow"
            width="56" height="56" viewBox="0 0 24 24"
            fill="none" stroke="#185FA5" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </div>

        <h1 className="text-lg font-semibold text-[#1A1F36]">MedicBolivia está en mantenimiento</h1>
        <p className="text-sm text-[#6B738A] mt-2">
          Estamos haciendo algunos ajustes para mejorar la plataforma. Volvemos enseguida.
        </p>

        <div className="flex items-center justify-center gap-1.5 mt-6">
          <span className="w-2 h-2 rounded-full bg-[#185FA5] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-[#185FA5] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-[#185FA5] animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <p className="text-xs text-[#A0A8BF] mt-3">
          {checking ? 'Comprobando…' : 'Verificamos automáticamente cada 10 segundos'}
        </p>
      </div>
    </div>
  )
}