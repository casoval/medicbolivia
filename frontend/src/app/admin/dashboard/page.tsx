'use client'
// src/app/admin/dashboard/page.tsx
// Resumen general del panel de administración. Antes esta página también
// tenía pestañas propias para Profesionales/Pacientes/Pagos/Agente IA/
// Auditoría, duplicando (con menos funciones y algunos botones que no
// hacían nada) las páginas dedicadas que ya existen en el menú lateral
// (/admin/professionals, /admin/patients, /admin/payments, /admin/ia,
// /admin/logs). Se dejó solo el resumen, y se ampliaron las estadísticas
// para que el admin vea de un vistazo todo lo que está pasando en la
// plataforma sin tener que entrar sección por sección.
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { Alert, LoadingScreen, SectionTitle } from '@/components/ui'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { getGreeting } from '@/lib/greeting'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const adminAPI = {
  stats: () => api.get('/admin/stats'),
}

// ── Subcomponente: tarjeta de estadística ─────────────
function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="card py-3 text-center">
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs text-[#6B738A] mt-0.5">{label}</p>
    </div>
  )
}

export default function AdminDashboard() {
  const { t } = useLanguage()
  const { user } = useAuthStore()

  const { data: stats, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminAPI.stats().then((r) => r.data),
    refetchInterval: 30_000,
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/dashboard" role="ADMIN">
      <div className="max-w-4xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold">
              {getGreeting()}{user?.first_name ? `, ${user.first_name}` : ''} · Panel de administración
            </h1>
            <p className="text-xs text-[#6B738A] mt-0.5">{t('Resumen general de MedicBolivia')}</p>
          </div>
          <div className="flex items-center gap-1.5 bg-[#E1F5EE] border border-[#9FE1CB] rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] animate-pulse-dot" />
            <span className="text-xs text-[#0F6E56] font-medium">{t('Sistema operativo')}</span>
          </div>
        </div>

        {isError && (
          <div className="mb-4"><Alert type="error" message={getErrorMessage(error)} /></div>
        )}

        {isLoading ? (
          <LoadingScreen text="Cargando estadísticas..." />
        ) : stats ? (
          <>
            {/* Alerta de profesionales pendientes */}
            {stats.professionals_pending > 0 && (
              <div className="card bg-[#FAEEDA] border-[#FAC775] mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#EF9F27]" />
                    <p className="text-sm font-medium text-[#854F0B]">
                      {stats.professionals_pending} profesional{stats.professionals_pending > 1 ? 'es' : ''} pendiente{stats.professionals_pending > 1 ? 's' : ''} de verificación
                    </p>
                  </div>
                  <a
                    href="/admin/professionals?tab=PENDING_DOCS"
                    className="text-xs text-[#854F0B] font-medium hover:underline"
                  >
                    {t('Revisar →')}
                  </a>
                </div>
              </div>
            )}

            {/* ── Plataforma en general ────────────────── */}
            <div className="mb-4">
              <SectionTitle>{t('Plataforma')}</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <StatCard label="Pacientes registrados" value={stats.patients} color="#141820" />
                <StatCard label="Profesionales activos" value={stats.professionals_active} color="#185FA5" />
                <StatCard label="Consultas este mes" value={stats.monthly_consultations} color="#0F6E56" />
                <StatCard label="Ingresos del mes" value={`Bs. ${Math.round(stats.monthly_revenue).toLocaleString()}`} color="#854F0B" />
                <StatCard label="Comisión plataforma" value={`Bs. ${Math.round(stats.platform_fee_month).toLocaleString()}`} color="#854F0B" />
              </div>
            </div>

            {/* ── En este momento (tiempo real) ────────── */}
            <div className="mb-4">
              <SectionTitle>{t('En este momento')}</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#E1F5EE] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#0F6E56]">{stats.active_now}</p>
                  <p className="text-xs text-[#0F6E56] mt-0.5">{t('En videollamada')}</p>
                </div>
                <div className="bg-[#FAEEDA] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#854F0B]">{stats.waiting_professional}</p>
                  <p className="text-xs text-[#854F0B] mt-0.5">{t('Buscando profesional')}</p>
                </div>
                <div className="bg-[#E6F1FB] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#185FA5]">{stats.waiting_payment}</p>
                  <p className="text-xs text-[#185FA5] mt-0.5">{t('Esperando pago QR')}</p>
                </div>
                <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#141820]">{stats.scheduled_pending}</p>
                  <p className="text-xs text-[#6B738A] mt-0.5">{t('Citas agendadas pendientes')}</p>
                </div>
              </div>
            </div>

            {/* ── Calidad de servicio y agente IA este mes ── */}
            <div className="mb-4">
              <SectionTitle>{t('Calidad de servicio y agente IA (este mes)')}</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Sesiones del agente IA" value={stats.agent_sessions_month} color="#7F77DD" />
                <StatCard label="No-show pacientes" value={stats.no_show_patient_month} color="#A32D2D" />
                <StatCard label="No-show profesionales" value={stats.no_show_professional_month} color="#A32D2D" />
                <StatCard label="Cancelaciones con reembolso" value={stats.cancelled_with_refund_month} color="#E24B4A" />
              </div>
            </div>

            {/* ── Accesos rápidos ───────────────────────── */}
            <div className="card">
              <SectionTitle>{t('Accesos rápidos')}</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <a href="/admin/professionals" className="text-xs text-[#185FA5] hover:underline p-2 bg-[#F5F6FA] rounded-lg text-center">{t('Gestionar profesionales')}</a>
                <a href="/admin/patients" className="text-xs text-[#185FA5] hover:underline p-2 bg-[#F5F6FA] rounded-lg text-center">{t('Gestionar pacientes')}</a>
                <a href="/admin/payments" className="text-xs text-[#185FA5] hover:underline p-2 bg-[#F5F6FA] rounded-lg text-center">{t('Ver pagos')}</a>
                <a href="/admin/ia" className="text-xs text-[#185FA5] hover:underline p-2 bg-[#F5F6FA] rounded-lg text-center">{t('IA / WhatsApp')}</a>
                <a href="/admin/logs" className="text-xs text-[#185FA5] hover:underline p-2 bg-[#F5F6FA] rounded-lg text-center">{t('Auditoría')}</a>
                <a href="/admin/settings" className="text-xs text-[#185FA5] hover:underline p-2 bg-[#F5F6FA] rounded-lg text-center">{t('Configuración')}</a>
              </div>
            </div>
          </>
        ) : null}

      </div>
    </DashboardLayout>
  )
}
