'use client'
// src/app/professional/video/page.tsx

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
  ConnectionQuality,
} from 'livekit-client'
import { consultationsAPI, prescriptionsAPI, clinicalNotesAPI, getErrorMessage } from '@/lib/api'
import type { Medication } from '@/types'
import { useLanguage } from '@/lib/i18n/LanguageContext'

interface ChatMsg { from: 'me' | 'them'; text: string; time: string }

const EMPTY_MED: Medication = { name: '', presentation: '', dosage: '', frequency: '', duration: '', notes: '' }

// ── Ícono de señal — refleja ConnectionQuality de LiveKit ────────────
// Se usa tanto en la pantalla del profesional como en la del paciente.
function SignalIcon({ quality }: { quality: ConnectionQuality | null }) {
  const level =
    quality === ConnectionQuality.Excellent ? 3 :
    quality === ConnectionQuality.Good ? 2 :
    quality === ConnectionQuality.Poor ? 1 :
    quality === ConnectionQuality.Lost ? 0 :
    -1 // desconocida todavía (recién conectando)

  const color =
    level === 3 ? '#3FCE9E' :
    level === 2 ? '#F5C563' :
    level >= 0 ? '#F09595' :
    'rgba(255,255,255,0.3)'

  const label =
    level === 3 ? 'Conexión excelente' :
    level === 2 ? 'Conexión regular' :
    level === 1 ? 'Conexión débil' :
    level === 0 ? 'Sin conexión' :
    'Midiendo conexión...'

  return (
    <span className="flex items-end gap-[1.5px] h-3" title={label} aria-label={label}>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-[3px] rounded-sm"
          style={{
            height: `${4 + bar * 3}px`,
            backgroundColor: level > bar || (level === -1 && bar === 0) ? color : 'rgba(255,255,255,0.2)',
          }}
        />
      ))}
    </span>
  )
}

// ── Panel lateral: emitir receta SIN salir de la videollamada ──────────
// Mientras el médico escribe, se guarda un borrador SOLO en este
// navegador (localStorage) — nunca al servidor, así que nunca crea un
// documento firmado a medias. Es solo para no perder lo escrito si se
// cierra la pestaña o se corta la conexión antes de llegar a "Emitir y
// firmar". El botón de firmar sigue siendo la única acción que de verdad
// emite la receta.
function draftKey(consultationId: string) {
  return `mb_rx_draft_${consultationId}`
}

