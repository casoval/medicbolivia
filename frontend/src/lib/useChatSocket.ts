// src/lib/useChatSocket.ts
// Hook de conexión WebSocket para una conversación del chat interno.
// Reintenta la conexión con backoff simple si se corta (red del celular,
// el backend se reinicia, etc.) — no asume que el socket dura para siempre.
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { buildChatWebSocketUrl } from './api'
import type { ChatMessage, ChatSocketEvent } from '@/types'

const RECONNECT_DELAY_MS = 2500

export function useChatSocket(conversationId: string | null, currentUserId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [closedReason, setClosedReason] = useState<'conversation_closed' | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnect = useRef(true)

  const seedMessages = useCallback((history: ChatMessage[]) => {
    setMessages(history)
  }, [])

  useEffect(() => {
    if (!conversationId || !currentUserId) return
    shouldReconnect.current = true

    function connect() {
      const ws = new WebSocket(buildChatWebSocketUrl(conversationId!))
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onmessage = (event) => {
        const data: ChatSocketEvent = JSON.parse(event.data)
        if (data.type === 'message') {
          const { type, ...msg } = data
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
        } else if (data.type === 'error') {
          if (data.code === 'blocked') setBlocked(true)
          if (data.code === 'conversation_closed') setClosedReason('conversation_closed')
        }
      }

      ws.onclose = (event) => {
        setConnected(false)
        // 4001 token inválido, 4004 no encontrada: no tiene sentido reintentar.
        if (event.code === 4001 || event.code === 4004) {
          shouldReconnect.current = false
          return
        }
        if (shouldReconnect.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [conversationId, currentUserId])

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content }))
    }
  }, [])

  const addLocalMessage = useCallback((msg: ChatMessage) => {
    // Usado tras subir un adjunto por REST: el mensaje ya vuelve en la
    // respuesta HTTP, y también llega por WS (broadcast) — el chequeo
    // de `id` duplicado en onmessage evita que aparezca dos veces.
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
  }, [])

  return { messages, connected, blocked, closedReason, sendMessage, seedMessages, addLocalMessage }
}
