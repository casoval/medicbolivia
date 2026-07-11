'use client'
// src/components/admin/ia/ConversationsTab.tsx
// Pestaña 3 — inbox de WhatsApp (filtrable por audiencia) + panel de
// configuración global del agente IA. El toggle "agente" de cada chat es
// independiente del switch global: permite que un admin tome el control
// manual de una conversación puntual sin apagar el bot para todos.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SectionTitle, Alert, LoadingScreen, EmptyState, Toggle } from '@/components/ui'
import { whatsappAPI, getErrorMessage } from '@/lib/api'

const AUDIENCE_LABEL: Record<string, string> = { PATIENT: 'Paciente', PROFESSIONAL: 'Profesional', ADMIN: 'Admin', PUBLIC: 'Público' }
const AUDIENCE_BADGE: Record<string, string> = { PATIENT: 'badge-blue', PROFESSIONAL: 'badge-green', ADMIN: 'badge-gray', PUBLIC: 'badge-gray' }

interface Conversation {
  id: string
  phone: string
  contact_name: string | null
  audience: string
  agent_enabled: boolean
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
}

interface Message {
  id: string
  direction: 'IN' | 'OUT'
  body: string
  sent_by: string | null
  status: string
  created_at: string
}

interface AgentConfig {
  is_active: boolean
  guardrail_diagnosis_locked: boolean
  auto_reply_public: boolean
  auto_reply_patients: boolean
  auto_reply_professionals: boolean
  business_hours_only: boolean
}

