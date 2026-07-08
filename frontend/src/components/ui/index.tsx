// src/components/ui/index.tsx
// Componentes UI reutilizables en toda la aplicación

import { ReactNode } from 'react'

// ── Spinner ───────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }[size]
  return (
    <div className={`${s} border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow`} />
  )
}

// ── Loading screen ────────────────────────────────────
export function LoadingScreen({ text = 'Cargando...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Spinner size="md" />
      <p className="text-sm text-[#6B738A]">{text}</p>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────
export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="text-center py-10">
      <p className="text-sm font-medium text-[#141820]">{title}</p>
      {description && <p className="text-xs text-[#6B738A] mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Alert ─────────────────────────────────────────────
export function Alert({ type, message }: { type: 'error' | 'success' | 'info' | 'warning'; message: string }) {
  const styles = {
    error:   'bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]',
    success: 'bg-[#E1F5EE] text-[#0F6E56] border-[#9FE1CB]',
    info:    'bg-[#E6F1FB] text-[#185FA5] border-[#85B7EB]',
    warning: 'bg-[#FAEEDA] text-[#854F0B] border-[#FAC775]',
  }
  return (
    <div className={`text-sm px-3 py-2.5 rounded-lg border ${styles[type]}`}>
      {message}
    </div>
  )
}

// ── Star rating display ───────────────────────────────
export function Stars({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const sz = size === 'sm' ? 'text-sm' : 'text-xl'
  return (
    <span className={sz}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= score ? '#EF9F27' : '#DDE1EE' }}>★</span>
      ))}
    </span>
  )
}

// ── Interactive star picker ───────────────────────────
export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className="text-2xl transition-transform hover:scale-110"
          style={{ color: i <= value ? '#EF9F27' : '#DDE1EE' }}
        >
          ★
        </button>
      ))}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────
export function Avatar({ initials, color = 'blue', size = 'md' }: {
  initials: string
  color?: 'blue' | 'teal' | 'purple' | 'coral' | 'amber'
  size?: 'sm' | 'md' | 'lg'
}) {
  const colors = {
    blue:   'bg-[#E6F1FB] text-[#185FA5]',
    teal:   'bg-[#E1F5EE] text-[#0F6E56]',
    purple: 'bg-[#EEEDFE] text-[#534AB7]',
    coral:  'bg-[#FAECE7] text-[#993C1D]',
    amber:  'bg-[#FAEEDA] text-[#854F0B]',
  }
  const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-12 h-12 text-base' }
  return (
    <div className={`${sizes[size]} ${colors[color]} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>
      {initials}
    </div>
  )
}

// ── Status badge ──────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    COMPLETED:            { cls: 'badge-green',  label: 'Completada' },
    IN_PROGRESS:          { cls: 'badge-blue',   label: 'En curso' },
    WAITING_PAYMENT:      { cls: 'badge-amber',  label: 'Pendiente pago' },
    PAYMENT_CONFIRMED:    { cls: 'badge-blue',   label: 'Pago confirmado' },
    WAITING_PROFESSIONAL: { cls: 'badge-blue',   label: 'Buscando profesional' },
    PROFESSIONAL_ACCEPTED:{ cls: 'badge-blue',   label: 'Profesional confirmó' },
    AGENT_TRIAGING:       { cls: 'badge-blue',   label: 'Con agente IA' },
    CANCELLED:            { cls: 'badge-gray',   label: 'Cancelada' },
    REFUNDED:             { cls: 'badge-gray',   label: 'Reembolsada' },
    // Estados de Payment.status (distintos de los de Consultation.status)
    PENDING:               { cls: 'badge-amber', label: 'QR pendiente' },
    CONFIRMED:             { cls: 'badge-blue',  label: 'Pago confirmado' },
    RELEASED_TO_PROFESSIONAL: { cls: 'badge-green', label: 'Liberado al profesional' },
    REFUNDED_PARTIAL:      { cls: 'badge-gray',  label: 'Reembolso parcial' },
    REFUNDED_FULL:         { cls: 'badge-gray',  label: 'Reembolso total' },
    DISPUTED:              { cls: 'badge-red',   label: 'En disputa' },
    // Se canceló sin llegar a cobrarse nada — distinto de un reembolso real
    CANCELLED_NO_CHARGE:   { cls: 'badge-gray',  label: 'Cancelado (sin cobro)' },
    ONLINE_NOW:           { cls: 'badge-green',  label: 'En línea' },
    OFFLINE:              { cls: 'badge-gray',   label: 'No disponible' },
    SCHEDULED_ONLY:       { cls: 'badge-amber',  label: 'Solo citas' },
    APPROVED:             { cls: 'badge-green',  label: 'Verificado' },
    PENDING_DOCS:         { cls: 'badge-amber',  label: 'Pendiente docs' },
    UNDER_REVIEW:         { cls: 'badge-blue',   label: 'En revisión' },
    REJECTED:             { cls: 'badge-red',    label: 'Rechazado' },
    SUSPENDED:            { cls: 'badge-red',    label: 'Suspendido' },
  }
  const cfg = map[status] || { cls: 'badge-gray', label: status }
  return <span className={cfg.cls}>{cfg.label}</span>
}

// ── Section title ─────────────────────────────────────
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-[#141820]">{children}</h2>
      {action && <div>{action}</div>}
    </div>
  )
}

// ── Divider row ───────────────────────────────────────
export function DividerRow({ children }: { children: ReactNode }) {
  return (
    <div className="py-3 border-b border-[#DDE1EE] last:border-0 flex items-center gap-3">
      {children}
    </div>
  )
}