'use client'
// src/components/admin/ia/RemindersTab.tsx
// Pestaña 2 — reglas de recordatorio/aviso automático por WhatsApp,
// separadas por audiencia (paciente/profesional/admin) y por tipo de
// disparador (evento instantáneo vs. cron antes de una cita agendada).

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, LoadingScreen, EmptyState } from '@/components/ui'
import { whatsappAPI, getErrorMessage } from '@/lib/api'

const TRIGGER_LABEL: Record<string, string> = {
  IMMEDIATE_CONSULTATION_WAITING: 'Paciente esperando (consulta inmediata)',
  IMMEDIATE_CONSULTATION_PAID: 'Pago de consulta inmediata',
  IMMEDIATE_CONSULTATION_CANCELLED: 'Cancelación de consulta inmediata',
  SCHEDULED_APPOINTMENT_REMINDER: 'Antes de una cita agendada',
  SCHEDULED_APPOINTMENT_PAID: 'Pago de cita agendada',
  UNREAD_MESSAGES_8PM: 'Mensajes sin leer (20:00)',
  APPOINTMENT_RESCHEDULE_PROPOSED: 'Propuesta de reprogramación',
  APPOINTMENT_CANCELLED_BY_PATIENT: 'Cancelación por el paciente',
  APPOINTMENT_CANCELLED_BY_PROFESSIONAL: 'Cancelación por el profesional',
  PAYMENT_PENDING: 'Pago pendiente',
  PRESCRIPTION_ISSUED: 'Receta emitida',
  RATING_REQUEST: 'Pedido de calificación',
  CUSTOM: 'Personalizado',
}

const AUDIENCE_LABEL: Record<string, string> = { PATIENT: 'Paciente', PROFESSIONAL: 'Profesional', ADMIN: 'Admin' }
const AUDIENCE_BADGE: Record<string, string> = { PATIENT: 'badge-blue', PROFESSIONAL: 'badge-green', ADMIN: 'badge-gray' }

interface ReminderRule {
  id: string
  name: string
  trigger_type: string
  audience: string
  channel: string
  offset_minutes: number | null
  message_template: string
  is_active: boolean
  is_system: boolean
}

interface FormState {
  id: string | null
  name: string
  trigger_type: string
  audience: string
  channel: string
  offset_minutes: number | ''
  message_template: string
  is_active: boolean
  is_system: boolean
}

const EMPTY_FORM: FormState = {
  id: null, name: '', trigger_type: 'SCHEDULED_APPOINTMENT_REMINDER', audience: 'PATIENT',
  channel: 'WHATSAPP', offset_minutes: 1440, message_template: '', is_active: true, is_system: false,
}

interface ReminderStats {
  per_rule: Record<string, { SENT: number; FAILED: number; SKIPPED: number }>
  today: {
    totals: { SENT: number; FAILED: number; SKIPPED: number }
    by_audience: Record<string, { SENT: number; FAILED: number; SKIPPED: number }>
  }
  last_7_days: { date: string; SENT: number; FAILED: number; SKIPPED: number }[]
  week_total_sent: number
}

