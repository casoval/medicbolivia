'use client'
// src/app/admin/settings/page.tsx
import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Alert, SectionTitle } from '@/components/ui'

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

export default function AdminSettingsPage() {
  const [success, setSuccess] = useState('')
  const [appName, setAppName] = useState('MedicBolivia')
  const [commission, setCommission] = useState(15)
  const [openRegistration, setOpenRegistration] = useState(true)
  const [openProfessionals, setOpenProfessionals] = useState(true)
  const [maintenance, setMaintenance] = useState(false)
  const [alerts, setAlerts] = useState({
    noResponse: true,
    dailyReport: true,
    pendingPayment: true,
    lowRating: true,
    newProfessional: true,
  })

  function saveSettings() {
    setSuccess('Configuración guardada correctamente')
    setTimeout(() => setSuccess(''), 3000)
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/settings" role="ADMIN">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Configuración de la plataforma</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Ajustes generales de MedicBolivia</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Configuración general */}
          <div className="card">
            <SectionTitle>General</SectionTitle>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#6B738A] mb-1">Nombre de la plataforma</label>
                <input
                  className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  value={appName}
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
                    className="w-20 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                    value={commission}
                    onChange={(e) => setCommission(Number(e.target.value))}
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
                  <Toggle on={openRegistration} onChange={setOpenRegistration} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Registro de profesionales</p>
                    <p className="text-xs text-[#6B738A]">Permite nuevos profesionales</p>
                  </div>
                  <Toggle on={openProfessionals} onChange={setOpenProfessionals} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Modo mantenimiento</p>
                    <p className="text-xs text-[#6B738A] text-[#A32D2D]">Bloquea el acceso a usuarios</p>
                  </div>
                  <Toggle on={maintenance} onChange={setMaintenance} />
                </div>
              </div>

              <button onClick={saveSettings} className="btn-primary w-full text-xs py-2">
                Guardar configuración
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
                    on={alerts[key as keyof typeof alerts]}
                    onChange={(v) => setAlerts((prev) => ({ ...prev, [key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>

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
