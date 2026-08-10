'use client'
// src/app/admin/reports/page.tsx
// Métricas de tendencia y desglose que /admin/dashboard no puede
// responder (ese es un snapshot de "ahora / este mes" — ver
// backend/app/api/v1/endpoints/admin_reports.py para el porqué de la
// separación). Todo lo de acá acepta rango de fechas, salvo la
// tendencia mensual (que pide "últimos N meses") y la recurrencia
// (que mira todo el historial a propósito, ver nota en el backend).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Cell,
} from 'recharts'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { Alert, LoadingScreen, SectionTitle, EmptyState } from '@/components/ui'
import { adminReportsAPI, getErrorMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const COLORS = ['#185FA5', '#0F6E56', '#854F0B', '#7F77DD', '#A32D2D', '#EF9F27', '#64748B']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function monthStartISO() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}
function bs(n: number) {
  return `Bs. ${Math.round(n).toLocaleString()}`
}

function StatCard({ label, value, color, hint }: { label: string; value: string | number; color: string; hint?: string }) {
  return (
    <div className="card py-3 text-center">
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs text-[#475569] mt-0.5">{label}</p>
      {hint && <p className="text-[10px] text-[#94A3B8] mt-0.5">{hint}</p>}
    </div>
  )
}

// Tooltip custom simple, en vez del default de recharts (que no
// respeta el formato de moneda ni los labels en español).
function CurrencyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-[#DDE1EE] rounded-lg px-3 py-2 shadow-sm text-xs">
      <p className="font-medium text-[#141820] mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && p.dataKey !== 'consultations_count' ? bs(p.value) : p.value}
        </p>
      ))}
    </div>
  )
}

