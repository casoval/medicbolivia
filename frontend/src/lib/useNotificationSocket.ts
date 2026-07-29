// src/lib/useNotificationSocket.ts
// Hook de conexión WebSocket para notificaciones push en tiempo real
// (cambios de estado de consultas, mensajes de chat nuevos, etc).
// Reemplaza al polling de 4 segundos que NotificationToast.tsx hacía
// contra /consultations/my desde cualquier pantalla de la app — ver
// app/core/notification_ws_manager.py en el backend.
//
// Es de solo lectura: no manda nada al servidor, solo recibe. Mismo
// patrón de reconexión con backoff que useChatSocket.ts, para no asumir
// que el socket dura para siempre (celular en segundo plano, wifi
// inestable, backend reiniciando, etc).
'use client'

import { useEffect, useRef, useState } from 'react'
import { buildNotificationWebSocketUrl } from './api'

const RECONNECT_DELAY_MS = 3000

export interface NotificationSocketEvent {
  type: 'notification'
  notification_type: string
  title: string
  body: string
  entity_type: string | null
  entity_id: string | null
}

/**
 * `onEvent` se llama con cada notificación que llega. Se recomienda que
 * el caller la use solo como disparador de "algo cambió, refrescá" en
 * vez de confiar 100% en el contenido del payload — el polling de
 * respaldo (más lento) sigue siendo la fuente de verdad final.
 */
export function useNotificationSocket(
  currentUserId: string | undefined,
  onEvent: (event: NotificationSocketEvent) => void,
) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnect = useRef(true)
  // Evita que el efecto tenga que re-crear el socket si onEvent cambia de
  // identidad en cada render (muy común si el caller no lo memoiza).
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!currentUserId) {
      return
    }
    shouldReconnect.current = true

    function connect() {
      const url = buildNotificationWebSocketUrl()
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const data: NotificationSocketEvent = JSON.parse(event.data)
          if (data.type === 'notification') onEventRef.current(data)
        } catch {
          // payload inesperado — se ignora, el polling de respaldo lo cubre
        }
      }

      ws.onclose = (event) => {
        setConnected(false)
        // 4001 token inválido: no tiene sentido reintentar hasta que
        // haya una sesión nueva (currentUserId cambia y el efecto corre
        // de nuevo solo).
        if (event.code === 4001) {
          shouldReconnect.current = false
          return
        }
        if (shouldReconnect.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [currentUserId])

  return { connected }
}
