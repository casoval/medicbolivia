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
import { ProfessionalsBlock } from '@/components/patient/ProfessionalsBlock'
import { professionalFullName } from '@/lib/professionalTitle'
import { useHoldToRecord } from './useHoldToRecord'

const QUICK_REPLIES = [
  'Tengo dolor de cabeza',
  'Dolor en el pecho',
  'Me siento ansioso/a',
  'Mi hijo está enfermo',
  'Necesito control de peso',
  'Dolor en la espalda',
]

// ── Reproductor de audio estilo WhatsApp ─────────────
function AudioBubble({ audioBase64, isUser, mime }: { audioBase64: string; isUser: boolean; mime?: string }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = new Audio(`data:${mime || `audio/${isUser ? 'webm' : 'mp3'}`};base64,${audioBase64}`)
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
  }, [audioBase64, mime])

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
    time: 'text-[#475569]',
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

function formatRecTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const sec = totalSeconds % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function AgentPage() {
  const { t } = useLanguage()
  const router = useRouter()
  const {
    sessionId, messages, isTyping,
    setSessionId, addMessage, setTyping
  } = useAgentStore()

  const [input, setInput] = useState('')
  const [creatingConsultation, setCreatingConsultation] = useState(false)
  // Scroll del chat: contenedor + el último mensaje (para ir a su inicio, no al fondo)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastMsgRef = useRef<HTMLDivElement>(null)

  const [processingVoice, setProcessingVoice] = useState(false)

  // ── Llamada Gemini Live (delegado a geminiLive.ts) ──
  const [callStatus, setCallStatus] = useState<CallStatus>(GeminiLive.getStatus())
  const [mediSpeaking, setMediSpeaking] = useState(false)

  // ── Grabación de voz: mantener presionado, estilo WhatsApp ──
  const canRecord = !(isTyping || processingVoice || creatingConsultation || callStatus === 'active')
  const {
    isRecording, seconds: recordingSeconds, willCancel, hint: voiceHint, bind: micBind,
  } = useHoldToRecord((blob, mimeType) => sendVoiceMessage(blob, mimeType), canRecord)

  useEffect(() => {
    if (messages.length === 0) {
      addMessage('agent', '¡Hola! Soy Medi, tu agente de orientación médica de MedicBolivia. Cuéntame, ¿cómo te sientes hoy? Puedes escribirme, enviarme un mensaje de voz 🎤 o hacer una llamada 📞')
    }
    // Sincronizar estado con el módulo al montar/remontar
    setCallStatus(GeminiLive.getStatus())

    // Si el paciente navega a otra página (otra pestaña del menú, cerrar
    // pestaña, etc.) mientras está en llamada, cortarla acá — sin esto el
    // WebSocket, el micrófono y el AudioContext quedaban abiertos en segundo
    // plano indefinidamente (el estado vive en window.__gLiveWs justamente
    // para sobrevivir a remontajes de Fast Refresh, pero eso significa que
    // nada lo corta solo al salir de la página de verdad).
    return () => {
      if (GeminiLive.getStatus() !== 'idle') GeminiLive.endCall()
    }
  }, [])

  // Scroll del chat. Antes se bajaba siempre al fondo, y las tarjetas de profesionales
  // (que estaban en un bloque aparte, al final) empujaban el mensaje nuevo fuera de la
  // pantalla: había que subir para leerlo. Ahora, si la respuesta trae profesionales,
  // se va al INICIO de esa respuesta (el texto arriba y las tarjetas debajo); en los
  // demás casos se baja al fondo, como siempre.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const last = (messages as any[])[messages.length - 1]
    const showingResults =
      !isTyping && !processingVoice && last?.role === 'agent' && last?.professionals?.length > 0
    if (showingResults && lastMsgRef.current) {
      container.scrollTo({ top: Math.max(lastMsgRef.current.offsetTop - 8, 0), behavior: 'smooth' })
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isTyping, processingVoice])

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
          setTyping(true)
          const res = await agentAPI.searchProfessionals(specialty)
          const { covered, count_online, count_offline, professionals, professionals_public } = res.data
          if (professionals_public && professionals_public.length > 0) {
            addMessage('agent', 'Estos son los profesionales que encontré para ti:', undefined, false, {
              professionals: professionals_public,
            })
          }
          return { covered, count_online, count_offline, professionals }
        } catch {
          return { covered: false, count_online: 0, count_offline: 0, professionals: [] }
        } finally {
          setTyping(false)
        }
      },
    })
  })  // sin deps — se actualiza en cada render

  async function startCall() {
    try {
      const res = await agentAPI.getLiveToken()
      await GeminiLive.startCall(res.data.token)
    } catch (err) {
      addMessage('agent', 'No se pudo iniciar la llamada de voz. Intenta de nuevo en un momento.')
    }
  }

  function endCall() {
    GeminiLive.endCall()
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

    addMessage('user', '🎤', userAudioB64, true, { audioMime: mimeType })

    try {
      const formData = new FormData()
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      formData.append('audio', audioBlob, `voice.${ext}`)
      if (sessionId) formData.append('session_id', sessionId)

      const res = await agentAPI.voiceChat(formData)
      const { session_id, message, audio_base64, available_professionals } = res.data

      if (!sessionId) setSessionId(session_id)

      const found = available_professionals && available_professionals.length > 0
        ? { professionals: available_professionals }
        : undefined
      if (audio_base64) {
        addMessage('agent', message, audio_base64, true, found)
      } else {
        addMessage('agent', message, undefined, false, found)
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
      addMessage(
        'agent', message, undefined, false,
        available_professionals && available_professionals.length > 0
          ? { professionals: available_professionals }
          : undefined,
      )
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
      addMessage('agent', `Perfecto. Tu solicitud fue enviada al ${professionalFullName(pro.first_name, pro.last_name, pro.gender)}. Tiene 5 minutos para aceptar. Te llevo a la sala de espera.`)
      setTimeout(() => {
        router.push(`/patient/waiting-room?consultationId=${res.data.id}`)
      }, 2000)
    } catch (err) {
      addMessage('agent', `Hubo un problema: ${getErrorMessage(err)}. Intenta de nuevo.`)
    } finally {
      setCreatingConsultation(false)
    }
  }

  // Solo la última búsqueda se muestra desplegada; las anteriores quedan plegadas.
  const lastProsIndex = (() => {
    for (let i = (messages as any[]).length - 1; i >= 0; i--) {
      if ((messages as any[])[i]?.professionals?.length > 0) return i
    }
    return -1
  })()

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/agent" role="PATIENT">
      <div className="-mx-4 -mt-4 -mb-4 sm:mx-0 sm:mt-0 sm:mb-0 sm:max-w-2xl flex flex-col h-[calc(100vh-52px)] sm:h-auto">

        <div className="hidden sm:flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold">{t('Agente de orientación médica')}</h1>
            <p className="text-xs text-[#475569]">
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

            {/* Botón de llamada (Gemini Live) */}
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
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto p-4 bg-[#F5F6FA] flex flex-col gap-3">
            {(messages as any[]).map((msg, i) => (
              <div
                key={i}
                ref={i === messages.length - 1 ? lastMsgRef : undefined}
                className="flex flex-col gap-2"
              >
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] sm:max-w-[75%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#185FA5] text-white rounded-br-sm'
                      : 'bg-white border border-[#DDE1EE] text-[#141820] rounded-bl-sm'
                  }`}>
                    {msg.isVoice && msg.audioBase64 ? (
                      <AudioBubble audioBase64={msg.audioBase64} isUser={msg.role === 'user'} mime={msg.audioMime} />
                    ) : (
                      msg.text
                    )}
                    {msg.timestamp && (
                      <p className={`text-[10px] mt-1 text-right ${
                        msg.role === 'user' ? 'text-white/60' : 'text-[#64748B]'
                      }`}>
                        {formatMsgTime(msg.timestamp)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Profesionales encontrados en ESTA respuesta, pegados a ella */}
                {msg.professionals?.length > 0 && (
                  <ProfessionalsBlock
                    pros={msg.professionals}
                    onConsult={selectProfessional}
                    loading={creatingConsultation}
                    stale={i !== lastProsIndex}
                  />
                )}
              </div>
            ))}

            {(isTyping || processingVoice) && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#DDE1EE] px-3.5 py-2.5 rounded-xl rounded-bl-sm flex gap-1 items-center">
                  {processingVoice && <span className="text-xs text-[#475569] mr-1">{t('Procesando...')}</span>}
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

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

          {/* Input + micrófono (mantener presionado para grabar, como en WhatsApp) */}
          <div className="relative px-3 py-2.5 bg-white border-t border-[#DDE1EE] flex gap-2 items-center">

            {voiceHint && (
              <div className="absolute bottom-full left-3 right-3 mb-1.5 px-3 py-1.5 rounded-lg bg-[#141820] text-white text-xs text-center shadow-md">
                {voiceHint}
              </div>
            )}

            {isRecording ? (
              <div className={`flex-1 flex items-center gap-3 rounded-full px-4 py-2 border transition-colors ${
                willCancel ? 'bg-[#F1F2F6] border-[#C9CEDD]' : 'bg-[#FCEBEB] border-[#F09595]'
              }`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  willCancel ? 'bg-[#94A3B8]' : 'bg-[#E24B4A] animate-pulse'
                }`} />
                <span className={`text-xs font-mono ${willCancel ? 'text-[#64748B]' : 'text-[#A32D2D]'}`}>
                  {formatRecTime(recordingSeconds)}
                </span>
                <span className={`text-xs font-medium flex-1 text-right ${willCancel ? 'text-[#64748B]' : 'text-[#A32D2D]'}`}>
                  {willCancel ? t('Suelta para cancelar') : `← ${t('Desliza para cancelar')}`}
                </span>
              </div>
            ) : (
              <input
                className="flex-1 px-3.5 py-2 border border-[#DDE1EE] rounded-full text-sm bg-[#F5F6FA] focus:outline-none focus:border-[#185FA5] text-[#141820] placeholder-[#64748B]"
                placeholder={t('Escribe o mantén 🎤 para grabar...')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                disabled={isTyping || processingVoice || creatingConsultation || callStatus === 'active'}
              />
            )}

            {input.trim() && !isRecording ? (
              <button
                key="send"
                onClick={() => sendMessage()}
                disabled={isTyping || processingVoice || creatingConsultation}
                className="w-10 h-10 rounded-full bg-[#185FA5] text-white flex items-center justify-center hover:bg-[#0C447C] transition-colors disabled:opacity-50 flex-shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            ) : (
              // Este botón NO se desmonta mientras se graba (key fija): así el navegador
              // sigue entregándole el "soltar", que es lo que envía el audio.
              <button
                key="mic"
                {...micBind}
                disabled={!canRecord && !isRecording}
                aria-label={t('Mantén presionado para grabar')}
                title={t('Mantén presionado para grabar')}
                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                className={`w-10 h-10 rounded-full text-white flex items-center justify-center flex-shrink-0 select-none touch-none transition-all disabled:opacity-50 ${
                  isRecording
                    ? willCancel
                      ? 'bg-[#94A3B8] scale-125'
                      : 'bg-[#E24B4A] scale-125 shadow-lg'
                    : 'bg-[#185FA5] hover:bg-[#0C447C]'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}