export function ConversationsTab() {
  const queryClient = useQueryClient()
  const [audienceFilter, setAudienceFilter] = useState<'ALL' | 'PATIENT' | 'PROFESSIONAL' | 'ADMIN' | 'PUBLIC'>('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const { data: conversations = [], isLoading: loadingList } = useQuery<Conversation[]>({
    queryKey: ['admin', 'whatsapp', 'conversations', audienceFilter],
    queryFn: async () => (await whatsappAPI.listConversations(audienceFilter === 'ALL' ? undefined : audienceFilter)).data,
    refetchInterval: 15000,
  })

  const { data: thread, isLoading: loadingThread } = useQuery({
    queryKey: ['admin', 'whatsapp', 'conversation', selectedId],
    queryFn: async () => (await whatsappAPI.getConversationMessages(selectedId as string)).data as { conversation: Conversation; messages: Message[] },
    enabled: !!selectedId,
    refetchInterval: selectedId ? 8000 : false,
  })

  const { data: agentConfig } = useQuery<AgentConfig>({
    queryKey: ['admin', 'whatsapp', 'agent-config'],
    queryFn: async () => (await whatsappAPI.getAgentConfig()).data,
  })

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'conversations'] })
  const invalidateThread = () => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'conversation', selectedId] })

  const sendMutation = useMutation({
    mutationFn: () => whatsappAPI.sendManualMessage(selectedId as string, draft.trim()),
    onSuccess: () => { setDraft(''); setError(''); invalidateThread(); invalidateList() },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const toggleChatAgentMutation = useMutation({
    mutationFn: (vars: { id: string; agent_enabled: boolean }) => whatsappAPI.toggleConversationAgent(vars.id, vars.agent_enabled),
    onSuccess: () => { invalidateList(); invalidateThread() },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const updateAgentConfigMutation = useMutation({
    mutationFn: (data: AgentConfig) => whatsappAPI.updateAgentConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'agent-config'] }),
    onError: (err) => setError(getErrorMessage(err)),
  })

  function toggleGlobalSwitch(key: keyof AgentConfig) {
    if (!agentConfig || key === 'guardrail_diagnosis_locked') return
    updateAgentConfigMutation.mutate({ ...agentConfig, [key]: !agentConfig[key] })
  }

  return (
    <div className="space-y-4">
      {/* ── Configuración global del agente ── */}
      <div className="card p-4">
        <SectionTitle>Configuración del agente IA (Medi)</SectionTitle>
        {error && <div className="mb-2"><Alert type="error" message={error} /></div>}
        {agentConfig && (
          <div className="space-y-0">
            {([
              { key: 'is_active', label: 'Agente activo', desc: 'Interruptor general — si está apagado, nadie recibe respuesta automática', locked: false },
              { key: 'auto_reply_public', label: 'Responder a números no registrados', desc: 'Consultas generales de gente que aún no es paciente ni profesional', locked: false },
              { key: 'auto_reply_patients', label: 'Responder a pacientes', desc: 'Pacientes ya registrados en la plataforma', locked: false },
              { key: 'auto_reply_professionals', label: 'Responder a profesionales', desc: 'Profesionales ya registrados en la plataforma', locked: false },
              { key: 'guardrail_diagnosis_locked', label: 'Guardrail anti-diagnóstico', desc: 'Bloquea diagnósticos/recetas por WhatsApp — no editable', locked: true },
            ] as const).map(({ key, label, desc, locked }) => {
              const on = agentConfig[key]
              return (
                <div key={key} className="flex items-center justify-between py-3 border-b border-[#DDE1EE] last:border-0">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-[#6B738A] mt-0.5">{desc}</p>
                  </div>
                  {locked ? (
                    <div className="flex items-center gap-2">
                      <span className="badge-red text-[10px]">Bloqueado</span>
                      <Toggle on={on} disabled />
                    </div>
                  ) : (
                    <Toggle on={on} onChange={() => toggleGlobalSwitch(key)} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Inbox ── */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 pb-0">
          <SectionTitle>Conversaciones</SectionTitle>
        </div>
        <div className="flex gap-2 px-4 pb-3 flex-wrap">
          {(['ALL', 'PATIENT', 'PROFESSIONAL', 'ADMIN', 'PUBLIC'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setAudienceFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                audienceFilter === f ? 'bg-[#185FA5] text-white border-[#185FA5]' : 'bg-white text-[#6B738A] border-[#DDE1EE]'
              }`}
            >
              {f === 'ALL' ? 'Todas' : AUDIENCE_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] border-t border-[#DDE1EE]">
          {/* Lista */}
          <div className="border-r border-[#DDE1EE] max-h-[420px] overflow-y-auto">
            {loadingList ? (
              <LoadingScreen text="Cargando conversaciones..." />
            ) : conversations.length === 0 ? (
              <EmptyState title="Sin conversaciones" description="Los mensajes entrantes van a aparecer acá." />
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-[#DDE1EE] hover:bg-[#F5F6FA] transition-colors ${selectedId === c.id ? 'bg-[#F5F6FA]' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{c.contact_name || c.phone}</p>
                    {c.unread_count > 0 && <span className="badge-blue text-[10px]">{c.unread_count}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`${AUDIENCE_BADGE[c.audience] || 'badge-gray'} text-[9px]`}>{AUDIENCE_LABEL[c.audience] || c.audience}</span>
                    {!c.agent_enabled && <span className="badge-gray text-[9px]">Bot off</span>}
                  </div>
                  <p className="text-xs text-[#6B738A] mt-1 truncate">{c.last_message_preview || '—'}</p>
                </button>
              ))
            )}
          </div>

          {/* Hilo */}
          <div className="flex flex-col max-h-[420px]">
            {!selectedId ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#6B738A]">Elegí una conversación para ver el historial</p>
              </div>
            ) : loadingThread ? (
              <LoadingScreen text="Cargando mensajes..." />
            ) : thread ? (
              <>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#DDE1EE]">
                  <div>
                    <p className="text-sm font-medium">{thread.conversation.contact_name || thread.conversation.phone}</p>
                    <p className="text-xs text-[#6B738A]">{thread.conversation.phone}</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#6B738A]">
                    Agente en este chat
                    <Toggle
                      on={thread.conversation.agent_enabled}
                      onChange={(v) => toggleChatAgentMutation.mutate({ id: thread.conversation.id, agent_enabled: v })}
                    />
                  </label>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {thread.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                        m.direction === 'OUT' ? 'bg-[#185FA5] text-white rounded-br-sm' : 'bg-[#F5F6FA] text-[#141820] rounded-bl-sm'
                      }`}>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className={`text-[9px] mt-1 ${m.direction === 'OUT' ? 'text-white/70' : 'text-[#6B738A]'}`}>
                          {m.sent_by === 'BOT' ? 'Bot IA' : m.sent_by === 'ADMIN' ? 'Tú' : m.sent_by === 'SYSTEM' ? 'Automático' : ''}
                          {m.status === 'FAILED' ? ' · Falló' : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 border-t border-[#DDE1EE]">
                  {error && <div className="mb-2"><Alert type="error" message={error} /></div>}
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="Responder manualmente (toma control del chat)..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) sendMutation.mutate() }}
                    />
                    <button className="btn-primary" disabled={sendMutation.isPending || !draft.trim()} onClick={() => sendMutation.mutate()}>
                      Enviar
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
