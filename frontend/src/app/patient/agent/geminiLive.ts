// geminiLive.ts — Gestor de Gemini Live completamente fuera de React

const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview'

const MEDI_SYSTEM_PROMPT = `Eres Medi, agente de orientación médica de MedicBolivia.
Hablas en español boliviano, de forma cálida y natural, como si fuera una llamada telefónica real.

AL INICIAR: Saluda así exactamente: "Hola, soy Medi de MedicBolivia, ¿en qué te puedo ayudar?"

ESTILO DE VOZ — muy importante:
- Frases cortas, máximo 15 palabras por turno
- Usa muletillas naturales: "entiendo", "claro", "ya veo", "perfecto"
- Si el paciente se detiene, di solo "ajá" o "sí, cuéntame" para animarle a continuar
- Nunca repitas lo que ya dijiste
- Nunca uses listas ni números al hablar
- Habla como lo haría una enfermera amable por teléfono

FLUJO:
1. Escucha el síntoma principal
2. Haz UNA sola pregunta de seguimiento si es necesario
3. Cuando tengas suficiente info, di: "Con eso que me cuentas, te conviene ver a un [especialidad]. Ya estoy buscando uno disponible, en un momento aparece en el chat."
4. Despedida corta: "Listo, ya está en el chat. Que te mejores, hasta luego."

URGENCIAS: Si menciona dolor de pecho, dificultad para respirar o pérdida de conciencia → di inmediatamente: "Eso es urgente, llama al 165 ahora mismo."

NUNCA: diagnósticos, medicamentos, listas, emojis, asteriscos.`

export type CallStatus = 'idle' | 'connecting' | 'active'

export type GeminiLiveCallbacks = {
  onStatusChange: (status: CallStatus) => void
  onMessage: (text: string) => void
  onAudio: (pcm: ArrayBuffer) => void
  onError: (msg: string) => void
  onRecommendation?: (specialty: string) => void
  onMediSpeaking?: (speaking: boolean) => void  // para UI — Medi hablando/escuchando
}

// ── Estado en window (sobrevive Fast Refresh) ─────
declare global { interface Window {
  __gLiveWs?: WebSocket | null
  __gLiveStatus?: CallStatus
  __gLiveStarted?: boolean
  __geminiLiveActive?: boolean
}}

function initWindowState() {
  if (typeof window === 'undefined') return
  if (!('__gLiveStatus' in window)) {
    window.__gLiveStatus = 'idle'
    window.__gLiveStarted = false
    window.__gLiveWs = null
    window.__geminiLiveActive = false
  }
}
if (typeof window !== 'undefined') initWindowState()

const getWs      = () => typeof window !== 'undefined' ? window.__gLiveWs ?? null : null
const setWs      = (v: WebSocket | null) => { if (typeof window !== 'undefined') window.__gLiveWs = v }
const getStat    = () => typeof window !== 'undefined' ? window.__gLiveStatus ?? 'idle' : 'idle'
const setStat    = (v: CallStatus) => { if (typeof window !== 'undefined') window.__gLiveStatus = v }
const getStarted = () => typeof window !== 'undefined' ? window.__gLiveStarted ?? false : false
const setStarted = (v: boolean) => { if (typeof window !== 'undefined') window.__gLiveStarted = v }

// ── Variables de audio ────────────────────────────
let micCtx: AudioContext | null = null
let playCtx: AudioContext | null = null
let processor: ScriptProcessorNode | null = null
let stream: MediaStream | null = null
let callbacks: GeminiLiveCallbacks | null = null

// Reproductor con scheduler preciso — sin gaps entre chunks
let audioQueue: ArrayBuffer[] = []
let nextPlayTime = 0
let isPlaying = false
let mediIsSpeaking = false

// ── Helpers de audio ──────────────────────────────

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// Versión rápida con Uint8Array — 10x más rápida que string concatenación
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000  // 32KB por chunk — evita stack overflow en móvil
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ── Reproductor de audio — scheduler continuo ─────
// Cada chunk se schedula pegado al anterior usando AudioContext.currentTime
// Sin onended, sin gaps, audio completamente fluido

