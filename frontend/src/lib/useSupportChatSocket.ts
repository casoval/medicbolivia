// src/lib/useSupportChatSocket.ts
// Igual que useChatSocket.ts pero para el chat directo con soporte (ver
// backend/app/api/v1/endpoints/support_chat.py). Se mantiene como hook
// separado a propósito: acá no existe el concepto de "chatUnavailable"
// por bloqueo/expiración — el único motivo de indisponibilidad es el
// interruptor global (support_chat_unavailable).
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { buildSupportChatWebSocketUrl } from './api'
import type { SupportMessage, SupportChatSocketEvent } from '@/types'

const RECONNECT_DELAY_MS = 2500

export function useSupportChatSocket(conversationId: string | null, currentUserId: string | undefined) {
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [connected, setConnected] = useState(false)
  const [supportChatUnavailable, setSupportChatUnavailable] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnect = useRef(true)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSentRef = useRef(0)

  const seedMessages = useCallback((history: SupportMessage[], pageSize: number) => {
    setMessages(history)
    setHasMore(history.length >= pageSize)
  }, [])

  const prependOlderMessages = useCallback((older: SupportMessage[], pageSize: number) => {
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
      const ws = new WebSocket(buildSupportChatWebSocketUrl(conversationId!))
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onmessage = (event) => {
        const data: SupportChatSocketEvent = JSON.parse(event.data)
        if (data.type === 'message') {
          const { type, ...msg } = data
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev
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
          if (data.code === 'support_chat_unavailable') setSupportChatUnavailable(true)
        } else if (data.type === 'typing') {
          if (data.user_id === currentUserId) return
          setOtherTyping(true)
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = setTimeout(() => setOtherTyping(false), 3000)
        } else if (data.type === 'read') {
          if (data.reader_id === currentUserId) return
          setMessages((prev) =>
            prev.map((m) =>
              m.sender_id === currentUserId && !m.read_at
                ? { ...m, read_at: data.read_at }
                : m
            )
          )
        }
      }

      ws.onclose = (event) => {
        setConnected(false)
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
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      wsRef.current?.close()
    }
  }, [conversationId, currentUserId])

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content }))
    }
  }, [])

  const sendTyping = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    const now = Date.now()
    if (now - lastTypingSentRef.current < 2000) return
    lastTypingSentRef.current = now
    wsRef.current.send(JSON.stringify({ type: 'typing' }))
  }, [])

  const addLocalMessage = useCallback((msg: SupportMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
  }, [])

  return {
    messages, hasMore, connected, supportChatUnavailable, otherTyping,
    sendMessage, sendTyping, seedMessages, prependOlderMessages, addLocalMessage,
  }
}
