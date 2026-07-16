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
  // true mientras no sepamos si hay mensajes más viejos que los ya
  // cargados. seedMessages() lo fija según el tamaño del primer lote
  // (ver ChatWindow.tsx) y prependOlderMessages lo actualiza en cada
  // "Ver mensajes anteriores".
  const [hasMore, setHasMore] = useState(true)
  const [connected, setConnected] = useState(false)
  // Un solo estado genérico a propósito: el backend nunca distingue si el
  // motivo es un bloqueo puntual, un bloqueo global, el bloqueo integral
  // desde "Mis Pacientes", o que la conversación venció — todos llegan
  // con el mismo code="chat_unavailable" (ver endpoints/chat.py). El
  // frontend jamás debe intentar adivinar cuál fue.
  const [chatUnavailable, setChatUnavailable] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnect = useRef(true)

  const seedMessages = useCallback((history: ChatMessage[], pageSize: number) => {
    setMessages(history)
    // Si el primer lote vino incompleto (menos que el tamaño de página),
    // no hay mensajes más viejos que pedir.
    setHasMore(history.length >= pageSize)
  }, [])

  // Antepone un lote de mensajes más viejos (ya vienen ordenados
  // ascendente desde el backend) sin duplicar los que ya estén en
  // memoria por las dudas.
  const prependOlderMessages = useCallback((older: ChatMessage[], pageSize: number) => {
    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id))
      const toAdd = older.filter((m) => !existingIds.has(m.id))
      return [...toAdd, ...prev]
    })
    setHasMore(older.length >= pageSize)
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
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
            // Si es un mensaje propio, puede haber un mensaje "temp-..."
            // puesto por addLocalMessage (actualización optimista al
            // mandar) esperando su confirmación real — lo reemplazamos en
            // vez de agregar uno nuevo, para no duplicarlo en pantalla.
            if (msg.sender_id === currentUserId) {
              const tempIdx = prev.findIndex(
                (m) => m.id.startsWith('temp-') && m.content === msg.content
              )
              if (tempIdx !== -1) {
                const next = [...prev]
                next[tempIdx] = msg
                return next
              }
            }
            return [...prev, msg]
          })
        } else if (data.type === 'error') {
          if (data.code === 'chat_unavailable') setChatUnavailable(true)
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
    // Usado para actualización optimista: al mandar texto (aparece al
    // toque, sin esperar el viaje de ida y vuelta por Redis) y también
    // tras subir un adjunto por REST (el mensaje ya vuelve en la
    // respuesta HTTP). En ambos casos, cuando la confirmación real llega
    // por WS, onmessage la reconcilia (reemplaza el "temp-..." o
    // deduplica por id) en vez de duplicarlo en pantalla.
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
  }, [])

  return { messages, hasMore, connected, chatUnavailable, sendMessage, seedMessages, prependOlderMessages, addLocalMessage }
}