function ensurePlayCtx() {
  if (!playCtx || playCtx.state === 'closed') {
    playCtx = new AudioContext({ sampleRate: 24000 })
    nextPlayTime = 0
  }
}

function scheduleChunk(data: ArrayBuffer) {
  try {
    ensurePlayCtx()
    const ctx = playCtx!
    const int16 = new Int16Array(data)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0

    const buf = ctx.createBuffer(1, float32.length, 24000)
    buf.copyToChannel(float32, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)

    const startAt = Math.max(ctx.currentTime + 0.005, nextPlayTime)  // 5ms lookahead mínimo
    src.start(startAt)
    nextPlayTime = startAt + buf.duration
  } catch (e) {
    console.error('[GeminiLive] Schedule error:', e)
  }
}

function flushAudioQueue() {
  while (audioQueue.length > 0) scheduleChunk(audioQueue.shift()!)
  isPlaying = false
}

function enqueueAudio(data: ArrayBuffer) {
  audioQueue.push(data)
  if (!isPlaying) {
    isPlaying = true
    flushAudioQueue()
  } else {
    // Ya está schedulando — agregar directo
    scheduleChunk(audioQueue.pop()!)
  }
}

// Interrupción (barge-in) — corta el audio de Medi si el paciente habla
function interruptPlayback() {
  if (!mediIsSpeaking) return
  // Cerrar y recrear el AudioContext cancela todos los buffers schedulados
  try { playCtx?.close() } catch {}
  playCtx = null
  audioQueue = []
  isPlaying = false
  nextPlayTime = 0
  mediIsSpeaking = false
  callbacks?.onMediSpeaking?.(false)
}

// ── Tono de llamada ───────────────────────────────

let ringCtx: AudioContext | null = null
let ringInterval: ReturnType<typeof setInterval> | null = null

function startRingtone() {
  stopRingtone()
  try {
    ringCtx = new AudioContext()
    const playRing = () => {
      if (!ringCtx || ringCtx.state === 'closed') return
      const t = ringCtx.currentTime
      const osc1 = ringCtx.createOscillator()
      const osc2 = ringCtx.createOscillator()
      const gain = ringCtx.createGain()
      osc1.frequency.value = 440; osc2.frequency.value = 480
      osc1.connect(gain); osc2.connect(gain); gain.connect(ringCtx.destination)
      gain.gain.setValueAtTime(0.08, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
      osc1.start(t); osc1.stop(t + 0.4)
      osc2.start(t); osc2.stop(t + 0.4)
    }
    playRing()
    ringInterval = setInterval(playRing, 1800)
  } catch {}
}

function stopRingtone() {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null }
  try { ringCtx?.close() } catch {}
  ringCtx = null
}

// ── Micrófono — AudioWorklet (sin ScriptProcessorNode deprecated) ────────
// El worklet corre en un hilo de audio dedicado — sin glitches, sin warnings

// Código del worklet como string — se carga via Blob URL sin archivos extra
const WORKLET_CODE = `
class MicProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = []; this._bufSize = 512; }
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i])
    while (this._buf.length >= this._bufSize) {
      const chunk = new Float32Array(this._buf.splice(0, this._bufSize))
      this.port.postMessage(chunk, [chunk.buffer])
    }
    return true
  }
}
registerProcessor('mic-processor', MicProcessor)
`

let workletNode: AudioWorkletNode | null = null

