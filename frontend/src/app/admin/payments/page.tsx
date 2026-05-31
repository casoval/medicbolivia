'use client'
// src/app/admin/payments/page.tsx - FIXED
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { StatusBadge, LoadingScreen, Alert, SectionTitle } from '@/components/ui'
import { api, getErrorMessage } from '@/lib/api'

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
  { label: 'Auditoria',     href: '/admin/logs',           icon: <IconLog /> },
  { label: 'Configuracion', href: '/admin/settings',       icon: <IconCog /> },
]

export default function AdminPaymentsPage() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [refundModal, setRefundModal] = useState<{ id: string; amount: string } | null>(null)
  const [refundReason, setRefundReason] = useState('')

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['admin', 'payments'],
    queryFn: () => api.get('/admin/payments', { params: { limit: 50 } }).then(r => r.data),
    refetchInterval: 15000,
  })

  const totalConfirmed = payments
    .filter((p: any) => ['CONFIRMED', 'RELEASED_TO_PROFESSIONAL'].includes(p.status))
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0)

  const totalPlatform = payments
    .filter((p: any) => ['CONFIRMED', 'RELEASED_TO_PROFESSIONAL'].includes(p.status))
    .reduce((sum: number, p: any) => sum + Number(p.platform_fee), 0)

  const pendingCount = payments.filter((p: any) => p.status === 'PENDING').length

  const refundMutation = useMutation({
    mutationFn: ({ id, type, reason }: { id: string; type: string; reason: string }) =>
      api.post(`/admin/payments/${id}/refund`, { refund_type: type, reason }),
    onSuccess: () => {
      setSuccess('Reembolso procesado correctamente')
      setRefundModal(null)
      setRefundReason('')
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/payments" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Pagos y finanzas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Transacciones QR y gestion de reembolsos</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#0F6E56]">Bs. {totalConfirmed.toFixed(2)}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Total recaudado</p>
          </div>
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#185FA5]">Bs. {totalPlatform.toFixed(2)}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Comision plataforma</p>
          </div>
          <div className="card py-3 text-center">
            <p className="text-xl font-bold text-[#854F0B]">{pendingCount}</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Pendientes</p>
          </div>
        </div>

        {isLoading ? <LoadingScreen /> : (
          <div className="card">
            <SectionTitle>Ultimas transacciones QR</SectionTitle>
            {payments.length === 0 ? (
              <p className="text-sm text-[#6B738A] text-center py-8">No hay transacciones aun</p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {payments.map((p: any) => (
                  <div key={p.id} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">
                        {p.bank_name || 'Sin confirmar'} · {p.bank_tx_id || 'QR pendiente'}
                      </p>
                      <p className="text-xs text-[#6B738A] mt-0.5">
                        {new Date(p.created_at).toLocaleString('es-BO')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold">Bs. {Number(p.amount).toFixed(2)}</p>
                      <p className="text-xs text-[#0F6E56]">prof. {Number(p.professional_net).toFixed(2)}</p>
                    </div>
                    <StatusBadge status={p.status} />
                    {['CONFIRMED', 'RELEASED_TO_PROFESSIONAL'].includes(p.status) && (
                      <button
                        onClick={() => setRefundModal({ id: p.id, amount: p.amount })}
                        className="text-xs text-[#A32D2D] hover:underline flex-shrink-0"
                      >
                        Reembolsar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {refundModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h3 className="text-base font-semibold mb-1">Procesar reembolso</h3>
              <p className="text-xs text-[#6B738A] mb-4">
                Monto: Bs. {Number(refundModal.amount).toFixed(2)}
              </p>
              <div className="mb-4">
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Motivo</label>
                <textarea
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] resize-none"
                  rows={3}
                  placeholder="Describe el motivo del reembolso (minimo 10 caracteres)..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setRefundModal(null); setRefundReason('') }}
                  className="flex-1 btn-secondary text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => refundMutation.mutate({ id: refundModal.id, type: 'FULL', reason: refundReason })}
                  disabled={refundReason.length < 10 || refundMutation.isPending}
                  className="flex-1 bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] py-2 rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {refundMutation.isPending ? 'Procesando...' : 'Confirmar reembolso'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
