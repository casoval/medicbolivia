'use client'
// src/app/admin/agent/page.tsx
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

export default function AdminAgentPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'agent-stats'],
    queryFn: () => api.get('/admin/agent-stats').then(r => r.data),
    refetchInterval: 30000,
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/agent" role="ADMIN">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Agente IA — Estadísticas</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Monitoreo del agente Medi en tiempo real</p>
        </div>

        {isLoading ? <LoadingScreen /> : stats ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 mb-5 sm:grid-cols-4">
              {[
                { label: 'Sesiones este mes',    value: stats.total_sessions,    color: '#185FA5' },
                { label: 'Latencia promedio',     value: `${stats.avg_latency_ms}ms`, color: '#0F6E56' },
                { label: 'Tokens usados',         value: Number(stats.total_tokens_month).toLocaleString(), color: '#854F0B' },
                { label: 'Guardrails activados',  value: stats.guardrail_triggers, color: '#A32D2D' },
              ].map(({ label, value, color }) => (
                <div key={label} className="card text-center py-4">
                  <p className="text-xl font-bold" style={{ color }}>{value}</p>
                  <p className="text-xs text-[#6B738A] mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* Configuración */}
            <div className="card">
              <SectionTitle>Configuración del agente</SectionTitle>
              <div className="space-y-0">
                {[
                  { label: 'Guardrail anti-diagnóstico', desc: 'Bloquea respuestas con diagnósticos médicos — NO deshabilitar', locked: true, on: true },
                  { label: 'Agente activo 24/7',         desc: 'El agente atiende pacientes todo el tiempo', locked: false, on: true },
                  { label: 'Derivación automática',       desc: 'Deriva si el profesional no responde en 60 segundos', locked: false, on: true },
                  { label: 'Onboarding automático',       desc: 'Guía a nuevos usuarios al registrarse', locked: false, on: true },
                ].map(({ label, desc, locked, on }) => (
                  <div key={label} className="flex items-center justify-between py-3 border-b border-[#DDE1EE] last:border-0">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-[#6B738A] mt-0.5">{desc}</p>
                    </div>
                    {locked ? (
                      <div className="flex items-center gap-2">
                        <span className="badge-red text-[10px]">Bloqueado</span>
                        <div className="w-9 h-5 bg-[#185FA5] rounded-full opacity-60 cursor-not-allowed" />
                      </div>
                    ) : (
                      <div className={`w-9 h-5 rounded-full cursor-pointer transition-colors ${on ? 'bg-[#185FA5]' : 'bg-[#DDE1EE]'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Modelo usado */}
            <div className="card mt-4">
              <SectionTitle>Modelo de IA activo</SectionTitle>
              <div className="flex items-center gap-3 p-3 bg-[#F5F6FA] rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-[#E6F1FB] flex items-center justify-center text-xs font-bold text-[#185FA5]">
                  AI
                </div>
                <div>
                  <p className="text-sm font-semibold">Claude Sonnet 4.6</p>
                  <p className="text-xs text-[#6B738A]">Anthropic · Modelo principal del agente Medi</p>
                </div>
                <span className="ml-auto badge-green">Activo</span>
              </div>
            </div>
          </>
        ) : (
          <div className="card text-center py-8">
            <p className="text-sm text-[#6B738A]">No se pudieron cargar las estadísticas</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
