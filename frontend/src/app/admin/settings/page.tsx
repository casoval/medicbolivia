'use client'
// src/app/admin/settings/page.tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { Alert, SectionTitle } from '@/components/ui'
import {
  adminAPI, getErrorMessage,
  type PlatformSettings, type PlatformSettingsUpdate, type CommissionPeriod,
} from '@/lib/api'

function Toggle({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange?.(!on)}
      disabled={disabled}
      className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
        on ? 'bg-[#185FA5]' : 'bg-[#DDE1EE]'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
        on ? 'translate-x-5' : 'translate-x-1'
      }`} />
    </button>
  )
}

type AlertsState = {
  noResponse: boolean
  dailyReport: boolean
  pendingPayment: boolean
  lowRating: boolean
  newProfessional: boolean
}

const DEFAULT_ALERTS: AlertsState = {
  noResponse: true,
  dailyReport: true,
  pendingPayment: true,
  lowRating: true,
  newProfessional: true,
}

// El backend usa snake_case y agrupa las alertas; el formulario usa camelCase plano.
// Estas dos funciones son el único lugar donde se traduce entre ambos formatos.
function fromApi(data: PlatformSettings) {
  return {
    appName: data.app_name,
    commission: data.commission_percent,
    openRegistration: data.open_registration_patients,
    openProfessionals: data.open_registration_professionals,
    maintenance: data.maintenance_mode,
    alerts: {
      noResponse: data.alerts.no_response,
      dailyReport: data.alerts.daily_report,
      pendingPayment: data.alerts.pending_payment,
      lowRating: data.alerts.low_rating,
      newProfessional: data.alerts.new_professional,
    } as AlertsState,
  }
}

function toApiPayload(state: {
  appName: string
  commission: number
  openRegistration: boolean
  openProfessionals: boolean
  maintenance: boolean
  alerts: AlertsState
}): PlatformSettingsUpdate {
  return {
    app_name: state.appName,
    commission_percent: state.commission,
    open_registration_patients: state.openRegistration,
    open_registration_professionals: state.openProfessionals,
    maintenance_mode: state.maintenance,
    alert_no_response: state.alerts.noResponse,
    alert_daily_report: state.alerts.dailyReport,
    alert_pending_payment: state.alerts.pendingPayment,
    alert_low_rating: state.alerts.lowRating,
    alert_new_professional: state.alerts.newProfessional,
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Gestión de promociones de comisión a nivel de TODA la plataforma
// (scope=GLOBAL). Para comisiones individuales por profesional, ver el
// perfil de cada profesional en Admin → Profesionales.
function CommissionPeriodsSection() {
  const [periods, setPeriods] = useState<CommissionPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const [percent, setPercent] = useState('10')
  const [label, setLabel] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')

  function load() {
    setLoading(true)
    adminAPI.listCommissionPeriods({ scope: 'GLOBAL' })
      .then(setPeriods)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function createPeriod() {
    setError('')
    const p = Number(percent)
    if (Number.isNaN(p) || p < 0 || p > 100) {
      setError('El porcentaje debe estar entre 0 y 100')
      return
    }
    if (!startsAt) {
      setError('Indica la fecha de inicio de la promoción')
      return
    }
    setCreating(true)
    try {
      await adminAPI.createCommissionPeriod({
        scope: 'GLOBAL',
        percent: p,
        label: label || undefined,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      })
      setLabel('')
      setStartsAt('')
      setEndsAt('')
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  async function deactivate(id: string) {
    try {
      await adminAPI.deactivateCommissionPeriod(id)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const now = Date.now()

  return (
    <div className="card lg:col-span-2">
      <SectionTitle>Promociones de comisión (toda la plataforma)</SectionTitle>
      <p className="text-xs text-[#6B738A] mb-3">
        Crea periodos con % distinto al de la comisión por defecto de arriba — por ejemplo, 10% este mes y 15% el próximo.
        Las consultas ya cobradas conservan el % que estaba vigente cuando se generaron, nunca se recalculan.
        Para dar un % distinto a un profesional puntual (ej. promo de bienvenida), hazlo desde su perfil en{' '}
        <span className="font-medium">Profesionales</span>.
      </p>

      {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end mb-4 bg-[#F5F6FA] rounded-lg p-3">
        <div>
          <label className="block text-xs font-medium text-[#6B738A] mb-1">% comisión</label>
          <input
            type="number" min={0} max={100}
            className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-[#6B738A] mb-1">Etiqueta (opcional)</label>
          <input
            className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            placeholder="Promo julio"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B738A] mb-1">Desde</label>
          <input
            type="date"
            className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B738A] mb-1">Hasta (opcional)</label>
          <input
            type="date"
            className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
        <button
          onClick={createPeriod}
          disabled={creating}
          className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60"
        >
          {creating ? 'Creando…' : 'Crear promoción'}
        </button>
      </div>

      {loading ? (
        <div className="h-16 animate-pulse bg-[#F5F6FA] rounded-lg" />
      ) : periods.length === 0 ? (
        <p className="text-xs text-[#A0A8BF]">No hay promociones globales configuradas. Se usa la comisión por defecto.</p>
      ) : (
        <div className="space-y-2">
          {periods.map((p) => {
            const started = new Date(p.starts_at).getTime()
            const ended = p.ends_at ? new Date(p.ends_at).getTime() : null
            const isCurrent = p.active && started <= now && (!ended || ended > now)
            const isFuture = p.active && started > now
            return (
              <div key={p.id} className="flex items-center justify-between bg-[#F5F6FA] rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-medium">
                    {p.percent}% {p.label && <span className="text-[#6B738A] font-normal">— {p.label}</span>}
                  </p>
                  <p className="text-xs text-[#A0A8BF]">
                    Desde {fmtDate(p.starts_at)} {p.ends_at ? `hasta ${fmtDate(p.ends_at)}` : '· sin fecha de fin'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!p.active ? (
                    <span className="text-xs text-[#A0A8BF]">Desactivada</span>
                  ) : isCurrent ? (
                    <span className="text-xs text-[#0F6E56] font-medium">● Vigente ahora</span>
                  ) : isFuture ? (
                    <span className="text-xs text-[#185FA5] font-medium">Programada</span>
                  ) : (
                    <span className="text-xs text-[#A0A8BF]">Finalizada</span>
                  )}
                  {p.active && (
                    <button
                      onClick={() => deactivate(p.id)}
                      className="text-xs text-[#A32D2D] hover:underline"
                    >
                      Desactivar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [appName, setAppName] = useState('MedicBolivia')
  const [commission, setCommission] = useState(15)
  const [openRegistration, setOpenRegistration] = useState(true)
  const [openProfessionals, setOpenProfessionals] = useState(true)
  const [maintenance, setMaintenance] = useState(false)
  const [alerts, setAlerts] = useState<AlertsState>(DEFAULT_ALERTS)

  const { data: systemInfo, isLoading: loadingSystemInfo } = useQuery({
    queryKey: ['admin', 'system-info'],
    queryFn: () => adminAPI.getSystemInfo(),
  })

  useEffect(() => {
    let active = true
    adminAPI.getSettings()
      .then((data) => {
        if (!active) return
        const mapped = fromApi(data)
        setAppName(mapped.appName)
        setCommission(mapped.commission)
        setOpenRegistration(mapped.openRegistration)
        setOpenProfessionals(mapped.openProfessionals)
        setMaintenance(mapped.maintenance)
        setAlerts(mapped.alerts)
      })
      .catch((err) => {
        if (!active) return
        setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  async function saveSettings() {
    setSaving(true)
    setError('')
    try {
      const data = await adminAPI.updateSettings(
        toApiPayload({ appName, commission, openRegistration, openProfessionals, maintenance, alerts })
      )
      const mapped = fromApi(data)
      setAppName(mapped.appName)
      setCommission(mapped.commission)
      setOpenRegistration(mapped.openRegistration)
      setOpenProfessionals(mapped.openProfessionals)
      setMaintenance(mapped.maintenance)
      setAlerts(mapped.alerts)
      setSuccess('Configuración guardada correctamente')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function handleCommissionChange(raw: string) {
    const n = Number(raw)
    if (Number.isNaN(n)) return
    setCommission(Math.min(30, Math.max(0, n)))
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/settings" role="ADMIN">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Configuración de la plataforma</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Ajustes generales de MedicBolivia</p>
        </div>

        {error && <div className="mb-4"><Alert type="error" message={error} /></div>}
        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {loading ? (
            <>
              <div className="card h-72 animate-pulse bg-[#F5F6FA]" />
              <div className="card h-72 animate-pulse bg-[#F5F6FA]" />
            </>
          ) : (
            <>
              {/* Configuración general */}
              <div className="card">
                <SectionTitle>General</SectionTitle>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#6B738A] mb-1">Nombre de la plataforma</label>
                    <input
                      className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] disabled:opacity-60"
                      value={appName}
                      disabled={saving}
                      onChange={(e) => setAppName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#6B738A] mb-1">
                      Comisión de la plataforma (%)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={30}
                        disabled={saving}
                        className="w-20 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] disabled:opacity-60"
                        value={commission}
                        onChange={(e) => handleCommissionChange(e.target.value)}
                      />
                      <span className="text-xs text-[#6B738A]">%</span>
                      <span className="text-xs text-[#A0A8BF]">
                        → Profesional recibe {100 - commission}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-[#DDE1EE]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Registro de pacientes</p>
                        <p className="text-xs text-[#6B738A]">Permite nuevos registros</p>
                      </div>
                      <Toggle on={openRegistration} onChange={setOpenRegistration} disabled={saving} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Registro de profesionales</p>
                        <p className="text-xs text-[#6B738A]">Permite nuevos profesionales</p>
                      </div>
                      <Toggle on={openProfessionals} onChange={setOpenProfessionals} disabled={saving} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Modo mantenimiento</p>
                        <p className="text-xs text-[#A32D2D]">Bloquea el acceso a usuarios</p>
                      </div>
                      <Toggle on={maintenance} onChange={setMaintenance} disabled={saving} />
                    </div>
                  </div>

                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="btn-primary w-full text-xs py-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Guardando…' : 'Guardar configuración'}
                  </button>
                </div>
              </div>

              {/* Alertas automáticas */}
              <div className="card">
                <SectionTitle>Alertas automáticas</SectionTitle>
                <div className="space-y-0">
                  {[
                    { key: 'noResponse',      label: 'Profesional sin responder',  desc: 'Notificar si un profesional no responde en 5 min' },
                    { key: 'dailyReport',     label: 'Reporte diario por email',   desc: 'Resumen de consultas y pagos del día' },
                    { key: 'pendingPayment',  label: 'Pago pendiente +2 horas',    desc: 'Alerta si un QR no se confirma' },
                    { key: 'lowRating',       label: 'Calificación baja (1-2 ★)',  desc: 'Notificar cuando un profesional recibe mala nota' },
                    { key: 'newProfessional', label: 'Nuevo profesional registrado', desc: 'Avisar cuando hay documentos para revisar' },
                  ].map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between py-3 border-b border-[#DDE1EE] last:border-0">
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-[#6B738A]">{desc}</p>
                      </div>
                      <Toggle
                        on={alerts[key as keyof AlertsState]}
                        disabled={saving}
                        onChange={(v) => setAlerts((prev) => ({ ...prev, [key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Promociones de comisión global */}
          <CommissionPeriodsSection />

          {/* Info del sistema — datos reales desde /admin/system-info, no hardcodeados */}
          <div className="card lg:col-span-2">
            <SectionTitle>Información del sistema</SectionTitle>
            {loadingSystemInfo ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-[#F5F6FA] animate-pulse" />
                ))}
              </div>
            ) : systemInfo ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Versión',        value: `v${systemInfo.app_version}` },
                  { label: 'Entorno',        value: systemInfo.environment },
                  { label: 'Backend',        value: systemInfo.backend },
                  { label: 'Base de datos',  value: systemInfo.database },
                  { label: 'Frontend',       value: systemInfo.frontend },
                  { label: 'Agente IA',      value: `${systemInfo.ai_agent_provider} (${systemInfo.ai_agent_model})` },
                  { label: 'WhatsApp',       value: systemInfo.whatsapp_engine },
                  { label: 'Tareas en segundo plano', value: systemInfo.background_jobs },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[#F5F6FA] rounded-lg p-3 text-center">
                    <p className="text-xs text-[#6B738A]">{label}</p>
                    <p className="text-sm font-semibold mt-1 break-words">{value}</p>
                  </div>
                ))}
                <div className="bg-[#F5F6FA] rounded-lg p-3 text-center col-span-2 sm:col-span-4">
                  <p className="text-xs text-[#6B738A]">Hora del servidor (UTC)</p>
                  <p className="text-sm font-semibold mt-1">
                    {new Date(systemInfo.server_time_utc).toLocaleString('es-BO', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' })}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#6B738A] text-center py-4">No se pudo cargar la información del sistema</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}