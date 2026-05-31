'use client'
// src/app/professional/onboarding/page.tsx
// Onboarding para profesionales nuevos

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { agentAPI } from '@/lib/api'

interface Message {
  role: 'user' | 'agent'
  text: string
}

export default function ProfessionalOnboardingPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    startOnboarding()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  async function startOnboarding() {
    setIsTyping(true)
    try {
      const res = await agentAPI.onboarding('Hola, soy un profesional de salud recién registrado')
      const { session_id, message, onboarding_completed } = res.data
      setSessionId(session_id)
      setMessages([{ role: 'agent', text: message }])
      if (onboarding_completed) finishOnboarding()
    } catch {
      setMessages([{
        role: 'agent',
        text: '¡Bienvenido/a a MedicBolivia! Soy tu agente de bienvenida. Te guiaré en el proceso de verificación y configuración de tu perfil. ¿Empezamos?'
      }])
    } finally {
      setIsTyping(false)
    }
  }

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: msg }])
    setIsTyping(true)
    try {
      const res = await agentAPI.onboarding(msg, sessionId || undefined)
      const { session_id, message, onboarding_completed } = res.data
      if (!sessionId) setSessionId(session_id)
      setMessages((prev) => [...prev, { role: 'agent', text: message }])
      if (onboarding_completed) finishOnboarding()
    } catch {
      setMessages((prev) => [...prev, {
        role: 'agent',
        text: 'Disculpa, tuve un problema. Puedes continuar al panel de control.'
      }])
    } finally {
      setIsTyping(false)
    }
  }

  function finishOnboarding() {
    setDone(true)
    setTimeout(() => router.push('/professional/dashboard'), 2500)
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-[#042C53]">
            Medic<span className="font-normal text-[#6B738A]">Bolivia</span>
          </h1>
          <p className="text-sm text-[#6B738A] mt-1">
            Bienvenido profesional — configuremos tu perfil
          </p>
        </div>

        <div className="bg-white border border-[#DDE1EE] rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-[#0F6E56] flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
              IA
            </div>
            <div>
              <p className="text-white text-sm font-medium">Agente de bienvenida · Medi</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C27A]" />
                <p className="text-white/60 text-xs">En línea</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/professional/dashboard')}
              className="ml-auto text-white/50 text-xs hover:text-white/80"
            >
              Saltar →
            </button>
          </div>

          <div className="h-80 overflow-y-auto p-4 bg-[#F5F6FA] flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#0F6E56] text-white rounded-br-sm'
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
            {done && (
              <div className="text-center py-3">
                <div className="inline-flex items-center gap-2 bg-[#E1F5EE] text-[#0F6E56] px-4 py-2 rounded-full text-sm font-medium">
                  ✓ ¡Listo! Redirigiendo a tu panel...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="px-3 py-2.5 border-t border-[#DDE1EE] bg-white flex gap-2">
            <input
              className="flex-1 px-3.5 py-2 border border-[#DDE1EE] rounded-full text-sm bg-[#F5F6FA] focus:outline-none focus:border-[#0F6E56] text-[#141820] placeholder-[#A0A8BF]"
              placeholder="Escribe tu respuesta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              disabled={isTyping || done}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isTyping || done}
              className="w-9 h-9 rounded-full bg-[#0F6E56] text-white flex items-center justify-center hover:bg-[#085041] transition-colors disabled:opacity-50"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
