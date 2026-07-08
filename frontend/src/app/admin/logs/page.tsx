'use client'
// src/app/admin/logs/page.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, SectionTitle } from '@/components/ui'
import { api } from '@/lib/api'

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