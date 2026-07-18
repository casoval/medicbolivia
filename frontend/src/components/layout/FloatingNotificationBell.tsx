'use client'
// src/components/layout/FloatingNotificationBell.tsx
//
// Ícono redondo flotante, visible en cualquier parte de la plataforma
// (montado desde DashboardLayout), que avisa al paciente o profesional que
// tiene una notificación nueva sin importar en qué pantalla esté.
//
// Reglas:
// - Solo aparece si hay al menos una notificación no leída que el usuario
//   no haya "quitado" manualmente todavía (ver dismissedIds más abajo).
// - Se puede arrastrar a cualquier posición de la pantalla (no se guarda
//   entre sesiones — siempre reaparece en la esquina inferior izquierda).
// - Se puede quitar con la "x": al quitarlo, se oculta hasta que llegue una
//   notificación realmente nueva (no reaparece por las mismas que ya tenía).
// - Un clic (sin arrastrar) abre un panel rápido con las notificaciones,
//   sin salir de la página en la que el usuario está.

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { notificationsAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const SIZE = 52
const MARGIN = 20
const DRAG_THRESHOLD = 5 // px — por debajo de esto, se considera clic y no arrastre

export function FloatingNotificationBell() {
  const { t } = useLanguage()
  const { user } = useAuthStore()
  const role = user?.role
  const enabled = role === 'PATIENT' || role === 'PROFESSIONAL'
  const queryClient = useQueryClient()
  const router = useRouter()

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', role],
    queryFn: () => notificationsAPI.getMine(role as 'PATIENT' | 'PROFESSIONAL'),
    enabled,
    refetchInterval: 20000,
  })
  const unread = notifications.filter((n) => !n.read)

  // ── notificaciones "quitadas" manualmente por el usuario ──
  // Se guardan por usuario en localStorage. Mientras una notificación no
  // leída siga en este set, no vuelve a mostrar la burbuja por ella; pero
  // en cuanto llega una nueva (id que no está acá), la burbuja reaparece.
  const storageKey = user ? `mb_bell_dismissed_${role}_${user.id}` : null
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setDismissedIds(new Set(JSON.parse(raw)))
    } catch {
      // localStorage no disponible o dato corrupto — se ignora, no es crítico
    }
  }, [storageKey])

  const visibleUnread = unread.filter((n) => !dismissedIds.has(n.id))
  const shouldShow = enabled && visibleUnread.length > 0

  function dismissBubble(e: React.MouseEvent) {
    e.stopPropagation()
    if (!storageKey) return
    const next = new Set(dismissedIds)
    unread.forEach((n) => next.add(n.id))
    setDismissedIds(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(next)))
    } catch {
      // no crítico si falla el guardado
    }
  }

  async function markAllRead() {
    if (!role || unread.length === 0) return
    try {
      await notificationsAPI.markAllRead(role as 'PATIENT' | 'PROFESSIONAL')
      queryClient.invalidateQueries({ queryKey: ['notifications', role] })
    } catch {
      // no crítico si falla
    }
  }

  // ── posición arrastrable (siempre reinicia en la esquina inferior
  // izquierda al recargar — no se persiste entre sesiones) ──
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPos({ x: MARGIN, y: window.innerHeight - SIZE - MARGIN })
  }, [])

  useEffect(() => {
    function onResize() {
      setPos((p) => {
        if (!p) return p
        return {
          x: Math.min(p.x, window.innerWidth - SIZE - 4),
          y: Math.min(p.y, window.innerHeight - SIZE - 4),
        }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!pos) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false }
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current || !pos) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragRef.current.moved = true
    const nx = Math.min(Math.max(0, dragRef.current.origX + dx), window.innerWidth - SIZE)
    const ny = Math.min(Math.max(0, dragRef.current.origY + dy), window.innerHeight - SIZE)
    setPos({ x: nx, y: ny })
  }

  function onPointerUp() {
    const wasDrag = dragRef.current?.moved
    dragRef.current = null
    if (!wasDrag) setOpen((v) => !v)
  }

  if (!shouldShow || !pos || typeof window === 'undefined') return null

  const openUp = pos.y > window.innerHeight / 2
  const alignRight = pos.x > window.innerWidth / 2

  return (
    <div className="fixed z-[60]" style={{ left: pos.x, top: pos.y }}>
      <div className="relative">
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="w-[52px] h-[52px] rounded-full bg-[#0F6E56] text-white shadow-lg flex items-center justify-center border-2 border-white touch-none select-none active:scale-95 transition-transform"
          style={{ cursor: 'grab' }}
          title="Tenés notificaciones nuevas — clic para ver, arrastrá para mover"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          <span className="absolute -top-1 -right-1 bg-[#E24B4A] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white pointer-events-none">
            {visibleUnread.length > 9 ? '9+' : visibleUnread.length}
          </span>
        </button>

        {/* Quitar el ícono — vuelve a aparecer solo con una notificación nueva */}
        <button
          onClick={dismissBubble}
          className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white text-[#6B738A] border border-[#DDE1EE] shadow flex items-center justify-center hover:text-[#141820]"
          title="Quitar (reaparece con una notificación nueva)"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
            <div
              className={`absolute w-72 bg-white border border-[#DDE1EE] rounded-xl shadow-xl z-[61] max-h-80 overflow-y-auto
                ${openUp ? 'bottom-[62px]' : 'top-[62px]'} ${alignRight ? 'right-0' : 'left-0'}`}
            >
              <div className="p-3 border-b border-[#DDE1EE] flex items-center justify-between">
                <p className="text-xs font-semibold">{t('Notificaciones')}</p>
                {unread.length > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-[#0F6E56] font-medium hover:underline">
                    Marcar todas leídas
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="text-xs text-[#6B738A] text-center py-6">{t('No tenés notificaciones todavía')}</p>
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {notifications.slice(0, 10).map((n) => (
                    <div key={n.id} className={`p-3 ${!n.read ? 'bg-[#F5FBF8]' : ''}`}>
                      <p className="text-xs font-medium">{n.title}</p>
                      <p className="text-xs text-[#6B738A] mt-0.5">{n.body}</p>
                      <p className="text-[10px] text-[#A0A8BF] mt-1">
                        {new Date(n.created_at).toLocaleString('es-BO')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-2 border-t border-[#DDE1EE]">
                <button
                  onClick={() => {
                    setOpen(false)
                    router.push(role === 'PATIENT' ? '/patient/profile' : '/professional/profile')
                  }}
                  className="w-full text-center text-xs text-[#0F6E56] font-medium py-1.5 hover:underline"
                >
                  Ver todas en mi perfil
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
