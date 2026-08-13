'use client'
// src/components/landing/WhatsAppFloatingButton.tsx
// Botón flotante fijo en la esquina inferior derecha que lleva directo a
// un chat de WhatsApp con el número de MedicBolivia. Se puede cerrar con
// la "x", pero eso solo dura mientras la pestaña sigue abierta — no se
// guarda en localStorage ni en ningún lado, así que en la próxima carga
// de la página vuelve a aparecer (es el comportamiento pedido).

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// +591 68427797, en formato wa.me: solo dígitos, sin "+" ni espacios.
const WHATSAPP_NUMBER = '59168427797'
const WHATSAPP_MESSAGE = 'Hola, quiero más información sobre MedicBolivia'

// Ícono oficial de WhatsApp (glyph de la marca) en SVG puro, para que se
// reconozca de inmediato en vez de un ícono de chat genérico.
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.004 3C9.09 3 3.48 8.6 3.48 15.5c0 2.43.68 4.7 1.86 6.64L3 29l7.06-2.28a12.9 12.9 0 0 0 5.94 1.47h.005c6.914 0 12.523-5.6 12.523-12.5S22.918 3 16.004 3Zm0 22.86h-.004a10.3 10.3 0 0 1-5.26-1.44l-.377-.224-3.938 1.272 1.29-3.83-.246-.393a10.31 10.31 0 0 1-1.586-5.5c0-5.71 4.66-10.35 10.393-10.35 2.775 0 5.383 1.08 7.345 3.038a10.28 10.28 0 0 1 3.043 7.33c0 5.71-4.66 10.35-10.393 10.35Zm5.694-7.75c-.312-.156-1.845-.91-2.13-1.014-.286-.104-.494-.156-.702.156-.208.312-.806 1.014-.988 1.222-.182.208-.364.234-.676.078-.312-.156-1.317-.485-2.508-1.545-.927-.826-1.553-1.846-1.735-2.158-.182-.312-.02-.48.137-.636.14-.14.312-.364.468-.546.156-.182.208-.312.312-.52.104-.208.052-.39-.026-.546-.078-.156-.702-1.69-.962-2.314-.253-.608-.51-.526-.702-.536l-.598-.01c-.208 0-.546.078-.832.39-.286.312-1.09 1.066-1.09 2.6 0 1.534 1.116 3.016 1.272 3.224.156.208 2.196 3.354 5.322 4.703.744.32 1.324.512 1.776.656.746.238 1.424.204 1.96.124.598-.09 1.845-.754 2.105-1.482.26-.728.26-1.352.182-1.482-.078-.13-.286-.208-.598-.364Z" />
    </svg>
  )
}

export function WhatsAppFloatingButton() {
  const [visible, setVisible] = useState(true)
  const [entered, setEntered] = useState(false)
  const { t } = useLanguage()

  // Pequeño retraso para que el botón "aparezca" con la animación pop-in
  // en vez de estar ahí desde el primer render.
  useEffect(() => {
    const id = setTimeout(() => setEntered(true), 600)
    return () => clearTimeout(id)
  }, [])

  if (!visible) return null

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 transition-all duration-500 ${
        entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      {/* Burbuja tipo chat, con colita apuntando al botón */}
      <div className="hidden sm:block relative animate-fade-up">
        <div className="bg-white rounded-xl rounded-br-sm px-3 py-1.5 shadow-[0_6px_16px_rgba(20,24,32,0.10)] border border-[#EAEDF3] text-xs font-medium text-[#141820] whitespace-nowrap">
          {t('¿Tenés dudas? Escribinos por WhatsApp')}
        </div>
        <span className="absolute -bottom-1 right-4 w-2.5 h-2.5 bg-white border-b border-r border-[#EAEDF3] rotate-45" />
      </div>

      <div className="relative flex items-center shrink-0">
        {/* Anillo de pulso sutil detrás del botón para llamar la atención */}
        <span className="absolute inset-0 rounded-full bg-[#25D366] opacity-40 animate-ping [animation-duration:2.5s]" />

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('Chatear por WhatsApp')}
          className="relative w-11 h-11 rounded-full bg-gradient-to-br from-[#2FE076] to-[#1DA851] flex items-center justify-center shadow-[0_6px_16px_rgba(29,168,81,0.4)] hover:scale-110 hover:shadow-[0_8px_20px_rgba(29,168,81,0.5)] active:scale-95 transition-all duration-300"
        >
          <WhatsAppIcon className="w-5 h-5 text-white" />
        </a>

        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label={t('Cerrar')}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-[#DDE1EE] shadow flex items-center justify-center text-[#64748B] hover:text-[#141820] hover:scale-110 transition-all"
        >
          <X className="w-2.5 h-2.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