export function RemindersTab() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState('')

  const { data: rules = [], isLoading } = useQuery<ReminderRule[]>({
    queryKey: ['admin', 'whatsapp', 'reminders'],
    queryFn: async () => (await whatsappAPI.listReminders()).data,
  })

  const { data: stats } = useQuery<ReminderStats>({
    queryKey: ['admin', 'whatsapp', 'reminders', 'stats'],
    queryFn: async () => (await whatsappAPI.getReminderStats()).data,
    // Se refresca solo cada minuto — son contadores informativos, no
    // necesitan la inmediatez de un websocket.
    refetchInterval: 60_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'whatsapp', 'reminders'] })

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        audience: form.audience,
        channel: form.channel,
        offset_minutes: form.trigger_type === 'SCHEDULED_APPOINTMENT_REMINDER' ? Number(form.offset_minutes) || null : null,
        message_template: form.message_template.trim(),
        is_active: form.is_active,
      }
      return form.id ? whatsappAPI.updateReminder(form.id, payload) : whatsappAPI.createReminder(payload)
    },
    onSuccess: () => { setForm(EMPTY_FORM); setError(''); invalidate() },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const toggleMutation = useMutation({
    mutationFn: (rule: ReminderRule) => whatsappAPI.updateReminder(rule.id, { ...rule, is_active: !rule.is_active }),
    onSuccess: invalidate,
    onError: (err) => setError(getErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => whatsappAPI.deleteReminder(id),
    onSuccess: invalidate,
    onError: (err) => setError(getErrorMessage(err)),
  })

  function startEdit(rule: ReminderRule) {
    setForm({
      id: rule.id, name: rule.name, trigger_type: rule.trigger_type, audience: rule.audience,
      channel: rule.channel, offset_minutes: rule.offset_minutes ?? '', message_template: rule.message_template,
      is_active: rule.is_active, is_system: rule.is_system,
    })
    setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.name.trim().length < 3 || form.message_template.trim().length < 5) {
      setError('Completá el nombre y una plantilla de mensaje.')
      return
    }
    saveMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B738A]">
        &quot;Paciente esperando&quot; se dispara al instante cuando se crea una consulta inmediata — no usa el
        campo de minutos. El resto de reglas corre por un chequeo cada minuto contra la hora de la cita.
      </p>

      {stats && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[#141820] mb-3">Resumen de hoy</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Enviados" value={stats.today.totals.SENT || 0} tone="green" />
            <StatBox label="Fallidos" value={stats.today.totals.FAILED || 0} tone="red" />
            <StatBox label="Omitidos" value={stats.today.totals.SKIPPED || 0} tone="gray" />
            <StatBox label="Últimos 7 días" value={stats.week_total_sent} tone="blue" />
          </div>
          {(stats.today.by_audience.PATIENT || stats.today.by_audience.PROFESSIONAL) && (
            <div className="flex gap-4 mt-3 pt-3 border-t border-[#E5E7EB] text-xs text-[#6B738A]">
              <span>
                Paciente: <strong className="text-[#141820]">{stats.today.by_audience.PATIENT?.SENT || 0}</strong> enviados
                {(stats.today.by_audience.PATIENT?.FAILED ?? 0) > 0 && (
                  <span className="text-[#A32D2D]"> · {stats.today.by_audience.PATIENT?.FAILED} fallidos</span>
                )}
              </span>
              <span>
                Profesional: <strong className="text-[#141820]">{stats.today.by_audience.PROFESSIONAL?.SENT || 0}</strong> enviados
                {(stats.today.by_audience.PROFESSIONAL?.FAILED ?? 0) > 0 && (
                  <span className="text-[#A32D2D]"> · {stats.today.by_audience.PROFESSIONAL?.FAILED} fallidos</span>
                )}
              </span>
            </div>
          )}
          {/* Mini gráfico de barras de los últimos 7 días — sin librería, solo divs con alto proporcional. */}
          <div className="flex items-end gap-1.5 mt-4 h-16">
            {stats.last_7_days.map((day) => {
              const max = Math.max(1, ...stats.last_7_days.map((d) => d.SENT + d.FAILED))
              const total = day.SENT + day.FAILED
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1" title={`${day.date}: ${day.SENT} enviados, ${day.FAILED} fallidos`}>
                  <div className="w-full flex flex-col justify-end" style={{ height: '48px' }}>
                    <div className="w-full bg-[#A32D2D] rounded-t-sm" style={{ height: `${(day.FAILED / max) * 48}px` }} />
                    <div className="w-full bg-[#2F7D4F]" style={{ height: `${(day.SENT / max) * 48}px` }} />
                  </div>
                  <span className="text-[9px] text-[#6B738A]">{day.date.slice(8, 10)}</span>
                  {total === 0 && <span className="sr-only">Sin envíos</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#141820]">{form.id ? 'Editar recordatorio' : 'Nuevo recordatorio'}</h3>
        {error && <Alert type="error" message={error} />}
        {form.is_system && (
          <p className="text-xs text-[#854F0B] bg-[#FEF3E2] rounded-md px-3 py-2">
            Esta es una regla del catálogo fijo del sistema — el disparador y el destinatario están atados a lógica
            de negocio en el backend y no se pueden cambiar acá. Sí podés editar el texto del mensaje, el offset
            (si aplica) o pausarla.
          </p>
        )}

        <div>
          <label className="text-xs font-medium text-[#6B738A]">Nombre interno</label>
          <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ej: Recordatorio 24h antes de la cita" maxLength={150} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[#6B738A]">Disparador</label>
            <select className="input mt-1" value={form.trigger_type} disabled={form.is_system}
              onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}>
              {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[#6B738A]">Destinatario</label>
            <select className="input mt-1" value={form.audience} disabled={form.is_system}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              <option value="PATIENT">Paciente</option>
              <option value="PROFESSIONAL">Profesional</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
        </div>

        {form.trigger_type === 'SCHEDULED_APPOINTMENT_REMINDER' && (
          <div>
            <label className="text-xs font-medium text-[#6B738A]">Minutos antes de la cita</label>
            <input type="number" className="input mt-1 max-w-[160px]" value={form.offset_minutes}
              onChange={(e) => setForm({ ...form, offset_minutes: e.target.value === '' ? '' : Number(e.target.value) })}
              placeholder="1440 = 24 horas" />
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-[#6B738A]">Plantilla del mensaje</label>
          <textarea className="input mt-1 min-h-[80px]" value={form.message_template}
            onChange={(e) => setForm({ ...form, message_template: e.target.value })}
            placeholder="Hola {paciente}, tu cita con {profesional} es el {fecha} a las {hora}." />
          <p className="text-[10px] text-[#6B738A] mt-1">
            Variables disponibles: {'{paciente}'} {'{profesional}'} {'{especialidad}'} {'{fecha}'} {'{hora}'}
          </p>
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-sm text-[#141820]">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Regla activa
          </label>
          <div className="flex gap-2">
            {form.id && <button type="button" className="btn-secondary" onClick={() => { setForm(EMPTY_FORM); setError('') }}>Cancelar</button>}
            <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear regla'}
            </button>
          </div>
        </div>
      </form>

      {isLoading ? (
        <LoadingScreen text="Cargando recordatorios..." />
      ) : rules.length === 0 ? (
        <EmptyState title="No hay reglas todavía" description="Creá la primera con el formulario de arriba." />
      ) : (
        <>
          {rules.some((r) => r.is_system) && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide pt-2">
                Catálogo del sistema (Profesional #1-8 · Paciente #1-4)
              </h3>
              {rules.filter((r) => r.is_system).map((rule) => (
                <ReminderCard key={rule.id} rule={rule} todayCount={stats?.per_rule[rule.id]} onEdit={startEdit} onToggle={() => toggleMutation.mutate(rule)} />
              ))}
            </div>
          )}
          {rules.some((r) => !r.is_system) && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide pt-2">Reglas personalizadas</h3>
              {rules.filter((r) => !r.is_system).map((rule) => (
                <ReminderCard
                  key={rule.id} rule={rule} todayCount={stats?.per_rule[rule.id]} onEdit={startEdit} onToggle={() => toggleMutation.mutate(rule)}
                  onDelete={() => { if (confirm('¿Eliminar esta regla? No se puede deshacer.')) deleteMutation.mutate(rule.id) }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'gray' | 'blue' }) {
  const toneClass = {
    green: 'text-[#2F7D4F]', red: 'text-[#A32D2D]', gray: 'text-[#6B738A]', blue: 'text-[#185FA5]',
  }[tone]
  return (
    <div className="bg-[#F7F8FA] rounded-lg p-3">
      <p className={`text-xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-[10px] text-[#6B738A] mt-0.5">{label}</p>
    </div>
  )
}

function ReminderCard({ rule, todayCount, onEdit, onToggle, onDelete }: {
  rule: ReminderRule
  todayCount?: { SENT: number; FAILED: number; SKIPPED: number }
  onEdit: (rule: ReminderRule) => void
  onToggle: () => void
  onDelete?: () => void
}) {
  return (
    <div className="card p-4 flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={AUDIENCE_BADGE[rule.audience] || 'badge-gray'}>{AUDIENCE_LABEL[rule.audience] || rule.audience}</span>
          {rule.is_system && <span className="badge-blue">Sistema</span>}
          {!rule.is_active && <span className="badge-gray">Inactiva</span>}
          <span className="text-[10px] text-[#6B738A]">{TRIGGER_LABEL[rule.trigger_type] || rule.trigger_type}</span>
          {rule.offset_minutes != null && <span className="text-[10px] text-[#6B738A]">· {rule.offset_minutes} min antes</span>}
          {todayCount && (todayCount.SENT + todayCount.FAILED + todayCount.SKIPPED) > 0 && (
            <span className="text-[10px] text-[#6B738A]">
              · hoy: <strong className="text-[#2F7D4F]">{todayCount.SENT} enviados</strong>
              {todayCount.FAILED > 0 && <> · <strong className="text-[#A32D2D]">{todayCount.FAILED} fallidos</strong></>}
              {todayCount.SKIPPED > 0 && <> · {todayCount.SKIPPED} omitidos</>}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-[#141820]">{rule.name}</p>
        <p className="text-xs text-[#6B738A] mt-1 whitespace-pre-wrap">{rule.message_template}</p>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <button className="text-xs text-[#185FA5] hover:underline" onClick={() => onEdit(rule)}>Editar</button>
        <button className="text-xs text-[#854F0B] hover:underline" onClick={onToggle}>
          {rule.is_active ? 'Desactivar' : 'Activar'}
        </button>
        {onDelete && (
          <button className="text-xs text-[#A32D2D] hover:underline" onClick={onDelete}>
            Eliminar
          </button>
        )}
      </div>
    </div>
  )
}
