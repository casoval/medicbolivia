'use client'
// src/app/patient/agent/useHoldToRecord.ts
//
// Grabación de voz "mantener presionado" estilo WhatsApp:
//   · se graba MIENTRAS el botón está presionado y se envía al soltar;
//   · deslizar el dedo/mouse hacia la izquierda y soltar cancela;
//   · un toque corto (< MIN_DURATION_MS) no envía nada y muestra una ayuda.
//
// Por qué un hook aparte y no código suelto en la página: la versión anterior
// reemplazaba el botón del micrófono por otro botón al empezar a grabar. En el
// celular, cuando el elemento que recibió el toque desaparece del DOM se pierde
// el evento de "soltar" y la grabación quedaba abierta; además leía el estado
// `isRecording` de un render viejo. Acá el botón nunca se desmonta, usa
// setPointerCapture (el "soltar" llega aunque el dedo se salga del botón) y todo
// el estado que cambia entre eventos vive en refs.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'

export const MIN_DURATION_MS = 700       // menos que esto = toque accidental, no se envía
export const MAX_SECONDS = 60            // tope de grabación; al llegar se envía solo
export const CANCEL_DISTANCE_PX = 80     // cuánto hay que deslizar a la izquierda para cancelar

const HINT_SHORT_PRESS = 'Mantén presionado el botón para grabar y suéltalo para enviar'
const HINT_NO_MIC = 'No se pudo acceder al micrófono. Revisa los permisos del navegador.'

interface Session {
  send: boolean
  chunks: Blob[]
}

export function useHoldToRecord(
  onRecorded: (blob: Blob, mimeType: string) => void | Promise<void>,
  enabled = true,
) {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [willCancel, setWillCancel] = useState(false)
  const [hint, setHint] = useState('')

  const holdingRef = useRef(false)       // el dedo/mouse sigue presionado AHORA
  const startingRef = useRef(false)      // esperando el permiso/stream del micrófono
  const recorderRef = useRef<MediaRecorder | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const startXRef = useRef(0)
  const startedAtRef = useRef(0)
  const cancelRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRecordedRef = useRef(onRecorded)
  onRecordedRef.current = onRecorded

  const showHint = useCallback((msg: string) => {
    setHint(msg)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(''), 2500)
  }, [])

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // Termina la grabación en curso. cancel=true descarta el audio.
  const finish = useCallback((cancel: boolean) => {
    holdingRef.current = false
    const recorder = recorderRef.current
    const session = sessionRef.current
    // Si todavía no empezó (el micrófono se está abriendo), no hay nada que cerrar:
    // start() ve holdingRef=false cuando el micrófono esté listo y se descarta solo.
    if (!recorder || !session) return

    const tooShort = Date.now() - startedAtRef.current < MIN_DURATION_MS
    session.send = !cancel && !tooShort

    recorderRef.current = null
    sessionRef.current = null
    clearTimer()
    setIsRecording(false)
    setSeconds(0)
    setWillCancel(false)
    cancelRef.current = false

    if (recorder.state === 'recording') {
      try { recorder.requestData() } catch { /* ya está cerrando */ }
      recorder.stop() // onstop libera el micrófono y envía (si session.send)
    }
    if (!cancel && tooShort) showHint(HINT_SHORT_PRESS)
  }, [showHint])

  const start = useCallback(async () => {
    startingRef.current = true
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      startingRef.current = false
      holdingRef.current = false
      showHint(HINT_NO_MIC)
      return
    }
    startingRef.current = false

    // Soltó antes de que el micrófono estuviera listo (típico la primera vez, por
    // el cuadro de permiso): no se graba nada y se libera el micrófono.
    if (!holdingRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      showHint(HINT_SHORT_PRESS)
      return
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
    const recorder = new MediaRecorder(stream, { mimeType })
    // `session` es propio de ESTA grabación: si el usuario graba otra enseguida, el
    // onstop de la anterior no pisa ni mezcla sus datos.
    const session: Session = { send: false, chunks: [] }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) session.chunks.push(e.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      if (session.send && session.chunks.length > 0) {
        void onRecordedRef.current(new Blob(session.chunks, { type: mimeType }), mimeType)
      }
    }

    recorder.start(250)
    recorderRef.current = recorder
    sessionRef.current = session
    startedAtRef.current = Date.now()
    cancelRef.current = false
    setIsRecording(true)
    setSeconds(0)
    setWillCancel(false)
    if (typeof navigator.vibrate === 'function') navigator.vibrate(15)

    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) finish(false) // llegó al tope: se envía solo
    }, 250)
  }, [finish, showHint])

  const press = useCallback((clientX: number) => {
    if (!enabled) return
    startXRef.current = clientX
    holdingRef.current = true
    if (recorderRef.current || startingRef.current) return
    void start()
  }, [enabled, start])

  // Handlers para esparcir en el <button> del micrófono.
  const bind = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== undefined && e.button !== 0) return // solo el botón principal del mouse
      e.preventDefault()
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no soportado */ }
      press(e.clientX)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!recorderRef.current) return
      const cancel = e.clientX - startXRef.current < -CANCEL_DISTANCE_PX
      if (cancel !== cancelRef.current) {
        cancelRef.current = cancel
        setWillCancel(cancel)
      }
    },
    onPointerUp: () => finish(cancelRef.current),
    // El navegador tomó el gesto (llamada entrante, cambio de app…): se descarta.
    onPointerCancel: () => finish(true),
    // El menú contextual del "toque largo" en celular cancelaría el gesto.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    // Accesibilidad por teclado: mantener Espacio/Enter equivale a mantener presionado.
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault()
        press(0)
      }
    },
    onKeyUp: (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        finish(false)
      }
    },
  }

  // Al desmontar (navegar a otra página) se corta sin enviar.
  useEffect(() => {
    return () => {
      holdingRef.current = false
      if (sessionRef.current) sessionRef.current.send = false
      const r = recorderRef.current
      if (r && r.state === 'recording') r.stop()
      clearTimer()
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    }
  }, [])

  return { isRecording, seconds, willCancel, hint, bind }
}