export default function AdminReportsPage() {
  const { t } = useLanguage()
  const [dateFrom, setDateFrom] = useState(monthStartISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [trendMonths, setTrendMonths] = useState(6)
  const [rankingOrder, setRankingOrder] = useState<'revenue' | 'consultations' | 'rating' | 'no_show_rate'>('revenue')

  const trendQuery = useQuery({
    queryKey: ['admin', 'reports', 'revenue-trend', trendMonths],
    queryFn: () => adminReportsAPI.revenueTrend(trendMonths),
  })
  const specialtyQuery = useQuery({
    queryKey: ['admin', 'reports', 'revenue-by-specialty', dateFrom, dateTo],
    queryFn: () => adminReportsAPI.revenueBySpecialty(dateFrom, dateTo),
  })
  const funnelQuery = useQuery({
    queryKey: ['admin', 'reports', 'funnel', dateFrom, dateTo],
    queryFn: () => adminReportsAPI.funnel(dateFrom, dateTo),
  })
  const retentionQuery = useQuery({
    queryKey: ['admin', 'reports', 'retention'],
    queryFn: () => adminReportsAPI.retention(),
  })
  const rankingQuery = useQuery({
    queryKey: ['admin', 'reports', 'professionals-ranking', dateFrom, dateTo, rankingOrder],
    queryFn: () => adminReportsAPI.professionalsRanking(dateFrom, dateTo, rankingOrder),
  })
  const agentQuery = useQuery({
    queryKey: ['admin', 'reports', 'agent-conversion', dateFrom, dateTo],
    queryFn: () => adminReportsAPI.agentConversion(dateFrom, dateTo),
  })

  const rankingLabels: Record<typeof rankingOrder, string> = {
    revenue: 'Ingresos generados',
    consultations: 'Consultas',
    rating: 'Calificación',
    no_show_rate: 'Tasa de no-show',
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/reports" role="ADMIN">
      <div className="max-w-5xl">

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Reportes de negocio')}</h1>
          <p className="text-xs text-[#475569] mt-0.5">
            {t('Tendencias, embudo de conversión, retención y ranking de profesionales. Para el vistazo rápido de hoy, ver')}{' '}
            <a href="/admin/dashboard" className="text-[#185FA5] hover:underline">{t('Resumen')}</a>.
          </p>
        </div>

        {/* Filtro de rango de fechas — afecta especialidad, embudo, ranking y agente IA. La tendencia mensual y la recurrencia tienen su propio criterio (ver más abajo). */}
        <div className="card mb-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-[10px] font-medium text-[#475569] mb-1">{t('Desde')}</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-xs focus:outline-none focus:border-[#185FA5]" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#475569] mb-1">{t('Hasta')}</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-xs focus:outline-none focus:border-[#185FA5]" />
            </div>
            <p className="text-[10px] text-[#94A3B8] pb-1.5">
              {t('Aplica a: ingresos por especialidad, embudo, ranking de profesionales y conversión del agente IA.')}
            </p>
          </div>
        </div>

        {/* ── 1) Tendencia de ingresos ──────────────────────── */}
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-1">
            <SectionTitle>{t('Tendencia de ingresos')}</SectionTitle>
            <div className="flex gap-1">
              {[3, 6, 12].map((m) => (
                <button key={m} onClick={() => setTrendMonths(m)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${trendMonths === m ? 'bg-[#185FA5] text-white border-[#185FA5]' : 'border-[#DDE1EE] text-[#475569]'}`}>
                  {m}m
                </button>
              ))}
            </div>
          </div>
          {trendQuery.isError && <Alert type="error" message={getErrorMessage(trendQuery.error)} />}
          {trendQuery.isLoading ? <LoadingScreen text="Cargando tendencia..." /> : trendQuery.data && (
            <>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <ComposedChart data={trendQuery.data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip content={<CurrencyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="gmv" name="Volumen transaccionado (GMV)" fill="#B9CEE4" radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="total_platform_revenue" name="Ingreso real de la plataforma" stroke="#185FA5" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-[#94A3B8] mt-1">
                {t('Ingreso real = comisión efectivamente cobrada (después de promos/membresías) + cuotas de membresía. Nunca es un % fijo del GMV.')}
              </p>
            </>
          )}
        </div>

        {/* ── 2) Ingresos por especialidad ──────────────────── */}
        <div className="card mb-4">
          <SectionTitle>{t('Ingresos por especialidad')}</SectionTitle>
          {specialtyQuery.isError && <Alert type="error" message={getErrorMessage(specialtyQuery.error)} />}
          {specialtyQuery.isLoading ? <LoadingScreen text="Cargando..." /> : specialtyQuery.data && (
            specialtyQuery.data.length === 0 ? (
              <EmptyState title={t('Sin consultas pagadas en este rango')} />
            ) : (
              <>
                <div style={{ width: '100%', height: Math.max(160, specialtyQuery.data.length * 46) }}>
                  <ResponsiveContainer>
                    <BarChart data={specialtyQuery.data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <YAxis type="category" dataKey="specialty" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip content={<CurrencyTooltip />} />
                      <Bar dataKey="gmv" name="Volumen (GMV)" radius={[0, 4, 4, 0]}>
                        {specialtyQuery.data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#94A3B8] border-b border-[#EEF1F6]">
                        <th className="py-1.5 font-medium">{t('Especialidad')}</th>
                        <th className="py-1.5 font-medium text-right">{t('Consultas')}</th>
                        <th className="py-1.5 font-medium text-right">{t('Ticket prom.')}</th>
                        <th className="py-1.5 font-medium text-right">{t('% del GMV')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specialtyQuery.data.map((s) => (
                        <tr key={s.specialty} className="border-b border-[#F5F6FA]">
                          <td className="py-1.5">{s.specialty}</td>
                          <td className="py-1.5 text-right">{s.consultations_count}</td>
                          <td className="py-1.5 text-right">{bs(s.avg_ticket)}</td>
                          <td className="py-1.5 text-right">{s.pct_of_total_gmv}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </div>

        {/* ── 3) Embudo de conversión ────────────────────────── */}
        <div className="card mb-4">
          <SectionTitle>{t('Embudo de conversión')}</SectionTitle>
          {funnelQuery.isError && <Alert type="error" message={getErrorMessage(funnelQuery.error)} />}
          {funnelQuery.isLoading ? <LoadingScreen text="Cargando..." /> : funnelQuery.data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <StatCard label="Consultas creadas" value={funnelQuery.data.total_created} color="#141820" />
                <StatCard label="Llegaron a pagarse" value={`${funnelQuery.data.pct_reached_payment}%`} color="#185FA5"
                  hint={`${funnelQuery.data.reached_payment} de ${funnelQuery.data.total_created}`} />
                <StatCard label="Completadas" value={`${funnelQuery.data.pct_completed}%`} color="#0F6E56"
                  hint={`${funnelQuery.data.completed} de ${funnelQuery.data.total_created}`} />
                <StatCard label="Canceladas" value={`${funnelQuery.data.pct_cancelled}%`} color="#A32D2D"
                  hint={`${funnelQuery.data.cancelled} de ${funnelQuery.data.total_created}`} />
              </div>
              {funnelQuery.data.outcome_note_breakdown.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[#475569] mb-1.5">{t('Motivo exacto (outcome_note) de las que no se completaron')}</p>
                  <div className="space-y-1">
                    {funnelQuery.data.outcome_note_breakdown.map((r) => (
                      <div key={r.outcome_note} className="flex items-center gap-2 text-xs">
                        <span className="w-56 truncate text-[#475569]">{r.outcome_note}</span>
                        <div className="flex-1 bg-[#F5F6FA] rounded-full h-2 overflow-hidden">
                          <div className="bg-[#A32D2D] h-2 rounded-full"
                            style={{ width: `${Math.min(100, r.count / funnelQuery.data!.total_created * 100)}%` }} />
                        </div>
                        <span className="w-8 text-right text-[#141820] font-medium">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── 4) Retención ──────────────────────────────────── */}
        <div className="card mb-4">
          <div className="flex items-center justify-between">
            <SectionTitle>{t('Retención')}</SectionTitle>
            <span className="text-[10px] text-[#94A3B8]">{t('Todo el historial, no el rango de fechas de arriba')}</span>
          </div>
          {retentionQuery.isError && <Alert type="error" message={getErrorMessage(retentionQuery.error)} />}
          {retentionQuery.isLoading ? <LoadingScreen text="Cargando..." /> : retentionQuery.data && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-[#475569] mb-2">{t('Pacientes')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Con consulta completada" value={retentionQuery.data.patients.total_with_completed_consultation} color="#141820" />
                  <StatCard label="Recurrentes (2+)" value={`${retentionQuery.data.patients.pct_recurring}%`} color="#0F6E56"
                    hint={`${retentionQuery.data.patients.recurring_2plus} pacientes`} />
                </div>
                <p className="text-[10px] text-[#94A3B8] mt-2">
                  {t('Promedio entre 1ra y última consulta (recurrentes):')} {retentionQuery.data.patients.avg_days_between_first_and_last_for_recurring} {t('días')}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-[#475569] mb-2">{t('Profesionales')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Activos" value={retentionQuery.data.professionals.total_active} color="#141820" />
                  <StatCard label="Con paciente que repite" value={`${retentionQuery.data.professionals.pct_with_repeat_patient}%`} color="#7F77DD"
                    hint={`${retentionQuery.data.professionals.with_repeat_patient} profesionales`} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 5) Ranking de profesionales ───────────────────── */}
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <SectionTitle>{t('Ranking de profesionales')}</SectionTitle>
            <div className="flex gap-1 flex-wrap">
              {(Object.keys(rankingLabels) as (typeof rankingOrder)[]).map((k) => (
                <button key={k} onClick={() => setRankingOrder(k)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${rankingOrder === k ? 'bg-[#185FA5] text-white border-[#185FA5]' : 'border-[#DDE1EE] text-[#475569]'}`}>
                  {t(rankingLabels[k])}
                </button>
              ))}
            </div>
          </div>
          {rankingQuery.isError && <Alert type="error" message={getErrorMessage(rankingQuery.error)} />}
          {rankingQuery.isLoading ? <LoadingScreen text="Cargando..." /> : rankingQuery.data && (
            rankingQuery.data.length === 0 ? (
              <EmptyState title={t('Sin consultas en este rango')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[#94A3B8] border-b border-[#EEF1F6]">
                      <th className="py-1.5 font-medium">{t('Profesional')}</th>
                      <th className="py-1.5 font-medium">{t('Especialidad')}</th>
                      <th className="py-1.5 font-medium text-right">{t('Consultas')}</th>
                      <th className="py-1.5 font-medium text-right">{t('Ingresos')}</th>
                      <th className="py-1.5 font-medium text-right">{t('No-show')}</th>
                      <th className="py-1.5 font-medium text-right">{t('Rating')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingQuery.data.map((p) => (
                      <tr key={p.professional_id} className="border-b border-[#F5F6FA]">
                        <td className="py-1.5 font-medium text-[#141820]">{p.name}</td>
                        <td className="py-1.5 text-[#475569]">{p.specialty}</td>
                        <td className="py-1.5 text-right">{p.completed_consultations}/{p.total_consultations}</td>
                        <td className="py-1.5 text-right">{bs(p.revenue_generated)}</td>
                        <td className="py-1.5 text-right" style={{ color: p.no_show_rate > 0 ? '#A32D2D' : undefined }}>{p.no_show_rate}%</td>
                        <td className="py-1.5 text-right">{p.average_rating != null ? `★ ${p.average_rating.toFixed(1)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* ── 6) Conversión del agente IA (aproximado) ──────── */}
        <div className="card mb-4">
          <SectionTitle>{t('Conversión del agente IA')}</SectionTitle>
          {agentQuery.isError && <Alert type="error" message={getErrorMessage(agentQuery.error)} />}
          {agentQuery.isLoading ? <LoadingScreen text="Cargando..." /> : agentQuery.data && (
            <>
              <div className="grid grid-cols-3 gap-3 mb-2">
                <StatCard label="Usuarios que usaron el agente" value={agentQuery.data.users_with_agent_session} color="#7F77DD" />
                <StatCard label="De esos, pagaron una consulta" value={agentQuery.data.of_those_who_paid} color="#0F6E56" />
                <StatCard label="Conversión aproximada" value={`${agentQuery.data.pct_conversion_approx}%`} color="#185FA5" />
              </div>
              <Alert type="info" message={t(agentQuery.data.note)} />
            </>
          )}
        </div>

      </div>
    </DashboardLayout>
  )
}
