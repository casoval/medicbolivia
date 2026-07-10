'use client'
// src/components/ui/Reveal.tsx
// Envoltorio simple para animar secciones al entrar en pantalla (scroll).
// Usa IntersectionObserver nativo — sin librerías nuevas — y solo anima
// una vez por elemento (no se repite al hacer scroll hacia arriba/abajo),
// para que se sienta sutil y no distraiga en una página con muchas secciones.

import { useEffect, useRef, useState, type ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  // Retraso opcional en ms, útil para escalonar varios elementos hermanos
  // (ej. las 3 tarjetas de "Atención médica en la que podés confiar").
  delayMs?: number
}

export function Reveal({ children, className = '', delayMs = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Si el navegador no soporta IntersectionObserver (muy raro hoy en
    // día), mostramos el contenido directo en vez de dejarlo invisible.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      } ${className}`}
      style={{ transitionDelay: visible ? `${delayMs}ms` : '0ms' }}
    >
      {children}
    </div>
  )
}
