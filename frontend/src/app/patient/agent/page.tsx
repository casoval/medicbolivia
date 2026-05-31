'use client'
// src/app/patient/agent/page.tsx
// Página del Agente IA — chat + opción de voz con ElevenLabs

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { agentAPI, consultationsAPI, getErrorMessage } from '@/lib/api'
import { useAgentStore } from '@/lib/store'
import type { Professional } from '@/types'

const IconBot = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
const IconHome = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
const IconClock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>

const NAV = [
  { label: 'Inicio', href: '/patient/dashboard', icon: <IconHome /> },
  { label: 'Buscar médico', href: '/patient/search', icon: <IconSearch /> },
  { label: 'Agente IA', href: '/patient/agent', icon: <IconBot /> },
  { label: 'Sala de espera', href: '/patient/waiting-room', icon: <IconClock /> },
  { label: 'Mis consultas', href: '/patient/history', icon: <IconFile /> },
]

const QUICK_REPLIES = [
  'Tengo dolor de cabeza',
  'Dolor en el pecho',
  'Me siento ansioso/a',
  'Mi hijo está enfermo',
  'Necesito control de peso',
  'Dolor en la espalda',
]

interface Message {
  role: 'user' | 'agent'
  text: string
  timestamp: Date
}

function ProfessionalCard({
  pro,
  onSelect,
}: {
  pro: Professional
  onSelect: (pro: Professional) => void
}) {
  return (
    <div className="bg-white border border-[#DDE1EE] rounded-xl p-3 flex items-start gap-3 hover:border-[#185FA5] transition-colors cursor-pointer" onClick={() => onSelect(pro)}>
      <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
        {pro.first_name[0]}{pro.last_name[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{pro.first_name} {pro.last_name}</p>
        <p className="text-xs text-[#6B738A]">{pro.specialty}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[#EF9F27] text-xs">★ {parseFloat(pro.average_rating).toFixed(1)}</span>
          <span className="badge-green text-[10px]">En línea</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold">Bs. {parseFloat(pro.price_general).toFixed(0)}</p>
        <button className="btn-primary text-xs py-1 px-2 mt-1">Consultar</button>
      </div>
    </div>
  )
}

export default function AgentPage() {
  const router = useRouter()
  const { sessionId, messages, isTyping, availableProfessionals, setSessionId, addMessage, setTyping, setAvailableProfessionals } = useAgentStore()
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'chat' | 'voice'>('chat')
  const [creatingConsultation, setCreatingConsultation] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Mensaje inicial del agente
  useEffect(() => {
    if (messages.length === 0) {
      addMessage('agent', '¡Hola! Soy Medi, tu agente de orientación médica de MedicBolivia. Cuéntame, ¿cómo te sientes hoy o en qué puedo ayudarte? Recuerda que no puedo darte un diagnóstico, pero sí conectarte con el especialista correcto 😊')
    }
  }, [])

  // Scroll automático al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  async function sendMessage(text?: string) {
    const msg = text || input.trim()
    if (!msg) return

    setInput('')
    addMessage('user', msg)
    setTyping(true)

    try {
      const res = await agentAPI.chat(msg, sessionId || undefined)
      const { session_id, message, action, available_professionals } = res.data

      if (!sessionId) setSessionId(session_id)
      addMessage('agent', message)

      if (available_professionals && available_professionals.length > 0) {
        setAvailableProfessionals(available_professionals)
      }

    } catch (err) {
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
      const consultation = res.data
      addMessage('agent', `Perfecto. Estoy coordinando tu consulta con ${pro.first_name} ${pro.last_name}. El siguiente paso es confirmar el pago de Bs. ${parseFloat(pro.price_general).toFixed(0)} mediante QR. Te llevo a la sala de espera.`)

      setTimeout(() => {
        router.push(`/patient/waiting-room?consultationId=${consultation.id}`)
      }, 2000)
    } catch (err) {
      addMessage('agent', `Hubo un problema al crear la consulta: ${getErrorMessage(err)}. Por favor intenta de nuevo.`)
    } finally {
      setCreatingConsultation(false)
    }
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/patient/agent" role="PATIENT">
      <div className="max-w-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold">Agente de orientación médica</h1>
            <p className="text-xs text-[#6B738A]">
              Te guío para encontrar al especialista correcto ·{' '}
              <span className="text-[#A32D2D] font-medium">No emite diagnósticos</span>
            </p>
          </div>

          {/* Selector de modo */}
          <div className="flex bg-[#F5F6FA] rounded-lg p-1 gap-1">
            <button
              onClick={() => setMode('chat')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'chat' ? 'bg-white text-[#185FA5] border border-[#DDE1EE]' : 'text-[#6B738A]'}`}
            >
              💬 Chat
            </button>
            <button
              onClick={() => setMode('voice')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'voice' ? 'bg-white text-[#185FA5] border border-[#DDE1EE]' : 'text-[#6B738A]'}`}
            >
              📞 Llamada
            </button>
          </div>
        </div>

        {/* Chat */}
        {mode === 'chat' && (
          <div className="border border-[#DDE1EE] rounded-xl overflow-hidden flex flex-col" style={{ height: '520px' }}>

            {/* Header del chat */}
            <div className="px-4 py-3 bg-white border-b border-[#DDE1EE] flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-xs font-bold">IA</div>
              <div>
                <p className="text-sm font-semibold">Medi · Agente MedicBolivia</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#22C27A] animate-pulse-dot" />
                  <p className="text-xs text-[#22C27A]">En línea</p>
                </div>
              </div>
              <span className="ml-auto badge-red">No diagnostica</span>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 bg-[#F5F6FA] flex flex-col gap-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#185FA5] text-white rounded-br-sm'
                        : 'bg-white border border-[#DDE1EE] text-[#141820] rounded-bl-sm'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {/* Indicador de escritura */}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-[#DDE1EE] px-3.5 py-2.5 rounded-xl rounded-bl-sm flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#A0A8BF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {/* Profesionales disponibles */}
              {availableProfessionals.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-[#6B738A] font-medium">Profesionales disponibles ahora:</p>
                  {availableProfessionals.map((pro) => (
                    <ProfessionalCard key={pro.id} pro={pro} onSelect={selectProfessional} />
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Opciones rápidas */}
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

            {/* Input */}
            <div className="px-3 py-2.5 bg-white border-t border-[#DDE1EE] flex gap-2">
              <input
                className="flex-1 px-3.5 py-2 border border-[#DDE1EE] rounded-full text-sm bg-[#F5F6FA] focus:outline-none focus:border-[#185FA5] text-[#141820] placeholder-[#A0A8BF]"
                placeholder="Escribe aquí tu consulta..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                disabled={isTyping || creatingConsultation}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isTyping || creatingConsultation}
                className="w-9 h-9 rounded-full bg-[#185FA5] text-white flex items-center justify-center hover:bg-[#0C447C] transition-colors disabled:opacity-50"
              >
                ↑
              </button>
            </div>
          </div>
        )}

        {/* Modo voz */}
        {mode === 'voice' && (
          <div className="card text-center py-8">
            <div className="w-16 h-16 rounded-full bg-[#185FA5] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">
              IA
            </div>
            <p className="text-sm font-semibold mb-1">Llamada de voz con el agente Medi</p>
            <p className="text-xs text-[#6B738A] mb-6">El agente te llamará a tu número registrado · Voz generada por ElevenLabs</p>
            <button className="btn-primary mx-auto">
              📞 Iniciar llamada de voz
            </button>
            <p className="text-xs text-[#A0A8BF] mt-3">Funcionalidad disponible próximamente con Twilio + ElevenLabs</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
