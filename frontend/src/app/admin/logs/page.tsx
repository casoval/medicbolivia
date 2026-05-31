'use client'
// src/app/admin/logs/page.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { LoadingScreen, SectionTitle } from '@/components/ui'
import { api } from '@/lib/api'

const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
const IconCard  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
const IconBot   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconLog   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconCog   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>

const NAV = [
  { label: 'Resumen',       href: '/admin/dashboard',      icon: <IconGrid /> },
  { label: 'Profesionales', href: '/admin/professionals',  icon: <IconUsers /> },
  { label: 'Pacientes',     href: '/admin/patients',       icon: <IconUsers /> },
  { label: 'Pagos',         href: '/admin/payments',       icon: <IconCard /> },
  { label: 'Agente IA',     href: '/admin/agent',          icon: <IconBot /> },
  { label: 'Auditoría',     href: '/admin/logs',           icon: <IconLog /> },
  { label: 'Configuración', href: '/admin/settings',       icon: <IconCog /> },
]

const DOT_COLORS: Record<string, string> = {
  PAYMENT:  '#1D9E75',
  REFUND:   '#E24B4A',
  DOC:      '#185FA5',
  AGENT:    '#7F77DD',
  APPROVED: '#1D9E75',
  REJECTED: '#E24B4A',
  LOGIN:    '#185FA5',
}

function getDotColor(action: string): string {
  for (const [key, color] of Object.entries(DOT_COLORS)) {
    if (action.includes(key)) return color
  }
  return '#A0A8BF'
}

export default function AdminLogsPage() {
  const [filter, setFilter] = useState('')

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['admin', 'logs', filter],
    queryFn: () => api.get('/admin/logs', { params: { limit: 100, action: filter || undefined } }).then(r => r.data),
    refetchInterval: 20000,
  })

  function exportCSV() {
    const rows = [
      ['ID', 'Acción', 'Entidad', 'Fecha', 'IP'],
      ...logs.map((l: any) => [
        l.id, l.action, l.entity_type || '', l.created_at, l.ip_address || ''
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `medicbolivia_logs_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/logs" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Auditoría y logs</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Registro completo de todas las acciones del sistema</p>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {['', 'PAYMENT', 'REFUND', 'DOC', 'AGENT'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                filter === f
                  ? 'bg-[#E6F1FB] border-[#185FA5] text-[#185FA5] font-medium'
                  : 'bg-white border-[#DDE1EE] text-[#6B738A]'
              }`}
            >
              {f === '' ? 'Todos' : f === 'PAYMENT' ? 'Pagos' : f === 'REFUND' ? 'Reembolsos' : f === 'DOC' ? 'Documentos' : 'Agente IA'}
            </button>
          ))}
          <button
            onClick={exportCSV}
            className="ml-auto btn-secondary text-xs py-1.5 px-3"
          >
            Exportar CSV
          </button>
        </div>

        {isLoading ? <LoadingScreen /> : (
          <div className="card">
            <SectionTitle>
              {logs.length} registro{logs.length !== 1 ? 's' : ''}
            </SectionTitle>
            {logs.length === 0 ? (
              <p className="text-sm text-[#6B738A] text-center py-8">No hay registros con este filtro</p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {logs.map((l: any) => (
                  <div key={l.id} className="py-2.5 flex items-start gap-3">
                    <div
                      className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                      style={{ background: getDotColor(l.action) }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{l.action}</p>
                      <p className="text-xs text-[#6B738A] mt-0.5">
                        {l.entity_type && `${l.entity_type} · `}
                        {new Date(l.created_at).toLocaleString('es-BO')}
                        {l.ip_address && ` · ${l.ip_address}`}
                      </p>
                      {l.metadata && Object.keys(l.metadata).length > 0 && (
                        <p className="text-xs text-[#A0A8BF] mt-0.5 truncate">
                          {Object.entries(l.metadata).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
