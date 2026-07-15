'use client'
// src/components/shared/NotificationsBell.tsx
// Campanita de notificaciones para la página de Perfil. Funciona igual para
// paciente y profesional — solo cambia el prefijo del endpoint, resuelto en
// notificationsAPI. Mismo componente que consulta useNotificationsBadge, así
// que al marcar como leído acá también se actualiza (o desaparece) el ícono
// flotante global.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationsAPI } from '@/lib/api'

export function NotificationsBell({ role }: { role: 'PATIENT' | 'PROFESSIONAL' }) {
  const [showNotifs, setShowNotifs] = useState(false)
  const queryClient = useQueryClient()

  const { data: notifications = [], refetch } = useQuery({
    queryKey: ['notifications', role],
    queryFn: () => notificationsAPI.getMine(role),
    refetchInterval: 20000,
  })
  const unreadCount = notifications.filter((n) => !n.read).length

  async function markAllRead() {
    if (unreadCount === 0) return
    try {
      await notificationsAPI.markAllRead(role)
      refetch()
      // El ícono flotante comparte la misma query key, así se actualiza al toque
      queryClient.invalidateQueries({ queryKey: ['notifications', role] })
    } catch {
      // silencioso — no es crítico si falla el marcado de leído
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setShowNotifs((v) => !v); if (!showNotifs) markAllRead() }}
        className="relative w-9 h-9 rounded-full border border-[#DDE1EE] bg-white flex items-center justify-center hover:bg-[#F5F6FA] transition-colors"
        title="Notificaciones"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#E24B4A] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {showNotifs && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white border border-[#DDE1EE] rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto">
            <div className="p-3 border-b border-[#DDE1EE]">
              <p className="text-xs font-semibold">Notificaciones</p>
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-[#6B738A] text-center py-6">No tenés notificaciones todavía</p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {notifications.map((n) => (
                  <div key={n.id} className="p-3">
                    <p className="text-xs font-medium">{n.title}</p>
                    <p className="text-xs text-[#6B738A] mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-[#A0A8BF] mt-1">
                      {new Date(n.created_at).toLocaleString('es-BO')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