async function startMic(mediaStream: MediaStream, socket: WebSocket) {
  micCtx = new AudioContext({ sampleRate: 16000 })

  // Cargar worklet desde Blob URL — no requiere archivo externo
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
  const workletUrl = URL.createObjectURL(blob)
  await micCtx.audioWorklet.addModule(workletUrl)
  URL.revokeObjectURL(workletUrl)

  const source = micCtx.createMediaStreamSource(mediaStream)
  workletNode = new AudioWorkletNode(micCtx, 'mic-processor')

  let speakingDetected = false

  workletNode.port.onmessage = (e) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const float32: Float32Array = e.data

    // Barge-in — detectar voz del paciente mientras Medi habla
    if (mediIsSpeaking) {
      let rms = 0
      for (let i = 0; i < float32.length; i++) rms += float32[i] * float32[i]
      rms = Math.sqrt(rms / float32.length)
      if (rms > 0.015) {
        if (!speakingDetected) {
          speakingDetected = true
          interruptPlayback()
          socket.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }))
        }
      } else {
        speakingDetected = false
      }
    }

    const pcm16 = floatTo16BitPCM(float32)
    const b64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer)
    socket.send(JSON.stringify({
      realtime_input: {
        audio: { data: b64, mime_type: 'audio/pcm;rate=16000' }
      }
    }))
  }

  source.connect(workletNode)
  workletNode.connect(micCtx.destination)  // worklet necesita estar conectado para procesar
}

// ── Cleanup ───────────────────────────────────────

function cleanupAudio() {
  if (typeof window !== 'undefined') window.__geminiLiveActive = false
  stream?.getTracks().forEach(t => t.stop())
  workletNode?.port.close()
  workletNode?.disconnect()
  workletNode = null
  processor?.disconnect()
  processor = null
  try { micCtx?.close() } catch {}
  try { playCtx?.close() } catch {}
  micCtx = null; playCtx = null; stream = null
  audioQueue = []; isPlaying = false; nextPlayTime = 0; mediIsSpeaking = false
}

// ── Detección de especialidad ─────────────────────

const SPECIALTY_KEYWORDS: Record<string, string> = {
  'cardiólogo': 'Cardiología', 'cardiología': 'Cardiología', 'corazón': 'Cardiología',
  'dermatólogo': 'Dermatología', 'dermatología': 'Dermatología', 'piel': 'Dermatología',
  'pediatra': 'Pediatría', 'pediatría': 'Pediatría',
  'ginecólogo': 'Ginecología y Obstetricia', 'ginecología': 'Ginecología y Obstetricia',
  'neurólogo': 'Neurología', 'neurología': 'Neurología',
  'traumatólogo': 'Traumatología y Ortopedia', 'traumatología': 'Traumatología y Ortopedia', 'fractura': 'Traumatología y Ortopedia',
  'psiquiatra': 'Psiquiatría', 'psiquiatría': 'Psiquiatría', 'ansiedad': 'Psiquiatría', 'depresión': 'Psiquiatría',
  'psicólogo': 'Psicología', 'psicología': 'Psicología',
  'médico general': 'Medicina General',
  'internista': 'Medicina Interna', 'medicina interna': 'Medicina Interna',
  'gastroenterólogo': 'Gastroenterología', 'estómago': 'Gastroenterología',
  'urólogo': 'Urología', 'urología': 'Urología',
  'oftalmólogo': 'Oftalmología', 'ojos': 'Oftalmología',
  'otorrino': 'Otorrinolaringología', 'garganta': 'Otorrinolaringología',
  'neumólogo': 'Neumología', 'pulmón': 'Neumología',
  'endocrinólogo': 'Endocrinología', 'diabetes': 'Endocrinología', 'tiroides': 'Endocrinología',
}

let lastDetectedSpecialty = ''

function detectSpecialty(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [keyword, specialty] of Object.entries(SPECIALTY_KEYWORDS)) {
    if (lower.includes(keyword) && specialty !== lastDetectedSpecialty) {
      lastDetectedSpecialty = specialty
      return specialty
    }
  }
  return null
}

// ── API pública ───────────────────────────────────

export function getStatus(): CallStatus { return getStat() }

export function setCallbacks(cb: GeminiLiveCallbacks) { callbacks = cb }

