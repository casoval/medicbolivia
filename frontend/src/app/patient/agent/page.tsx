'use client'
// src/app/patient/agent/page.tsx

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { agentAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import { useAgentStore } from '@/lib/store'
import type { Professional } from '@/types'

const IconBot    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconHome   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
const IconClock  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>

const NAV = [
  { label: 'Inicio',         href: '/patient/dashboard',    icon: <IconHome /> },
  { label: 'Buscar médico',  href: '/patient/search',       icon: <IconSearch /> },
  { label: 'Agente IA',      href: '/patient/agent',        icon: <IconBot /> },
  { label: 'Sala de espera', href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas',  href: '/patient/history',      icon: <IconFile /> },
]

const QUICK_REPLIES = [
  'Tengo dolor de cabeza',
  'Dolor en el pecho',
  'Me siento ansioso/a',
  'Mi hijo está enfermo',
  'Necesito control de peso',
  'Dolor en la espalda',
]

// ── Reproductor de audio estilo WhatsApp ─────────────
function AudioBubble({ audioBase64, isUser }: { audioBase64: string; isUser: boolean }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = new Audio(`data:audio/${isUser ? 'webm' : 'mp3'};base64,${audioBase64}`)
    audioRef.current = audio

    audio.onloadedmetadata = () => setDuration(audio.duration)
    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime)
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0)
    }
    audio.onended = () => {
      setPlaying(false)
      setProgress(0)
      setCurrentTime(0)
    }

    return () => { audio.pause(); audio.src = '' }
  }, [audioBase64])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.play()
      setPlaying(true)
    }
  }

  function formatTime(s: number) {
    if (!s || isNaN(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const userColors = {
    btn: 'bg-white/30 hover:bg-white/50',
    bar: 'bg-white/30',
    fill: 'bg-white',
    time: 'text-white/80',
    wave: 'bg-white/60',
  }
  const agentColors = {
    btn: 'bg-[#185FA5]/20 hover:bg-[#185FA5]/30',
    bar: 'bg-[#DDE1EE]',
    fill: 'bg-[#185FA5]',
    time: 'text-[#6B738A]',
    wave: 'bg-[#185FA5]/40',
  }
  const c = isUser ? userColors : agentColors

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      {/* Botón play/pause */}
      <button
        onClick={togglePlay}
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${c.btn}`}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        )}
      </button>

      {/* Onda + barra de progreso */}
      <div className="flex-1 flex flex-col gap-1">
        {/* Onda animada estilo WhatsApp */}
        <div className="flex items-center gap-[2px] h-5">
          {Array.from({ length: 20 }).map((_, i) => {
            const filled = progress > (i / 20) * 100
            const height = [3, 5, 8, 6, 10, 7, 9, 5, 8, 6, 10, 7, 5, 9, 6, 8, 5, 7, 4, 6][i]
            return (
              <div
                key={i}
                style={{ height: `${height * (playing ? (1 + Math.sin(Date.now() / 200 + i) * 0.3) : 1)}px` }}
                className={`w-[3px] rounded-full transition-all ${filled ? c.fill : c.wave}`}
              />
            )
          })}
        </div>
        {/* Tiempo */}
        <span className={`text-[10px] ${c.time}`}>
          {playing ? formatTime(currentTime) : formatTime(duration)}
        </span>
      </div>
    </div>
  )
}

function ProfessionalCard({ pro, onSelect }: { pro: Professional; onSelect: (pro: Professional) => void }) {
  return (
    <div
      className="bg-white border border-[#DDE1EE] rounded-xl p-3 flex items-start gap-3 hover:border-[#185FA5] transition-colors cursor-pointer"
      onClick={() => onSelect(pro)}
    >
      <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
        {pro.first_name[0]}{pro.last_name[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{pro.first_name} {pro.last_name}</p>
        <p className="text-xs text-[#6B738A]">{pro.specialty}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#EF9F27] text-xs">★ {parseFloat(pro.average_rating).toFixed(1)}</span>
          <span className="badge-green text-[10px]">En línea</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold">Bs. {parseFloat(pro.price_general).toFixed(0)}</p>
        <button className="btn-primary text-xs py-1 px-2 mt-1">Consultar</button>
      </div>
    </div>
  )
}

export default function AgentPage() {
  const router = useRouter()
  const {
    sessionId, messages, isTyping, availableProfessionals,
    setSessionId, addMessage, setTyping, setAvailableProfessionals
  } = useAgentStore()

  const [input, setInput] = useState('')
  const [creatingConsultation, setCreatingConsultation] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Grabación de voz
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [processingVoice, setProcessingVoice] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (messages.length === 0) {
      addMessage('agent', '¡Hola! Soy Medi, tu agente de orientación médica de MedicBolivia. Cuéntame, ¿cómo te sientes hoy? Puedes escribirme o enviarme un mensaje de voz 🎤')
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // ── Grabación: mantener presionado ───────────────
  function onMicPointerDown() {
    // Pequeño delay para distinguir tap de hold
    holdTimeoutRef.current = setTimeout(() => startRecording(), 150)
  }

  function onMicPointerUp() {
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current)
    if (isRecording) stopRecording()
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          await sendVoiceMessage(blob, mimeType)
        }
      }

      mediaRecorder.start(250)
      setIsRecording(true)
      setRecordingSeconds(0)

      timerRef.current = setInterval(() => {
        setRecordingSeconds(s => {
          if (s >= 59) { stopRecording(); return 60 }
          return s + 1
        })
      }, 1000)
    } catch {
      alert('No se pudo acceder al micrófono. Verifica los permisos del navegador.')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.requestData() // ← fuerza flush de datos
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
    setRecordingSeconds(0)
  }

  async function sendVoiceMessage(audioBlob: Blob, mimeType: string) {
    setProcessingVoice(true)
    setTyping(true)

    // Convertir blob a base64 para mostrar la burbuja de audio del usuario
    const userAudioB64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1])
      }
      reader.readAsDataURL(audioBlob)
    })

    addMessage('user', '🎤', userAudioB64, true)

    try {
      const formData = new FormData()
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      formData.append('audio', audioBlob, `voice.${ext}`)
      if (sessionId) formData.append('session_id', sessionId)

      const res = await agentAPI.voiceChat(formData)
      const { session_id, message, audio_base64 } = res.data

      if (!sessionId) setSessionId(session_id)

      // Si el backend devuelve audio → burbuja de voz; si no → texto
      if (audio_base64) {
        addMessage('agent', message, audio_base64, true)
      } else {
        addMessage('agent', message)
      }

    } catch {
      addMessage('agent', 'No pude procesar tu mensaje de voz. Por favor intenta de nuevo o escribe tu consulta.')
    } finally {
      setTyping(false)
      setProcessingVoice(false)
    }
  }

  // ── Chat de texto ────────────────────────────────
  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg) return
    setInput('')
    addMessage('user', msg)
    setTyping(true)

    try {
      const res = await agentAPI.chat(msg, sessionId || undefined)
      const { session_id, message, action, available_professionals } = res.data

      if (!sessionId) setSessionId(session_id)
      addMessage('agent', message)  // texto plano — sin audio

      if (available_professionals && available_professionals.length > 0) {
        setAvailableProfessionals(available_professionals)
      }
    } catch {
      addMessage('agent', 'Disculpa, tuve un problema técnico. Por favor intenta de nuevo.')
    } finally {
      setTyping(false)
    }
  }

  async function selectProfessional(pro: Professional) {
    setCreatingConsultation(true)
    addMessage('user', `Quiero consultar con ${pro.first_name} ${pro.last_name}`)

    try {
      const res = await consultationsAPI.create({
        professional_id: pro.id,
        consultation_type: 'IMMEDIATE',
        specialty: pro.specialty,
      })
      addMessage('agent', `Perfecto. Tu solicitud fue enviada al Dr(a). ${pro.first_name} ${pro.last_name}. Tiene 2 minutos para aceptar. Te llevo a la sala de espera.`)
      setTimeout(() => {
        router.push(`/patient/waiting-room?consultationId=${res.data.id}`)
      }, 2000)
    } catch (err) {
      addMessage('agent', `Hubo un problema: ${getErrorMessage(err)}. Intenta de nuevo.`)
    } finally {
      setCreatingConsultation(false)
    }
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/agent" role="PATIENT">
      <div className="max-w-2xl">

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold">Agente de orientación médica</h1>
            <p className="text-xs text-[#6B738A]">
              Te guío para encontrar al especialista correcto ·{' '}
              <span className="text-[#A32D2D] font-medium">No emite diagnósticos</span>
            </p>
          </div>
        </div>

        <div className="border border-[#DDE1EE] rounded-xl overflow-hidden flex flex-col" style={{ height: '540px' }}>

          {/* Header */}
          <div className="px-4 py-3 bg-white border-b border-[#DDE1EE] flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-xs font-bold">IA</div>
            <div>
              <p className="text-sm font-semibold">Medi · Agente MedicBolivia</p>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#22C27A] animate-pulse" />
                <p className="text-xs text-[#22C27A]">En línea</p>
              </div>
            </div>
            <span className="ml-auto badge-red">No diagnostica</span>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 bg-[#F5F6FA] flex flex-col gap-3">
            {(messages as any[]).map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#185FA5] text-white rounded-br-sm'
                    : 'bg-white border border-[#DDE1EE] text-[#141820] rounded-bl-sm'
                }`}>
                  {/* Burbuja de voz */}
                  {msg.isVoice && msg.audioBase64 ? (
                    <AudioBubble audioBase64={msg.audioBase64} isUser={msg.role === 'user'} />
                  ) : (
                    msg.text
                  )}
                </div>
              </div>
            ))}

            {/* Typing / procesando voz */}
            {(isTyping || processingVoice) && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#DDE1EE] px-3.5 py-2.5 rounded-xl rounded-bl-sm flex gap-1 items-center">
                  {processingVoice && <span className="text-xs text-[#6B738A] mr-1">Procesando...</span>}
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {/* Profesionales */}
            {availableProfessionals.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-[#6B738A] font-medium">Profesionales disponibles ahora:</p>
                {availableProfessionals.map((pro: Professional) => (
                  <ProfessionalCard key={pro.id} pro={pro} onSelect={selectProfessional} />
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Respuestas rápidas */}
          {messages.length <= 1 && (
            <div className="px-3 py-2 bg-white border-t border-[#DDE1EE] flex flex-wrap gap-1.5">
              {QUICK_REPLIES.map((r) => (
                <button
                  key={r}
                  onClick={() => sendMessage(r)}
                  className="px-3 py-1.5 border border-[#185FA5] text-[#185FA5] rounded-full text-xs hover:bg-[#E6F1FB] transition-colors"
                >
                  {r}
                </button>
              ))}
            </div>
          )}

          {/* Input + micrófono */}
          <div className="px-3 py-2.5 bg-white border-t border-[#DDE1EE] flex gap-2 items-center">

            {/* Grabando — muestra indicador y botón soltar */}
            {isRecording ? (
              <>
                <div className="flex-1 flex items-center gap-3 bg-[#FCEBEB] border border-[#F09595] rounded-full px-4 py-2">
                  <div className="w-2 h-2 rounded-full bg-[#E24B4A] animate-pulse flex-shrink-0" />
                  <span className="text-xs text-[#A32D2D] font-medium flex-1">Grabando...</span>
                  <span className="text-xs text-[#A32D2D] font-mono">{recordingSeconds}s</span>
                </div>
                <button
                  onPointerUp={onMicPointerUp}
                  onClick={stopRecording}
                  className="w-10 h-10 rounded-full bg-[#E24B4A] text-white flex items-center justify-center flex-shrink-0 shadow-md"
                  title="Soltar para enviar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="3"/>
                  </svg>
                </button>
              </>
            ) : (
              <>
                {/* Input de texto */}
                <input
                  className="flex-1 px-3.5 py-2 border border-[#DDE1EE] rounded-full text-sm bg-[#F5F6FA] focus:outline-none focus:border-[#185FA5] text-[#141820] placeholder-[#A0A8BF]"
                  placeholder="Escribe o mantén 🎤 para grabar..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  disabled={isTyping || processingVoice || creatingConsultation}
                />

                {/* Botón enviar texto (si hay texto) o micrófono (si está vacío) */}
                {input.trim() ? (
                  <button
                    onClick={() => sendMessage()}
                    disabled={isTyping || processingVoice || creatingConsultation}
                    className="w-10 h-10 rounded-full bg-[#185FA5] text-white flex items-center justify-center hover:bg-[#0C447C] transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                ) : (
                  <button
                    onPointerDown={onMicPointerDown}
                    onPointerUp={onMicPointerUp}
                    onPointerLeave={onMicPointerUp}
                    disabled={isTyping || processingVoice || creatingConsultation}
                    className="w-10 h-10 rounded-full bg-[#185FA5] text-white flex items-center justify-center hover:bg-[#0C447C] active:bg-[#E24B4A] active:scale-110 transition-all disabled:opacity-50 flex-shrink-0 select-none"
                    title="Mantén presionado para grabar"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}