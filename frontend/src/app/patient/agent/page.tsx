'use client'
// src/app/patient/agent/page.tsx

import { useState, useRef, useEffect } from 'react'
import * as GeminiLive from './geminiLive'
import type { CallStatus } from './geminiLive'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PATIENT_NAV as NAV } from '@/lib/nav'
import { agentAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import { useAgentStore } from '@/lib/store'
import type { Professional } from '@/types'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { ProfessionalCard } from '@/components/patient/ProfessionalCard'

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

      <div className="flex-1 flex flex-col gap-1">
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
        <span className={`text-[10px] ${c.time}`}>
          {playing ? formatTime(currentTime) : formatTime(duration)}
        </span>
      </div>
    </div>
  )
}

function formatMsgTime(timestamp: Date | string) {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
}

export default function AgentPage() {
  const { t } = useLanguage()
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

  // ── Llamada Gemini Live (delegado a geminiLive.ts) ──
  const [callStatus, setCallStatus] = useState<CallStatus>(GeminiLive.getStatus())
  const [mediSpeaking, setMediSpeaking] = useState(false)

  useEffect(() => {
    if (messages.length === 0) {
      addMessage('agent', '¡Hola! Soy Medi, tu agente de orientación médica de MedicBolivia. Cuéntame, ¿cómo te sientes hoy? Puedes escribirme, enviarme un mensaje de voz 🎤 o hacer una llamada 📞')
    }
    // Sincronizar estado con el módulo al montar/remontar
    setCallStatus(GeminiLive.getStatus())
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Registrar callbacks en cada render para que siempre apunten a las funciones actuales
  useEffect(() => {
    GeminiLive.setCallbacks({
      onStatusChange: (s) => setCallStatus(s),
      onMessage: (text) => addMessage('agent', text),
      onAudio: () => {},
      onError: (msg) => addMessage('agent', msg),
      onMediSpeaking: (speaking) => setMediSpeaking(speaking),
      onSearchProfessionals: async (specialty) => {
        // Medi (Gemini Live) invocó la función buscar_profesionales — hacemos
        // la búsqueda real contra el backend (mismo mecanismo que usa el
        // chat de texto), separando quién está conectado ahora de quién solo
        // se puede agendar, y devolvemos eso para que Medi lo verbalice con
        // datos reales, no con lo que imagine.
        try {
          const res = await agentAPI.searchProfessionals(specialty)
          const { covered, count_online, count_offline, professionals, professionals_public } = res.data
          if (professionals_public && professionals_public.length > 0) {
            setAvailableProfessionals(professionals_public)
          }
          return { covered, count_online, count_offline, professionals }
        } catch {
          return { covered: false, count_online: 0, count_offline: 0, professionals: [] }
        }
      },
    })
  })  // sin deps — se actualiza en cada render

  function startCall() {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || ''
    GeminiLive.startCall(apiKey)
  }

  function endCall() {
    GeminiLive.endCall()
  }

  // ── Grabación: mantener presionado ───────────────
  function onMicPointerDown() {
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
      mediaRecorderRef.current.requestData()
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
    setRecordingSeconds(0)
  }

  async function sendVoiceMessage(audioBlob: Blob, mimeType: string) {
    setProcessingVoice(true)
    setTyping(true)

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
      const { session_id, message, available_professionals } = res.data

      if (!sessionId) setSessionId(session_id)
      addMessage('agent', message)

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
      addMessage('agent', `Perfecto. Tu solicitud fue enviada al Dr(a). ${pro.first_name} ${pro.last_name}. Tiene 5 minutos para aceptar. Te llevo a la sala de espera.`)
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
      <div className="-mx-4 -mt-4 -mb-4 sm:mx-0 sm:mt-0 sm:mb-0 sm:max-w-2xl flex flex-col h-[calc(100vh-52px)] sm:h-auto">

        <div className="hidden sm:flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold">{t('Agente de orientación médica')}</h1>
            <p className="text-xs text-[#6B738A]">
              Te guío para encontrar al especialista correcto ·{' '}
              <span className="text-[#A32D2D] font-medium">{t('No emite diagnósticos')}</span>
            </p>
          </div>
        </div>

        <div className="border-0 sm:border border-[#DDE1EE] rounded-none sm:rounded-xl overflow-hidden flex flex-col flex-1 sm:flex-none sm:h-[540px]">

          {/* Header */}
          <div className="px-4 py-3 bg-white border-b border-[#DDE1EE] flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-xs font-bold">IA</div>
            <div>
              <p className="text-sm font-semibold">{t('Medi · Agente MedicBolivia')}</p>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#22C27A] animate-pulse" />
                <p className="text-xs text-[#22C27A]">{t('En línea')}</p>
              </div>
            </div>

            {/* Botón de llamada Vapi */}
            <div className="ml-auto flex items-center gap-2">
              {callStatus === 'active' ? (
                <button
                  onClick={endCall}
                  className="flex items-center gap-1.5 px-3.5 py-2 sm:px-3 sm:py-1.5 bg-[#E24B4A] text-white rounded-full text-xs font-medium hover:bg-red-600 transition-colors animate-pulse"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                  </svg>
                  {t('Colgar')}
                </button>
              ) : callStatus === 'connecting' ? (
                <button disabled className="flex items-center gap-1.5 px-3.5 py-2 sm:px-3 sm:py-1.5 bg-[#185FA5] text-white rounded-full text-xs font-medium">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="animate-bounce">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                  </svg>
                  {t('Llamando...')}
                </button>
              ) : (
                <button
                  onClick={startCall}
                  className="flex items-center gap-1.5 px-3.5 py-2 sm:px-3 sm:py-1.5 bg-[#22C27A] text-white rounded-full text-xs font-medium hover:bg-green-600 transition-colors"
                  title="Hablar con Medi por llamada"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                  </svg>
                  {t('Llamar a Medi')}
                </button>
              )}
              <span className="badge-red">{t('No diagnostica')}</span>
            </div>
          </div>

          {/* Llamada activa — indicador visual */}
          {callStatus === 'connecting' && (
            <div className="px-4 py-2 bg-[#EEF4FF] border-b border-[#185FA5]/30 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#185FA5] animate-ping flex-shrink-0" />
              <span className="text-xs text-[#185FA5] font-medium">{t('Llamando a Medi… escucharás un tono')}</span>
            </div>
          )}
          {callStatus === 'active' && (
            <div className={`px-4 py-2 border-b flex items-center gap-2 transition-colors duration-300 ${mediSpeaking ? 'bg-[#EEF4FF] border-[#185FA5]/30' : 'bg-[#E8F8F0] border-[#22C27A]/30'}`}>
              {mediSpeaking ? (
                // Onda animada cuando Medi habla
                <span className="flex items-end gap-[2px] h-4">
                  {[0.4, 0.7, 1, 0.7, 0.4].map((h, i) => (
                    <span key={i} className="w-[3px] rounded-full bg-[#185FA5]"
                      style={{ height: `${h * 100}%`, animation: `pulse 0.8s ease-in-out ${i * 0.12}s infinite alternate` }} />
                  ))}
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-[#22C27A] animate-pulse flex-shrink-0" />
              )}
              <span className={`text-xs font-medium ${mediSpeaking ? 'text-[#185FA5]' : 'text-[#15803d]'}`}>
                {mediSpeaking ? 'Medi está hablando…' : 'Medi te escucha — habla ahora'}
              </span>
            </div>
          )}

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-4 bg-[#F5F6FA] flex flex-col gap-3">
            {(messages as any[]).map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[75%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#185FA5] text-white rounded-br-sm'
                    : 'bg-white border border-[#DDE1EE] text-[#141820] rounded-bl-sm'
                }`}>
                  {msg.isVoice && msg.audioBase64 ? (
                    <AudioBubble audioBase64={msg.audioBase64} isUser={msg.role === 'user'} />
                  ) : (
                    msg.text
                  )}
                  {msg.timestamp && (
                    <p className={`text-[10px] mt-1 text-right ${
                      msg.role === 'user' ? 'text-white/60' : 'text-[#A0A8BF]'
                    }`}>
                      {formatMsgTime(msg.timestamp)}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {(isTyping || processingVoice) && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#DDE1EE] px-3.5 py-2.5 rounded-xl rounded-bl-sm flex gap-1 items-center">
                  {processingVoice && <span className="text-xs text-[#6B738A] mr-1">{t('Procesando...')}</span>}
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {availableProfessionals.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-[#6B738A] font-medium">{t('Profesionales encontrados:')}</p>
                {availableProfessionals.map((pro: Professional) => (
                  <ProfessionalCard
                    key={pro.id}
                    professional={pro}
                    onConsult={selectProfessional}
                    loading={creatingConsultation}
                  />
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

            {isRecording ? (
              <>
                <div className="flex-1 flex items-center gap-3 bg-[#FCEBEB] border border-[#F09595] rounded-full px-4 py-2">
                  <div className="w-2 h-2 rounded-full bg-[#E24B4A] animate-pulse flex-shrink-0" />
                  <span className="text-xs text-[#A32D2D] font-medium flex-1">{t('Grabando...')}</span>
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
                <input
                  className="flex-1 px-3.5 py-2 border border-[#DDE1EE] rounded-full text-sm bg-[#F5F6FA] focus:outline-none focus:border-[#185FA5] text-[#141820] placeholder-[#A0A8BF]"
                  placeholder={t('Escribe o mantén 🎤 para grabar...')}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  disabled={isTyping || processingVoice || creatingConsultation || callStatus === 'active'}
                />

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
                    disabled={isTyping || processingVoice || creatingConsultation || callStatus === 'active'}
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