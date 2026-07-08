'use client'
// src/app/patient/video/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Room,
  RoomEvent,
  Track,
  createLocalTracks,
  LocalVideoTrack,
  RemoteTrack,
  VideoPresets,
} from 'livekit-client'
import { consultationsAPI, ratingsAPI } from '@/lib/api'

interface ChatMsg { from: 'me' | 'them'; text: string; time: string }

// ── StarPicker inline (no depende de /ui para evitar imports en video) ──
function StarPickerInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-2 justify-center">
      {[1,2,3,4,5].map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="text-3xl transition-transform hover:scale-110"
        >
          {n <= (hover || value) ? '⭐' : '☆'}
        </button>
      ))}
    </div>
  )
}

export default function PatientVideoPage() {
  const params = useSearchParams()
  const cid = params.get('cid') ?? ''

  const roomRef        = useRef<Room | null>(null)
  const localVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const chatEndRef     = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  const connectingRef  = useRef(false)
  const hideTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [status, setStatus]             = useState<'loading' | 'connecting' | 'connected' | 'doctor_joined' | 'ended' | 'error'>('loading')
  const [error, setError]               = useState('')
  const [micMuted, setMicMuted]         = useState(false)
  const [camOff, setCamOff]             = useState(false)
  const [duration, setDuration]         = useState(0)
  const [chatOpen, setChatOpen]         = useState(false)
  const [messages, setMessages]         = useState<ChatMsg[]>([])
  const [unread, setUnread]             = useState(0)
  const [inputText, setInputText]       = useState('')
  const [controlsVisible, setControlsVisible] = useState(true)

  // Post-consulta: modal de calificación
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [ratingScore, setRatingScore]         = useState(5)
  const [ratingComment, setRatingComment]     = useState('')
  const [ratingDone, setRatingDone]           = useState(false)
  const [ratingLoading, setRatingLoading]     = useState(false)
  const [ratingError, setRatingError]         = useState('')

  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!chatOpen) setControlsVisible(false)
    }, 3500)
  }, [chatOpen])

  useEffect(() => {
    if (chatOpen) {
      setControlsVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    } else {
      showControls()
    }
  }, [chatOpen])

  useEffect(() => {
    showControls()
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [])

  useEffect(() => {
    if (status !== 'connecting' && status !== 'connected' && status !== 'doctor_joined') return
    const id = setInterval(() => setDuration(d => d + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!cid) { setError('No se encontró el ID de la consulta.'); setStatus('error'); return }
    if (connectingRef.current) return
    connectingRef.current = true
    setStatus('loading')

    consultationsAPI.getVideoToken(cid)
      .then(({ token, livekit_url }) => {
        setStatus('connecting')
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
          publishDefaults: {
            simulcast: true,
            videoCodec: 'vp8',
            videoEncoding: VideoPresets.h720.encoding,
            red: true,
          },
        })
        roomRef.current = room

        room.on(RoomEvent.ParticipantConnected, () => setStatus('doctor_joined'))
        room.on(RoomEvent.ParticipantDisconnected, () => setStatus('connected'))
        room.on(RoomEvent.Disconnected, () => {
          setStatus('ended')
          // Mostrar modal de calificación al terminar
          setTimeout(() => setShowRatingModal(true), 800)
        })
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) track.attach(remoteVideoRef.current)
          if (track.kind === Track.Kind.Audio && remoteAudioRef.current) track.attach(remoteAudioRef.current)
        })
        room.on(RoomEvent.DataReceived, (data: Uint8Array) => {
          const text = new TextDecoder().decode(data)
          const now = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
          setMessages(m => [...m, { from: 'them', text, time: now }])
          setUnread(u => u + 1)
        })

        return room.connect(livekit_url, token)
          .then(() => {
            if (room.remoteParticipants.size > 0) {
              setStatus('doctor_joined')
              room.remoteParticipants.forEach(participant => {
                participant.trackPublications.forEach(pub => {
                  if (pub.track) {
                    if (pub.track.kind === Track.Kind.Video && remoteVideoRef.current) pub.track.attach(remoteVideoRef.current)
                    if (pub.track.kind === Track.Kind.Audio && remoteAudioRef.current) pub.track.attach(remoteAudioRef.current)
                  }
                })
              })
            } else {
              setStatus('connected')
            }
            createLocalTracks({
              audio: true,
              video: { resolution: VideoPresets.h720.resolution },
            })
              .catch(() => createLocalTracks({ audio: true, video: false }))
              .then(async tracks => {
                for (const track of tracks) {
                  await room.localParticipant.publishTrack(
                    track,
                    track.kind === Track.Kind.Video
                      ? { simulcast: true, videoCodec: 'vp8', videoEncoding: VideoPresets.h720.encoding }
                      : undefined
                  )
                  if (track.kind === Track.Kind.Video && localVideoRef.current) {
                    ;(track as LocalVideoTrack).attach(localVideoRef.current)
                  }
                }
              })
              .catch(e => console.error('Error tracks:', e))
          })
      })
      .catch(e => {
        console.error('Error al conectar:', e)
        setError('No se pudo conectar. Verifica tu conexión e intenta de nuevo.')
        setStatus('error')
      })

    return () => {
      roomRef.current?.disconnect()
      roomRef.current = null
    }
  }, [cid])

  async function sendMessage() {
    const text = inputText.trim()
    if (!text || !roomRef.current) return
    const data = new TextEncoder().encode(text)
    await roomRef.current.localParticipant.publishData(data, { reliable: true })
    const now = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
    setMessages(m => [...m, { from: 'me', text, time: now }])
    setInputText('')
    inputRef.current?.focus()
  }

  function openChat() { setChatOpen(true); setUnread(0) }

  async function toggleMic() {
    const room = roomRef.current; if (!room) return
    const enabled = room.localParticipant.isMicrophoneEnabled
    await room.localParticipant.setMicrophoneEnabled(!enabled)
    setMicMuted(enabled)
  }

  async function toggleCam() {
    const room = roomRef.current; if (!room) return
    const enabled = room.localParticipant.isCameraEnabled
    await room.localParticipant.setCameraEnabled(!enabled)
    setCamOff(enabled)
  }

  function leaveCall() {
    roomRef.current?.disconnect()
    // Disconnect dispara RoomEvent.Disconnected → setStatus('ended') → modal
  }

  async function submitRating() {
    if (!cid || ratingScore === 0) return
    setRatingLoading(true)
    setRatingError('')
    try {
      // Reintentar hasta 5 veces con 2s de espera: la consulta puede tardar
      // unos segundos en marcarse COMPLETED en el backend tras el disconnect
      let lastError: unknown
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await ratingsAPI.create(cid, ratingScore, ratingComment)
          setRatingDone(true)
          return
        } catch (e: any) {
          lastError = e
          const msg: string = e?.response?.data?.detail ?? e?.message ?? ''
          // Si ya fue calificada, igual consideramos éxito
          if (msg.includes('Ya calificaste')) { setRatingDone(true); return }
          // Si no está completada aún, esperar y reintentar
          if (msg.includes('no está completada') || msg.includes('not found')) {
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          // Otro error — salir del loop
          break
        }
      }
      // Mostrar error real en vez de silenciarlo
      const errMsg: string =
        (lastError as any)?.response?.data?.detail ??
        (lastError as any)?.message ??
        'No se pudo guardar la calificación.'
      console.error('Error al calificar:', lastError)
      setRatingError(errMsg)
    } finally {
      setRatingLoading(false)
    }
  }

  function skipRating() {
    setShowRatingModal(false)
    window.location.href = '/patient/dashboard'
  }

  function goToDashboard() {
    window.location.href = '/patient/dashboard'
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Pantalla de carga ──
  if (status === 'loading') return (
    <div className="fixed inset-0 bg-[#0D1117] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-white text-sm">Conectando con el médico...</p>
      </div>
    </div>
  )

  // ── Pantalla de error ──
  if (status === 'error') return (
    <div className="fixed inset-0 bg-[#0D1117] flex flex-col items-center justify-center gap-4 text-white px-6">
      <span className="text-5xl">⚠️</span>
      <p className="text-sm text-center max-w-xs text-[#A0A8BF]">{error}</p>
      <button onClick={() => { connectingRef.current = false; window.location.reload() }} className="px-5 py-2.5 bg-[#185FA5] text-white text-sm rounded-xl font-medium">
        Reintentar
      </button>
      <button onClick={() => window.location.href = '/patient/dashboard'} className="px-5 py-2.5 bg-white/10 text-white/70 text-sm rounded-xl hover:bg-white/20">
        Volver al inicio
      </button>
    </div>
  )

  // ── Pantalla post-consulta ──
  if (status === 'ended') return (
    <div className="fixed inset-0 bg-[#0D1117] flex flex-col items-center justify-center px-6">

      {/* Fondo con éxito */}
      {!showRatingModal && (
        <div className="text-center text-white animate-fade-up">
          <div className="text-6xl mb-4">✅</div>
          <p className="font-semibold text-lg">Consulta finalizada</p>
          <p className="text-white/50 text-sm mt-1">Gracias por usar MedicBolivia</p>
          <button onClick={goToDashboard} className="mt-6 px-5 py-2.5 bg-[#185FA5] text-white text-sm rounded-xl font-medium">
            Volver al inicio
          </button>
        </div>
      )}

      {/* Modal de calificación */}
      {showRatingModal && !ratingDone && (
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-up">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">⭐</div>
            <h3 className="text-base font-semibold">¿Cómo fue tu consulta?</h3>
            <p className="text-xs text-[#6B738A] mt-1">Tu opinión ayuda a otros pacientes</p>
          </div>

          <div className="mb-4">
            <StarPickerInline value={ratingScore} onChange={setRatingScore} />
            <p className="text-center text-xs text-[#6B738A] mt-2">
              {ratingScore === 1 && 'Muy mala'}
              {ratingScore === 2 && 'Mala'}
              {ratingScore === 3 && 'Regular'}
              {ratingScore === 4 && 'Buena'}
              {ratingScore === 5 && 'Excelente'}
            </p>
          </div>

          <div className="mb-4">
            <textarea
              className="w-full border border-[#DDE1EE] rounded-xl px-3 py-2 text-sm resize-none outline-none focus:border-[#185FA5] text-[#1C2133] placeholder:text-[#A0A8BF]"
              rows={3}
              placeholder="Cuéntanos cómo estuvo la atención... (opcional)"
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              maxLength={500}
            />
          </div>

          {/* Error visible si falla el envío */}
          {ratingError && (
            <div className="mb-3 bg-[#FCEBEB] border border-[#F09595] rounded-xl px-3 py-2">
              <p className="text-xs text-[#A32D2D]">⚠️ {ratingError}</p>
              <p className="text-xs text-[#A32D2D] mt-0.5">Podrás calificar desde "Mis consultas".</p>
            </div>
          )}

          <button
            onClick={submitRating}
            disabled={ratingLoading}
            className="w-full py-2.5 bg-[#185FA5] text-white text-sm rounded-xl font-medium hover:bg-[#0C447C] transition-colors disabled:opacity-60 mb-2"
          >
            {ratingLoading ? 'Enviando...' : 'Enviar calificación'}
          </button>
          <button
            onClick={skipRating}
            className="w-full py-2 text-sm text-[#6B738A] hover:text-[#1C2133] transition-colors"
          >
            Calificar luego
          </button>
        </div>
      )}

      {/* Confirmación de calificación enviada */}
      {showRatingModal && ratingDone && (
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center animate-fade-up">
          <div className="text-5xl mb-3">🎉</div>
          <h3 className="text-base font-semibold">¡Gracias por tu calificación!</h3>
          <p className="text-xs text-[#6B738A] mt-1 mb-5">Tu opinión ayuda a mejorar el servicio</p>
          <button onClick={goToDashboard} className="w-full py-2.5 bg-[#185FA5] text-white text-sm rounded-xl font-medium">
            Volver al inicio
          </button>
          <a href="/patient/history" className="block mt-2 text-xs text-[#185FA5] hover:underline">
            Ver mis consultas
          </a>
        </div>
      )}
    </div>
  )

  // ── Pantalla principal de video ──
  return (
    <div
      className="fixed inset-0 bg-black flex"
      onMouseMove={showControls}
      onTouchStart={showControls}
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      <div className="flex-1 relative">
        <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
        <audio ref={remoteAudioRef} autoPlay />

        {status !== 'doctor_joined' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0D1117]">
            <div className="w-20 h-20 rounded-full bg-[#185FA5]/20 border-2 border-[#185FA5] flex items-center justify-center text-4xl animate-pulse">👨‍⚕️</div>
            <p className="text-white text-sm font-medium">
              {status === 'connecting' ? 'Conectando...' : 'Esperando al médico...'}
            </p>
            <p className="text-[#6B738A] text-xs">La consulta comenzará en breve</p>
          </div>
        )}

        {/* Timer */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-xs px-4 py-1.5 rounded-full font-mono z-10 pointer-events-none">
          {status === 'connecting' ? '⏳ Conectando' : `🔴 ${fmt(duration)}`}
        </div>

        {/* Miniatura local */}
        <div className="absolute bottom-28 right-4 w-32 h-24 rounded-xl overflow-hidden border-2 border-white/30 shadow-xl bg-black z-10">
          <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${camOff ? 'opacity-0' : ''}`} />
          {camOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]">
              <span className="text-2xl">👤</span>
            </div>
          )}
          <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1 rounded">Tú</div>
        </div>

        {/* Controles superpuestos */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)' }}
        >
          <div className="flex items-end justify-center gap-6 px-6 pb-6 pt-10">

            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleMic} className={`w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl transition-all ${micMuted ? 'bg-[#E24B4A] scale-95' : 'bg-white/20 hover:bg-white/30 backdrop-blur-sm'} text-white shadow-lg`}>
                {micMuted ? '🔇' : '🎤'}
              </button>
              <span className="text-white/70 text-[11px] font-medium">{micMuted ? 'Sin audio' : 'Micrófono'}</span>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <button onClick={toggleCam} className={`w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl transition-all ${camOff ? 'bg-[#E24B4A] scale-95' : 'bg-white/20 hover:bg-white/30 backdrop-blur-sm'} text-white shadow-lg`}>
                {camOff ? '🚫' : '📷'}
              </button>
              <span className="text-white/70 text-[11px] font-medium">{camOff ? 'Cámara off' : 'Cámara'}</span>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <button onClick={leaveCall} className="w-[60px] h-[60px] rounded-full bg-[#E24B4A] hover:bg-[#c93a39] text-white text-2xl flex items-center justify-center transition-all shadow-xl hover:scale-105">
                📵
              </button>
              <span className="text-white/70 text-[11px] font-medium">Salir</span>
            </div>

            <div className="flex flex-col items-center gap-1.5">
              <button onClick={openChat} className="relative w-[52px] h-[52px] rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white flex items-center justify-center text-xl transition-all shadow-lg">
                💬
                {unread > 0 && !chatOpen && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#E24B4A] rounded-full text-xs flex items-center justify-center font-bold">{unread}</span>
                )}
              </button>
              <span className="text-white/70 text-[11px] font-medium">Chat</span>
            </div>

          </div>
        </div>
      </div>

      {/* Panel chat */}
      {chatOpen && (
        <div className="w-72 bg-[#161B22] border-l border-white/10 flex flex-col flex-shrink-0 z-30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <p className="text-white text-sm font-semibold">Chat con el médico</p>
            <button onClick={() => setChatOpen(false)} className="text-white/50 hover:text-white text-lg leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-white/30 text-xs text-center mt-6">Los mensajes solo duran durante esta llamada</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.from === 'me' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm break-words ${m.from === 'me' ? 'bg-[#185FA5] text-white rounded-br-sm' : 'bg-white/10 text-white rounded-bl-sm'}`}>
                  {m.text}
                </div>
                <span className="text-white/30 text-xs mt-0.5 px-1">{m.time}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-3 border-t border-white/10 flex gap-2">
            <input
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Escribe un mensaje..."
              className="flex-1 bg-white/10 text-white text-sm px-3 py-2 rounded-xl outline-none placeholder:text-white/30 focus:bg-white/15"
            />
            <button onClick={sendMessage} disabled={!inputText.trim()} className="w-9 h-9 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-40 text-white rounded-xl flex items-center justify-center text-sm transition-colors">
              ➤
            </button>
          </div>
        </div>
      )}
    </div>
  )
}