'use client'
// src/app/patient/video/page.tsx
// Sala de videoconsulta

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { consultationsAPI } from '@/lib/api'

export default function VideoPage() {
  const params = useSearchParams()
  const router = useRouter()
  const consultationId = params.get('consultationId')
  const videoUrl = params.get('url')

  const [micOn, setMicOn]     = useState(true)
  const [camOn, setCamOn]     = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [ending, setEnding]   = useState(false)

  // Contador de tiempo
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [])

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  async function endCall() {
    setEnding(true)
    if (consultationId) {
      try {
        await consultationsAPI.updateStatus(consultationId, 'COMPLETED')
      } catch {}
    }
    router.push('/patient/history')
  }

  return (
    <div className="min-h-screen bg-[#0f1520] flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-black/30">
        <div className="text-white font-bold text-sm">
          Medic<span className="opacity-50 font-normal">Bolivia</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#E24B4A] animate-pulse" />
          <span className="text-white/70 text-xs font-mono">{formatTime(elapsed)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C27A]" />
          <span className="text-white/60 text-xs">Cifrada</span>
        </div>
      </div>

      {/* Área de video */}
      <div className="flex-1 relative flex items-center justify-center">

        {/* Video principal — profesional */}
        <div className="w-full h-full flex items-center justify-center">
          {videoUrl ? (
            <iframe
              src={videoUrl}
              allow="camera; microphone; fullscreen; speaker; display-capture"
              className="w-full h-full"
              style={{ minHeight: '70vh' }}
            />
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center text-2xl font-bold text-white/60">
                DR
              </div>
              <p className="text-white/60 text-sm">Esperando al profesional...</p>
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        {/* Video pequeño — paciente (pip) */}
        <div className="absolute bottom-4 right-4 w-28 h-20 bg-[#1e2a3c] rounded-xl border border-white/20 flex items-center justify-center overflow-hidden">
          {camOn ? (
            <div className="w-full h-full bg-[#2a3550] flex items-center justify-center">
              <span className="text-white/40 text-xs">Tú</span>
            </div>
          ) : (
            <div className="w-full h-full bg-[#1a1f2e] flex items-center justify-center">
              <span className="text-white/30 text-xs">Cámara off</span>
            </div>
          )}
        </div>
      </div>

      {/* Controles */}
      <div className="flex items-center justify-center gap-4 py-5 bg-black/40">

        {/* Micrófono */}
        <button
          onClick={() => setMicOn(!micOn)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            micOn ? 'bg-white/15 hover:bg-white/25' : 'bg-[#E24B4A] hover:bg-[#c73a39]'
          }`}
          title={micOn ? 'Silenciar' : 'Activar micrófono'}
        >
          {micOn ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
              <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>
            </svg>
          )}
        </button>

        {/* Cámara */}
        <button
          onClick={() => setCamOn(!camOn)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            camOn ? 'bg-white/15 hover:bg-white/25' : 'bg-[#E24B4A] hover:bg-[#c73a39]'
          }`}
          title={camOn ? 'Apagar cámara' : 'Encender cámara'}
        >
          {camOn ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          )}
        </button>

        {/* Colgar */}
        <button
          onClick={endCall}
          disabled={ending}
          className="w-14 h-14 rounded-full bg-[#E24B4A] hover:bg-[#c73a39] flex items-center justify-center transition-colors disabled:opacity-50"
          title="Terminar consulta"
        >
          {ending ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c1.12.45 2.3.77 3.53.9a2 2 0 011.8 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.42 19.42 0 013.07 8.68 2 2 0 015 6.5h3a2 2 0 012 1.72c.13 1.23.45 2.41.9 3.53a2 2 0 01-.45 2.11l-1.27 1.27"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          )}
        </button>

        {/* Chat (placeholder) */}
        <button
          className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
          title="Chat"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </button>
      </div>

      {/* Aviso privacidad */}
      <div className="text-center py-2 bg-black/20">
        <p className="text-white/30 text-xs">🔒 Esta videoconsulta es privada y confidencial</p>
      </div>
    </div>
  )
}