function PrescriptionPanel({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const { t } = useLanguage()
  const [medications, setMedications] = useState<Medication[]>([{ ...EMPTY_MED }])
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  const draftLoadedRef = useRef(false)

  // Al abrir el panel, si había un borrador de ESTA consulta guardado
  // localmente (por ej. se cerró la pestaña sin firmar), lo recuperamos.
  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    try {
      const raw = window.localStorage.getItem(draftKey(consultationId))
      if (raw) {
        const draft = JSON.parse(raw)
        const hasContent = draft.medications?.some((m: Medication) => m.name || m.dosage || m.frequency) || draft.instructions
        if (hasContent) {
          setMedications(draft.medications?.length ? draft.medications : [{ ...EMPTY_MED }])
          setInstructions(draft.instructions || '')
          setDraftRestored(true)
        }
      }
    } catch {
      // localStorage no disponible o dato corrupto — seguimos sin borrador, no es crítico.
    }
  }, [consultationId])

  // Guarda el borrador local automáticamente en cada cambio (silencioso,
  // sin botón — es solo una copia de este dispositivo, no tiene el riesgo
  // de "enviar algo a medias" porque nunca sale del navegador).
  useEffect(() => {
    const hasContent = medications.some(m => m.name || m.dosage || m.frequency) || instructions
    try {
      if (hasContent) {
        window.localStorage.setItem(draftKey(consultationId), JSON.stringify({ medications, instructions }))
      } else {
        window.localStorage.removeItem(draftKey(consultationId))
      }
    } catch {
      // Si localStorage falla (modo incógnito con storage bloqueado, etc.)
      // simplemente no hay borrador local — no afecta poder emitir la receta.
    }
  }, [consultationId, medications, instructions])

  function addMed() { setMedications(p => [...p, { ...EMPTY_MED }]) }
  function removeMed(i: number) { setMedications(p => p.filter((_, idx) => idx !== i)) }
  function updateMed(i: number, field: keyof Medication, value: string) {
    setMedications(p => p.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
    setDraftRestored(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (medications.some(m => !m.name || !m.dosage || !m.frequency)) {
      setError('Completa nombre, dosis y frecuencia de todos los medicamentos')
      return
    }
    setSaving(true)
    try {
      await prescriptionsAPI.create({ consultation_id: consultationId, medications, instructions })
      setSuccess('Receta emitida y firmada. El paciente ya puede verla.')
      setMedications([{ ...EMPTY_MED }])
      setInstructions('')
      // Ya quedó firmada en el servidor — el borrador local ya no sirve.
      try { window.localStorage.removeItem(draftKey(consultationId)) } catch {}
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-80 bg-[#161B22] border-l border-white/10 flex flex-col flex-shrink-0 z-30 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-[#161B22]">
        <p className="text-white text-sm font-semibold">{t('💊 Receta digital')}</p>
        <button onClick={onClose} className="text-white/50 hover:text-white text-lg leading-none">✕</button>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        {success && <p className="text-xs bg-[#0F6E56]/20 text-[#3FCE9E] rounded-lg px-3 py-2">{success}</p>}
        {error && <p className="text-xs bg-[#A32D2D]/20 text-[#F09595] rounded-lg px-3 py-2">{error}</p>}
        {draftRestored && !success && (
          <p className="text-xs bg-[#185FA5]/20 text-[#7CB4E8] rounded-lg px-3 py-2">
            {t('📝 Recuperamos un borrador que habías dejado a medias en este dispositivo.')}
          </p>
        )}

        {medications.map((med, i) => (
          <div key={i} className="bg-white/5 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/50">Medicamento {i + 1}</p>
              {medications.length > 1 && (
                <button type="button" onClick={() => removeMed(i)} className="text-[11px] text-[#F09595] hover:underline">
                  {t('Eliminar')}
                </button>
              )}
            </div>
            <input
              className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
              placeholder={t('Nombre (ej: Amoxicilina 500mg)')}
              value={med.name}
              onChange={e => updateMed(i, 'name', e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
                placeholder={t('Dosis')}
                value={med.dosage}
                onChange={e => updateMed(i, 'dosage', e.target.value)}
              />
              <input
                className="bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
                placeholder={t('Frecuencia')}
                value={med.frequency}
                onChange={e => updateMed(i, 'frequency', e.target.value)}
              />
            </div>
            <input
              className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
              placeholder={t('Duración (ej: 7 días)')}
              value={med.duration}
              onChange={e => updateMed(i, 'duration', e.target.value)}
            />
          </div>
        ))}

        <button type="button" onClick={addMed} className="text-xs text-[#7CB4E8] hover:underline">
          {t('+ Agregar otro medicamento')}
        </button>

        <textarea
          className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
          placeholder={t('Indicaciones adicionales...')}
          rows={3}
          value={instructions}
          onChange={e => { setInstructions(e.target.value); setDraftRestored(false) }}
        />

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saving ? 'Emitiendo...' : 'Emitir y firmar receta'}
        </button>
        <p className="text-[10px] text-white/30">
          {t('Mientras escribes, guardamos un borrador solo en este dispositivo por si se corta la conexión. Nada queda firmado hasta que tocas "Emitir y firmar receta".')}
        </p>
      </form>
    </div>
  )
}

// ── Panel lateral: emitir historia clínica SIN salir de la llamada ──
// Guardado manual (botón "Guardar"), no automático — así el médico
// decide cuándo su nota ya está lista para quedar registrada, en vez de
// ir mandando fragmentos a medias cada vez que deja de tipear un segundo.
function ClinicalNotePanel({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const { t } = useLanguage()
  const [noteId, setNoteId] = useState<string | null>(null)
  const [subjective, setSubjective] = useState('')
  const [objective, setObjective] = useState('')
  const [assessment, setAssessment] = useState('')
  const [plan, setPlan] = useState('')
  const [isVisibleToPatient, setIsVisibleToPatient] = useState(true)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [dirty, setDirty] = useState(false)
  const loadedRef = useRef(false)

  // Cargar nota existente si ya se había creado antes (ej. el médico cerró
  // y reabrió el panel durante la misma llamada, o ya había guardado algo).
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    clinicalNotesAPI.getByConsultation(consultationId)
      .then(res => {
        const n = res.data
        setNoteId(n.id)
        setSubjective(n.subjective ?? '')
        setObjective(n.objective ?? '')
        setAssessment(n.assessment ?? '')
        setPlan(n.plan ?? '')
        setIsVisibleToPatient(n.is_visible_to_patient)
      })
      .catch(() => {}) // 404 esperado si todavía no existe
  }, [consultationId])

  // Aviso del navegador si intenta cerrar/recargar la pestaña con cambios
  // sin guardar — como ya no hay autoguardado, esto es lo que evita
  // perder la nota por accidente.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  async function handleSave() {
    if (!subjective && !objective && !assessment && !plan) return
    setSaveState('saving')
    try {
      if (noteId) {
        await clinicalNotesAPI.update(noteId, { subjective, objective, assessment, plan, is_visible_to_patient: isVisibleToPatient })
      } else {
        const res = await clinicalNotesAPI.create({
          consultation_id: consultationId, subjective, objective, assessment, plan, is_visible_to_patient: isVisibleToPatient,
        })
        setNoteId(res.data.id)
      }
      setSaveState('saved')
      setDirty(false)
    } catch {
      setSaveState('error')
    }
  }

  function updateField(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setDirty(true)
      if (saveState === 'saved' || saveState === 'error') setSaveState('idle')
    }
  }

  const saveLabel = saveState === 'saving' ? 'Guardando...' : saveState === 'saved' ? '✓ Guardado' : saveState === 'error' ? 'Error al guardar' : dirty ? 'Cambios sin guardar' : ''

  return (
    <div className="w-80 bg-[#161B22] border-l border-white/10 flex flex-col flex-shrink-0 z-30 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-[#161B22]">
        <div>
          <p className="text-white text-sm font-semibold">{t('📋 Historia clínica')}</p>
          {saveLabel && (
            <p className={`text-[10px] mt-0.5 ${dirty && saveState !== 'saving' ? 'text-[#F5C563]' : 'text-white/40'}`}>{saveLabel}</p>
          )}
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white text-lg leading-none">✕</button>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="text-[11px] text-white/50 mb-1 block">{t('Subjetivo — lo que relata el paciente')}</label>
          <textarea
            className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
            rows={2}
            value={subjective}
            onChange={e => updateField(setSubjective)(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px] text-white/50 mb-1 block">{t('Objetivo — hallazgos del examen')}</label>
          <textarea
            className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
            rows={2}
            value={objective}
            onChange={e => updateField(setObjective)(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px] text-white/50 mb-1 block">{t('Evaluación — impresión clínica')}</label>
          <textarea
            className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
            rows={2}
            value={assessment}
            onChange={e => updateField(setAssessment)(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px] text-white/50 mb-1 block">{t('Plan — indicaciones y seguimiento')}</label>
          <textarea
            className="w-full bg-white/10 text-white text-xs px-2.5 py-2 rounded-lg outline-none placeholder:text-white/30"
            rows={2}
            value={plan}
            onChange={e => updateField(setPlan)(e.target.value)}
          />
        </div>

        <label className="flex items-start gap-2 text-[11px] text-white/60 pt-1">
          <input
            type="checkbox"
            checked={isVisibleToPatient}
            onChange={e => { setIsVisibleToPatient(e.target.checked); setDirty(true) }}
            className="mt-0.5"
          />
          {t('Visible para el paciente en su historial (desmárcalo si es una nota interna)')}
        </label>

        <button
          onClick={handleSave}
          disabled={saveState === 'saving' || (!dirty && !!noteId)}
          className="w-full py-2 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saveState === 'saving' ? t('Guardando...') : t('Guardar')}
        </button>
        <p className="text-[10px] text-white/30">
          {t('No se guarda solo — acordate de tocar "Guardar" antes de cerrar este panel o salir de la llamada.')}
        </p>
      </div>
    </div>
  )
}

export default function ProfessionalVideoPage() {
  const { t } = useLanguage()
  const params = useSearchParams()

  const token          = params.get('token') ?? ''
  const livekitUrl     = params.get('lk') ?? ''
  const consultationId = params.get('cid') ?? ''

  const roomRef        = useRef<Room | null>(null)
  const localVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const chatEndRef     = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)
  const connectingRef  = useRef(false)
  const hideTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [status, setStatus]               = useState<'connecting' | 'connected' | 'patient_joined' | 'ended'>('connecting')
  const [micMuted, setMicMuted]           = useState(false)
  const [camOff, setCamOff]               = useState(false)
  const [duration, setDuration]           = useState(0)
  const [ending, setEnding]               = useState(false)
  const [chatOpen, setChatOpen]           = useState(false)
  const [messages, setMessages]           = useState<ChatMsg[]>([])
  const [unread, setUnread]               = useState(0)
  const [inputText, setInputText]         = useState('')
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [sidePanel, setSidePanel] = useState<'none' | 'rx' | 'note'>('none')

  // ── Calidad de conexión / reconexión ──────────────────────────────
  // Bolivia tiene redes de datos y wifi bastante inestables — sin esto,
  // si a alguno de los dos se le corta un instante la conexión, el video
  // simplemente se congela sin ninguna explicación y no saben si esperar
  // o directamente cortar y reagendar.
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality | null>(null)

  // Mostrar controles y reiniciar temporizador de ocultamiento
  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!chatOpen && sidePanel === 'none' && !showEndConfirm) setControlsVisible(false)
    }, 3500)
  }, [chatOpen, sidePanel, showEndConfirm])

  // Siempre visible cuando chat, panel lateral o modal están abiertos
  useEffect(() => {
    if (chatOpen || sidePanel !== 'none' || showEndConfirm) {
      setControlsVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    } else {
      showControls()
    }
  }, [chatOpen, sidePanel, showEndConfirm])

  useEffect(() => {
    showControls()
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [])

  useEffect(() => {
    if (status !== 'connected' && status !== 'patient_joined') return
    const id = setInterval(() => setDuration(d => d + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    if (!token || !livekitUrl) return
    if (connectingRef.current) return
    connectingRef.current = true

    // Config de calidad: resolución objetivo 720p con simulcast, para que
    // LiveKit pueda bajar automáticamente la calidad de la capa que se
    // envía a cada participante según su ancho de banda, en vez de
    // congelar o pixelar todo el video cuando la red está congestionada.
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: {
        simulcast: true,
        videoCodec: 'vp8',
        videoEncoding: VideoPresets.h720.encoding,
        red: true, // redundancia de audio: reduce cortes al hablar en redes inestables
      },
    })
    roomRef.current = room

    room.on(RoomEvent.ParticipantConnected, () => setStatus('patient_joined'))
    room.on(RoomEvent.ParticipantDisconnected, () => setStatus('connected'))
    room.on(RoomEvent.Disconnected, () => setStatus('ended'))
    room.on(RoomEvent.Reconnecting, () => setIsReconnecting(true))
    room.on(RoomEvent.Reconnected, () => setIsReconnecting(false))
    room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant) => {
      // Solo nos interesa la calidad del participante local (la nuestra) —
      // la del paciente no la podemos mejorar desde acá, y mostrar las dos
      // solo agrega ruido visual.
      if (participant.isLocal) setConnectionQuality(quality)
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

    // `cancelled`: si el componente se desmonta (o cambian token/livekitUrl)
    // MIENTRAS createLocalTracks()/publishTrack() siguen en vuelo, la
    // cámara/micrófono ya se prendieron (createLocalTracks hace el
    // getUserMedia real) pero esos tracks todavía no son parte de la sala
    // — room.disconnect() de la función de limpieza de abajo solo apaga
    // los tracks que YA están publicados, así que estos quedaban
    // huérfanos con el hardware encendido (el led de la cámara seguía
    // prendido después de salir de la videollamada). Con esta bandera,
    // en cuanto los tracks existen se chequea si ya nos cancelaron y, si
    // es así, se paran ahí mismo en vez de intentar publicarlos.
    let cancelled = false

    room.connect(livekitUrl, token)
      .then(() => {
        if (cancelled) return null
        if (room.remoteParticipants.size > 0) {
          setStatus('patient_joined')
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
        return createLocalTracks({
          audio: true,
          video: { resolution: VideoPresets.h720.resolution },
        })
      })
      .then(async tracks => {
        if (!tracks) return
        if (cancelled) {
          // Ya nos cancelaron mientras esperábamos la cámara/micrófono —
          // apagarlos ya mismo, no publicarlos a una sala de la que ya
          // nos desconectamos.
          tracks.forEach(t => t.stop())
          return
        }
        for (const track of tracks) {
          if (cancelled) { track.stop(); continue }
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
      .catch(e => console.error('LiveKit connect error:', e))

    return () => {
      cancelled = true
      connectingRef.current = false
      room.disconnect()
      roomRef.current = null
    }
  }, [token, livekitUrl])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  function openChat() { setSidePanel('none'); setChatOpen(true); setUnread(0) }
  function openSidePanel(panel: 'none' | 'rx' | 'note') { setChatOpen(false); setSidePanel(panel) }

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

  async function leaveCall() {
    setEnding(true)
    roomRef.current?.disconnect()
    window.location.href = '/professional/dashboard'
  }

  const [pendingRxWarning, setPendingRxWarning] = useState(false)
  const [pendingNoteWarning, setPendingNoteWarning] = useState(false)

  async function endConsultation() {
    setEnding(true)
    try {
      if (consultationId) {
        const res = await consultationsAPI.updateStatus(consultationId, 'COMPLETED')
        const data = res.data as any
        if (data?.prescription_pending) {
          setEnding(false)
          setShowEndConfirm(false)
          setPendingNoteWarning(!!data?.clinical_note_pending) // se mostrará después, si aplica
          setPendingRxWarning(true)
          return // no salir todavía — dejar que el médico decida
        }
        if (data?.clinical_note_pending) {
          setEnding(false)
          setShowEndConfirm(false)
          setPendingNoteWarning(true)
          return
        }
      }
    } catch (e) { console.error('Error al finalizar:', e) }
    roomRef.current?.disconnect()
    window.location.href = '/professional/dashboard'
  }

  function leaveWithoutPrescription() {
    setPendingRxWarning(false)
    if (pendingNoteWarning) return // ya se muestra el modal de historia clínica
    roomRef.current?.disconnect()
    window.location.href = '/professional/dashboard'
  }

  function leaveWithoutClinicalNote() {
    setPendingNoteWarning(false)
    roomRef.current?.disconnect()
    window.location.href = '/professional/dashboard'
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      className="fixed inset-0 bg-black flex"
      onMouseMove={showControls}
      onTouchStart={showControls}
      style={{ cursor: controlsVisible ? 'default' : 'none' }}
    >
      {/* ── Modal confirmación Finalizar ── */}
      {showEndConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#161B22] border border-white/10 rounded-2xl p-6 max-w-xs w-full mx-4 text-center">
            <p className="text-3xl mb-2">🏁</p>
            <p className="text-white font-semibold mb-1">{t('¿Finalizar la consulta?')}</p>
            <p className="text-white/50 text-xs mb-5">{t('Esta acción termina la consulta para el paciente también. No se puede deshacer.')}</p>
            <div className="flex gap-3">
              <button onClick={() => setShowEndConfirm(false)} className="flex-1 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition-colors">
                {t('Cancelar')}
              </button>
              <button onClick={endConsultation} disabled={ending} className="flex-1 py-2 rounded-xl bg-[#E24B4A] hover:bg-[#c93a39] text-white text-sm font-medium transition-colors disabled:opacity-60">
                {ending ? 'Finalizando...' : 'Finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: receta pendiente tras finalizar (Gap 3) ── */}
      {pendingRxWarning && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#161B22] border border-white/10 rounded-2xl p-6 max-w-xs w-full mx-4 text-center">
            <p className="text-3xl mb-2">💊</p>
            <p className="text-white font-semibold mb-1">{t('¿Deseas emitir una receta?')}</p>
            <p className="text-white/50 text-xs mb-5">
              {t('La consulta finalizó y todavía no emitiste ninguna receta para este paciente.')}
            </p>
            <div className="flex gap-3">
              <button onClick={leaveWithoutPrescription} className="flex-1 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition-colors">
                {t('Salir sin receta')}
              </button>
              <button
                onClick={() => { setPendingRxWarning(false); setSidePanel('rx') }}
                className="flex-1 py-2 rounded-xl bg-[#185FA5] hover:bg-[#0C447C] text-white text-sm font-medium transition-colors"
              >
                {t('Emitir receta')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: historia clínica pendiente tras finalizar ── */}
      {pendingNoteWarning && !pendingRxWarning && sidePanel === 'none' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#161B22] border border-white/10 rounded-2xl p-6 max-w-xs w-full mx-4 text-center">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-white font-semibold mb-1">{t('¿Deseas dejar una nota en la historia clínica?')}</p>
            <p className="text-white/50 text-xs mb-5">
              {t('La consulta finalizó y todavía no registraste ninguna nota clínica para este paciente.')}
            </p>
            <div className="flex gap-3">
              <button onClick={leaveWithoutClinicalNote} className="flex-1 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition-colors">
                {t('Salir sin nota')}
              </button>
              <button
                onClick={() => { setPendingNoteWarning(false); setSidePanel('note') }}
                className="flex-1 py-2 rounded-xl bg-[#185FA5] hover:bg-[#0C447C] text-white text-sm font-medium transition-colors"
              >
                {t('Registrar historia clínica')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Video remoto — ocupa toda la pantalla ── */}
      <div className="flex-1 relative">
        <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
        <audio ref={remoteAudioRef} autoPlay />

        {/* Placeholder cuando el paciente no está */}
        {status !== 'patient_joined' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0D1117]">
            <div className="w-20 h-20 rounded-full bg-[#185FA5]/20 border-2 border-[#185FA5] flex items-center justify-center text-4xl animate-pulse">👤</div>
            <p className="text-white text-sm font-medium">
              {status === 'connecting' ? 'Conectando...' : 'Esperando al paciente...'}
            </p>
            {status === 'connected' && <p className="text-[#475569] text-xs">{t('El paciente entrará automáticamente')}</p>}
          </div>
        )}

        {/* Banner de reconexión — se superpone al video mientras LiveKit
            reintenta la conexión, para que quede claro que hay que
            esperar en vez de pensar que la llamada se congeló sola. */}
        {isReconnecting && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
            <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-white text-sm font-medium">{t('Reconectando...')}</p>
            <p className="text-white/50 text-xs max-w-[220px] text-center">
              {t('Se cortó la conexión un momento. Estamos intentando reconectar automáticamente, esperá unos segundos.')}
            </p>
          </div>
        )}

        {/* Timer — siempre visible arriba */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-sm text-white text-xs px-4 py-1.5 rounded-full font-mono z-10 pointer-events-none">
          <span>{status === 'connecting' ? '⏳ Conectando' : `🔴 ${fmt(duration)}`}</span>
          {(status === 'connected' || status === 'patient_joined') && (
            <SignalIcon quality={connectionQuality} />
          )}
        </div>

        {/* Video local — miniatura, siempre visible */}
        <div className="absolute bottom-28 right-4 w-32 h-24 rounded-xl overflow-hidden border-2 border-white/30 shadow-xl bg-black z-10">
          <video ref={localVideoRef} autoPlay playsInline muted className={`w-full h-full object-cover ${camOff ? 'opacity-0' : ''}`} />
          {camOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]">
              <span className="text-2xl">👨‍⚕️</span>
            </div>
          )}
          <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1 rounded">Tú</div>
        </div>

        {/* ── Barra de controles — superpuesta sobre el video ── */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)' }}
        >
          {/* overflow-x-auto + w-max mx-auto: con 7 botones (a diferencia
              de los 4 del paciente) la fila no entra en el ancho de un
              celular — sin esto, el navegador la centraba igual y el
              último ícono (Chat) quedaba literalmente fuera de pantalla,
              inalcanzable. Así se centra cuando entra y se puede
              deslizar horizontalmente cuando no. flex-shrink-0 en cada
              botón evita que el scroll los comprima. */}
          <div className="overflow-x-auto">
            <div className="flex items-end gap-6 px-6 pb-6 pt-10 w-max mx-auto">

            {/* Micrófono */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button onClick={toggleMic} className={`w-13 h-13 w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl transition-all ${micMuted ? 'bg-[#E24B4A] scale-95' : 'bg-white/20 hover:bg-white/30 backdrop-blur-sm'} text-white shadow-lg`}>
                {micMuted ? '🔇' : '🎤'}
              </button>
              <span className="text-white/70 text-[11px] font-medium">{micMuted ? 'Sin audio' : 'Micrófono'}</span>
            </div>

            {/* Cámara */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button onClick={toggleCam} className={`w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl transition-all ${camOff ? 'bg-[#E24B4A] scale-95' : 'bg-white/20 hover:bg-white/30 backdrop-blur-sm'} text-white shadow-lg`}>
                {camOff ? '🚫' : '📷'}
              </button>
              <span className="text-white/70 text-[11px] font-medium">{camOff ? 'Cámara off' : 'Cámara'}</span>
            </div>

            {/* Salir — botón grande rojo */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button onClick={leaveCall} disabled={ending} className="w-[60px] h-[60px] rounded-full bg-[#E24B4A] hover:bg-[#c93a39] text-white text-2xl flex items-center justify-center transition-all shadow-xl disabled:opacity-60 hover:scale-105">
                📵
              </button>
              <span className="text-white/70 text-[11px] font-medium">{t('Salir')}</span>
            </div>

            {/* Finalizar */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button onClick={() => setShowEndConfirm(true)} disabled={ending} className="w-[52px] h-[52px] rounded-full bg-white/20 hover:bg-red-900/70 backdrop-blur-sm text-white text-xl flex items-center justify-center transition-all shadow-lg disabled:opacity-60">
                🏁
              </button>
              <span className="text-white/70 text-[11px] font-medium">{t('Finalizar')}</span>
            </div>

            {/* Receta */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => openSidePanel(sidePanel === 'rx' ? 'none' : 'rx')}
                className={`w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl transition-all backdrop-blur-sm shadow-lg text-white ${sidePanel === 'rx' ? 'bg-[#185FA5]' : 'bg-white/20 hover:bg-white/30'}`}
              >
                💊
              </button>
              <span className="text-white/70 text-[11px] font-medium">{t('Receta')}</span>
            </div>

            {/* Historia clínica */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => openSidePanel(sidePanel === 'note' ? 'none' : 'note')}
                className={`w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl transition-all backdrop-blur-sm shadow-lg text-white ${sidePanel === 'note' ? 'bg-[#185FA5]' : 'bg-white/20 hover:bg-white/30'}`}
              >
                📋
              </button>
              <span className="text-white/70 text-[11px] font-medium">{t('Historia')}</span>
            </div>

            {/* Chat */}
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <button onClick={openChat} className="relative w-[52px] h-[52px] rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white flex items-center justify-center text-xl transition-all shadow-lg">
                💬
                {unread > 0 && !chatOpen && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#E24B4A] rounded-full text-xs flex items-center justify-center font-bold">{unread}</span>
                )}
              </button>
              <span className="text-white/70 text-[11px] font-medium">{t('Chat')}</span>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Panel de chat lateral ── */}
      {chatOpen && (
        <div className="w-72 bg-[#161B22] border-l border-white/10 flex flex-col flex-shrink-0 z-30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <p className="text-white text-sm font-semibold">{t('Chat con paciente')}</p>
            <button onClick={() => setChatOpen(false)} className="text-white/50 hover:text-white text-lg leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-white/30 text-xs text-center mt-6">{t('Los mensajes solo duran durante esta llamada')}</p>
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
              placeholder={t('Escribe un mensaje...')}
              className="flex-1 bg-white/10 text-white text-sm px-3 py-2 rounded-xl outline-none placeholder:text-white/30 focus:bg-white/15"
            />
            <button onClick={sendMessage} disabled={!inputText.trim()} className="w-9 h-9 bg-[#185FA5] hover:bg-[#0C447C] disabled:opacity-40 text-white rounded-xl flex items-center justify-center text-sm transition-colors">
              ➤
            </button>
          </div>
        </div>
      )}

      {sidePanel === 'rx' && consultationId && (
        <PrescriptionPanel consultationId={consultationId} onClose={() => setSidePanel('none')} />
      )}

      {sidePanel === 'note' && consultationId && (
        <ClinicalNotePanel consultationId={consultationId} onClose={() => setSidePanel('none')} />
      )}
    </div>
  )
}