export async function startCall(apiKey: string) {
  if (typeof window !== 'undefined') {
    if (window.__geminiLiveActive) {
      console.log('[GeminiLive] Already active, ignoring startCall')
      return
    }
    window.__geminiLiveActive = true
  }
  if (getStat() !== 'idle') return

  setStat('connecting')
  setStarted(false)
  callbacks?.onStatusChange('connecting')
  startRingtone()

  try {
    // Abrir WS y pedir micrófono en paralelo — ahorra ~200-400ms de setup
    const wsPromise = new Promise<void>((resolve, reject) => {
      setWs(new WebSocket(
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`
      ))
      const ws = getWs()!
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('WebSocket no pudo conectar'))
    })

    const [mediaStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        }
      }),
      wsPromise
    ])
    stream = mediaStream

    const ws = getWs()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket no pudo conectar')
    }

    ws.send(JSON.stringify({
      setup: {
        model: `models/${GEMINI_LIVE_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
        },
        systemInstruction: { parts: [{ text: MEDI_SYSTEM_PROMPT }] },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
            prefixPaddingMs: 20,
            silenceDurationMs: 300,
          }
        }
      }
    }))

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') handleMessage(event.data)
      else if (event.data instanceof Blob) event.data.text().then(handleMessage)
    }

    async function handleMessage(raw: string) {
      let data: any
      try { data = JSON.parse(raw) } catch { return }

      // Setup completo — iniciar micrófono y pedir saludo
      if (data.setupComplete !== undefined && !getStarted()) {
        setStarted(true)
        setStat('active')
        stopRingtone()
        lastDetectedSpecialty = ''
        callbacks?.onStatusChange('active')
        await startMic(stream!, getWs()!)
        // Trigger saludo — con gemini-3.1 se usa realtime_input para texto en conversación
        getWs()!.send(JSON.stringify({
          realtime_input: {
            text: 'Saluda al paciente.'
          }
        }))
        return
      }

      // Gemini empieza a generar — Medi está "hablando"
      if (data.serverContent?.modelTurn) {
        if (!mediIsSpeaking) {
          mediIsSpeaking = true
          callbacks?.onMediSpeaking?.(true)
        }
      }

      const parts = data.serverContent?.modelTurn?.parts
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            enqueueAudio(base64ToArrayBuffer(part.inlineData.data))
          }
          if (part.text) {
            const specialty = detectSpecialty(part.text)
            if (specialty) callbacks?.onRecommendation?.(specialty)
          }
        }
      }

      // Fin del turno de Medi
      if (data.serverContent?.turnComplete) {
        nextPlayTime = 0
        // Dar un pequeño margen antes de marcar que Medi dejó de hablar
        setTimeout(() => {
          mediIsSpeaking = false
          callbacks?.onMediSpeaking?.(false)
        }, 300)
      }
    }

    ws.onerror = () => {
      const was = getStat()
      setStat('idle'); setStarted(false); setWs(null); stopRingtone()
      callbacks?.onStatusChange('idle')
      if (was !== 'active') callbacks?.onError('No se pudo iniciar la llamada. Verifica tu conexión.')
      cleanupAudio()
    }

    ws.onclose = (event) => {
      console.warn('[GeminiLive] WS closed — code:', event.code, '| reason:', event.reason)
      const was = getStat()
      setStat('idle'); setStarted(false); setWs(null); stopRingtone()
      callbacks?.onStatusChange('idle')
      if (was === 'active') {
        callbacks?.onMessage('📞 Llamada finalizada. Los médicos recomendados aparecen abajo en el chat.')
      }
      cleanupAudio()
    }

  } catch (err) {
    console.error('[GeminiLive] Error:', err)
    setStat('idle'); stopRingtone()
    callbacks?.onStatusChange('idle')
    callbacks?.onError('No se pudo acceder al micrófono. Verifica los permisos del navegador.')
    cleanupAudio()
  }
}

export function endCall() {
  const ws = getWs()
  if (ws) { ws.onclose = null; ws.close(); setWs(null) }
  const was = getStat()
  setStat('idle'); setStarted(false); stopRingtone()
  callbacks?.onStatusChange('idle')
  if (was === 'active') {
    callbacks?.onMessage('📞 Llamada finalizada. Los médicos recomendados aparecen abajo en el chat.')
  }
  cleanupAudio()
}