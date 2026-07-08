'use client'
// src/app/admin/settings/page.tsx
import { useEffect, useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { Alert, SectionTitle } from '@/components/ui'
import { adminAPI, getErrorMessage, type PlatformSettings, type PlatformSettingsUpdate } from '@/lib/api'

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

          {/* Info del sistema */}
          <div className="card lg:col-span-2">
            <SectionTitle>Información del sistema</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Versión',   value: 'v1.0.0' },
                { label: 'Backend',   value: 'FastAPI 0.111' },
                { label: 'Base de datos', value: 'PostgreSQL 15' },
                { label: 'Agente IA', value: 'Claude Sonnet 4.6' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-[#F5F6FA] rounded-lg p-3 text-center">
                  <p className="text-xs text-[#6B738A]">{label}</p>
                  <p className="text-sm font-semibold mt-1">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}