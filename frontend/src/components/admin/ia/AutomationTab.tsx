'use client'
// src/components/admin/ia/AutomationTab.tsx
// Pestaña 4 — configuración de backups automáticos de la base de datos,
// enviados por correo (Gmail SMTP) al o los emails que se definan acá.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SectionTitle, Alert, LoadingScreen, EmptyState } from '@/components/ui'
import { whatsappAPI, getErrorMessage } from '@/lib/api'

interface BackupConfig {
  is_active: boolean
  frequency: 'DAILY' | 'WEEKLY'
  hour_utc: number
  recipient_emails: string[]
  include_full_dump: boolean
}

interface BackupLog {
  id: string
  status: 'SUCCESS' | 'FAILED'
  file_size_bytes: number | null
  recipients: string[]
  error_detail: string | null
  created_at: string
}

function utcHourToLocalLabel(hourUtc: number): string {
  // Bolivia es UTC-4 fijo (sin horario de verano).
  const local = (hourUtc - 4 + 24) % 24
  return `${local.toString().padStart(2, '0')}:00 hora Bolivia`
}

export function AutomationTab() {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [localConfig, setLocalConfig] = useState<BackupConfig | null>(null)

  const { data: config, isLoading } = useQuery<BackupConfig>({
    queryKey: ['admin', 'whatsapp', 'backup-config'],
    queryFn: async () => (await whatsappAPI.getBackupConfig()).data,
  })

  useEffect(() => { if (config) setLocalConfig(config) }, [config])

  const { data: logs = [], isLoading: loadingLogs } = useQuery<BackupLog[]>({
    queryKey: ['admin', 'whatsapp', 'backup-logs'],
    queryFn: async () => (await whatsappAPI.getBackupLogs()).data,
    refetchInterval: 20000,
  })

  const saveMutation = useMutation({
    mutationFn: (data: BackupConfig) => whatsappAPI.updateBackupConfig(data),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'backup-config'] }) },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const sendNowMutation = useMutation({
    mutationFn: () => whatsappAPI.sendBackupNow(),
    onSuccess: () => {
      setError('')
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'backup-logs'] }), 4000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  function addEmail() {
    const email = emailInput.trim()
    if (!localConfig || !email || !email.includes('@')) return
    if (localConfig.recipient_emails.includes(email)) return
    setLocalConfig({ ...localConfig, recipient_emails: [...localConfig.recipient_emails, email] })
    setEmailInput('')
  }

  function removeEmail(email: string) {
    if (!localConfig) return
    setLocalConfig({ ...localConfig, recipient_emails: localConfig.recipient_emails.filter((e) => e !== email) })
  }

  if (isLoading || !localConfig) return <LoadingScreen text="Cargando configuración de backups..." />

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <SectionTitle>Backups automáticos a Gmail</SectionTitle>
        <p className="text-xs text-[#6B738A] mb-3">
          Genera un dump comprimido de la base de datos y lo manda por correo con la frecuencia que definas acá.
          Requiere que el backend tenga configurado <code>GMAIL_SENDER_ADDRESS</code> y{' '}
          <code>GMAIL_APP_PASSWORD</code> (contraseña de aplicación, no la contraseña normal de Gmail).
        </p>

        {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

        <div className="flex items-center justify-between py-3 border-b border-[#DDE1EE]">
          <div>
            <p className="text-sm font-medium">Backups activos</p>
            <p className="text-xs text-[#6B738A] mt-0.5">Si está apagado, no se manda nada automáticamente</p>
          </div>
          <button
            onClick={() => setLocalConfig({ ...localConfig, is_active: !localConfig.is_active })}
            className={`w-9 h-5 rounded-full relative ${localConfig.is_active ? 'bg-[#185FA5]' : 'bg-[#DDE1EE]'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${localConfig.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 py-3 border-b border-[#DDE1EE]">
          <div>
            <label className="text-xs font-medium text-[#6B738A]">Frecuencia</label>
            <select
              className="input mt-1"
              value={localConfig.frequency}
              onChange={(e) => setLocalConfig({ ...localConfig, frequency: e.target.value as 'DAILY' | 'WEEKLY' })}
            >
              <option value="DAILY">Diaria</option>
              <option value="WEEKLY">Semanal (lunes)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[#6B738A]">Hora (UTC)</label>
            <input
              type="number" min={0} max={23} className="input mt-1"
              value={localConfig.hour_utc}
              onChange={(e) => setLocalConfig({ ...localConfig, hour_utc: Number(e.target.value) })}
            />
            <p className="text-[10px] text-[#6B738A] mt-1">{utcHourToLocalLabel(localConfig.hour_utc)}</p>
          </div>
        </div>

        <div className="py-3">
          <label className="text-xs font-medium text-[#6B738A]">Correos destinatarios</label>
          <div className="flex gap-2 mt-1">
            <input
              className="input flex-1" type="email" placeholder="tu-correo@gmail.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }}
            />
            <button type="button" className="btn-secondary" onClick={addEmail}>Agregar</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {localConfig.recipient_emails.map((email) => (
              <span key={email} className="badge-blue flex items-center gap-1.5">
                {email}
                <button onClick={() => removeEmail(email)} className="text-[#185FA5] hover:text-[#A32D2D]">×</button>
              </span>
            ))}
            {localConfig.recipient_emails.length === 0 && <p className="text-xs text-[#6B738A]">Sin destinatarios todavía</p>}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(localConfig)}>
            {saveMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button className="btn-secondary" disabled={sendNowMutation.isPending} onClick={() => sendNowMutation.mutate()}>
            {sendNowMutation.isPending ? 'Enviando...' : 'Enviar backup ahora'}
          </button>
        </div>
      </div>

      <div className="card p-4">
        <SectionTitle>Historial de envíos</SectionTitle>
        {loadingLogs ? (
          <LoadingScreen text="Cargando historial..." />
        ) : logs.length === 0 ? (
          <EmptyState title="Todavía no se envió ningún backup" />
        ) : (
          <div className="space-y-2 mt-2">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center justify-between text-xs py-2 border-b border-[#DDE1EE] last:border-0">
                <div>
                  <span className={log.status === 'SUCCESS' ? 'badge-green' : 'badge-red'}>{log.status === 'SUCCESS' ? 'Enviado' : 'Falló'}</span>
                  <span className="ml-2 text-[#6B738A]">{new Date(log.created_at).toLocaleString('es-BO')}</span>
                </div>
                <div className="text-[#6B738A] text-right">
                  {log.file_size_bytes && <span>{(log.file_size_bytes / 1024 / 1024).toFixed(1)} MB · </span>}
                  {log.error_detail ? <span className="text-[#A32D2D]">{log.error_detail}</span> : <span>{log.recipients.join(', ')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
