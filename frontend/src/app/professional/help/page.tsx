'use client'
// src/app/professional/help/page.tsx
// Agente de Ayuda persistente para profesionales — a diferencia de
// /professional/onboarding (que solo corre una vez, en el primer registro,
// para explicar documentos y verificación), esta página se puede visitar en
// cualquier momento desde el botón "Ayuda" del menú para resolver dudas
// sobre el USO de la plataforma (horarios, pagos, recetas, etc.).

import { useState, useEffect, useRef } from 'react'
import { agentAPI } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'

interface Message {
  role: 'user' | 'agent'
  text: string
}

const QUICK_REPLIES_INIT = [
  '¿Cuánto demora la verificación de mis documentos?',
  '¿Cómo configuro mis horarios?',
  '¿Cuándo se liberan mis pagos?',
]

export default function ProfessionalHelpPage() {
  const { t } = useLanguage()
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', text: '¡Hola! Soy el Agente de Ayuda de MedicBolivia. Preguntame lo que necesites sobre cómo usar la plataforma.' },
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [quickReplies, setQuickReplies] = useState(QUICK_REPLIES_INIT)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg) return

    setInput('')
    setQuickReplies([])
    setMessages((prev) => [...prev, { role: 'user', text: msg }])
    setIsTyping(true)

    try {
      const res = await agentAPI.help(msg, sessionId || undefined)
      const { session_id, message } = res.data
      if (!sessionId) setSessionId(session_id)
      setMessages((prev) => [...prev, { role: 'agent', text: message }])
    } catch {
      setMessages((prev) => [...prev, {
        role: 'agent',
        text: 'Disculpa, tuve un problema técnico. Intenta de nuevo en un momento.'
      }])
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/help" role="PROFESSIONAL">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Ayuda')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            {t('Resuelve tus dudas sobre cómo usar la plataforma, cuando quieras')}
          </p>
        </div>

        <div className="bg-white border border-[#DDE1EE] rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-[#042C53] flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#185FA5] flex items-center justify-center text-white text-xs font-bold">
              IA
            </div>
            <div>
              <p className="text-white text-sm font-medium">{t('Agente de Ayuda')}</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C27A] animate-pulse-dot" />
                <p className="text-white/60 text-xs">{t('En línea')}</p>
              </div>
            </div>
          </div>

          <div className="h-[55vh] sm:h-96 overflow-y-auto p-4 bg-[#F5F6FA] flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#185FA5] text-white rounded-br-sm'
                    : 'bg-white border border-[#DDE1EE] text-[#141820] rounded-bl-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#DDE1EE] px-3.5 py-2.5 rounded-xl rounded-bl-sm flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {quickReplies.length > 0 && !isTyping && (
            <div className="px-3 py-2 flex flex-wrap gap-2 border-t border-[#DDE1EE] bg-white">
              {quickReplies.map((r) => (
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

          <div className="px-3 py-2.5 border-t border-[#DDE1EE] bg-white flex gap-2">
            <input
              className="flex-1 px-3.5 py-2 border border-[#DDE1EE] rounded-full text-sm bg-[#F5F6FA] focus:outline-none focus:border-[#185FA5] text-[#141820] placeholder-[#A0A8BF]"
              placeholder={t('Escribe tu pregunta...')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              disabled={isTyping}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isTyping}
              className="w-9 h-9 rounded-full bg-[#185FA5] text-white flex items-center justify-center hover:bg-[#0C447C] transition-colors disabled:opacity-50"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
