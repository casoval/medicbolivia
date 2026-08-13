'use client'
// src/components/landing/WhatsAppFloatingButton.tsx
// Botón flotante fijo en la esquina inferior derecha que lleva directo a
// un chat de WhatsApp con el número de MedicBolivia. Se puede cerrar con
// la "x", pero eso solo dura mientras la pestaña sigue abierta — no se
// guarda en localStorage ni en ningún lado, así que en la próxima carga
// de la página vuelve a aparecer (es el comportamiento pedido).

import { useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/LanguageContext'

// +591 68427797, en formato wa.me: solo dígitos, sin "+" ni espacios.
const WHATSAPP_NUMBER = '59168427797'
const WHATSAPP_MESSAGE = 'Hola, quiero más información sobre MedicBolivia'

export function WhatsAppFloatingButton() {
  const [visible, setVisible] = useState(true)
  const { t } = useLanguage()

  if (!visible) return null

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="relative flex items-center gap-2">
        <div className="hidden sm:block bg-white border border-[#DDE1EE] rounded-full px-4 py-2 shadow-lg text-xs font-medium text-[#141820] whitespace-nowrap">
          {t('¿Tenés dudas? Escribinos por WhatsApp')}
        </div>

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('Chatear por WhatsApp')}
          className="w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform shrink-0"
        >
          <MessageCircle className="w-7 h-7 text-white" fill="white" aria-hidden="true" />
        </a>

        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label={t('Cerrar')}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-[#DDE1EE] shadow flex items-center justify-center text-[#64748B] hover:text-[#141820] transition-colors"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
