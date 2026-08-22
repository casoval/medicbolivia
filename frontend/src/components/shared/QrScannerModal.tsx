'use client'
// src/components/shared/QrScannerModal.tsx
//
// Modal que abre la cámara del dispositivo (celular o notebook con webcam)
// y escanea un código QR en vivo con jsQR. Se usa en las páginas públicas
// de verificación (/verificar-receta, /verificar-orden-lab) para que una
// farmacia o laboratorio pueda escanear el QR impreso en la receta/orden
// en lugar de tener que escribir el código a mano.
//
// Decodifica cualquier texto de QR, pero está pensado para los que emite
// esta plataforma: una URL tipo "https://medicbolivia.com/verificar-receta?code=MB-RX-XXXX"
// (ver backend/app/services/prescription_pdf.py::_verify_url). Por eso
// intenta extraer el parámetro ?code= si el texto es una URL, y si no,
// devuelve el texto tal cual (por si alguien apunta la cámara directo al
// código impreso en vez del QR).

import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/** Si el texto decodificado es una URL con ?code=..., devuelve ese código.
 *  Si no, devuelve el texto tal cual (recortado). */
function extractCode(decodedText: string): string {
  try {
    const url = new URL(decodedText)
    const fromQuery = url.searchParams.get('code')
    if (fromQuery) return fromQuery.trim().toUpperCase()
  } catch {
    // No era una URL — seguimos con el texto crudo
  }
  return decodedText.trim().toUpperCase()
}

export function QrScannerModal({
  open,
  onClose,
  onResult,
}: {
  open: boolean
  onClose: () => void
  onResult: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setError('')

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no soporta acceso a la cámara. Ingresá el código manualmente.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setScanning(true)
        tick()
      } catch (err) {
        if (cancelled) return
        const name = (err as { name?: string })?.name
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('No se pudo acceder a la cámara. Dale permiso de cámara a este sitio en tu navegador, o ingresá el código manualmente.')
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError('No se encontró ninguna cámara en este dispositivo. Ingresá el código manualmente.')
        } else {
          setError('No se pudo abrir la cámara. Ingresá el código manualmente.')
        }
      }
    }

    function tick() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })
      if (code?.data) {
        onResult(extractCode(code.data))
        return // No seguimos escaneando: el padre va a cerrar el modal
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setScanning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#DDE1EE]">
          <p className="text-sm font-semibold text-[#141820]">Escanear código QR</p>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#F0F1F5] text-[#475569]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="relative bg-black aspect-square">
          {!error && (
            <>
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              {/* Marco guía */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 aspect-square border-2 border-white/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              {scanning && (
                <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/90">
                  Apuntá la cámara al código QR de la receta
                </p>
              )}
            </>
          )}
          {error && (
            <div className="h-full flex items-center justify-center p-5">
              <p className="text-sm text-white text-center">{error}</p>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <div className="p-3">
          <button
            onClick={onClose}
            className="w-full text-sm font-medium text-[#475569] py-2 rounded-lg hover:bg-[#F5F6FA]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
