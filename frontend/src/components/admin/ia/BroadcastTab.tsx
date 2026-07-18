'use client'
// src/components/admin/ia/BroadcastTab.tsx
// Pestaña 5 — mensajería masiva: el admin redacta un anuncio libre y lo
// manda a un segmento de usuarios (todos / pacientes / profesionales /
// contactos de WhatsApp sin cuenta). El envío por WhatsApp sale
// escalonado con espera aleatoria entre mensaje y mensaje (lo hace el
// backend, ver app/services/broadcast.py) para no parecer un script.

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, LoadingScreen, EmptyState } from '@/components/ui'
import { adminAPI, getErrorMessage, BroadcastMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const AUDIENCE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'ALL', label: 'Todos', hint: 'Pacientes y profesionales registrados' },
  { value: 'PATIENT', label: 'Solo pacientes', hint: 'Pacientes activos' },
  { value: 'PROFESSIONAL', label: 'Solo profesionales', hint: 'Profesionales aprobados' },
  { value: 'WHATSAPP_PUBLIC', label: 'Público de WhatsApp', hint: 'Contactos que escribieron al bot sin cuenta en la plataforma' },
]

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: 'Todos', PATIENT: 'Pacientes', PROFESSIONAL: 'Profesionales', WHATSAPP_PUBLIC: 'Público WhatsApp',
}
const AUDIENCE_BADGE: Record<string, string> = {
  ALL: 'badge-gray', PATIENT: 'badge-blue', PROFESSIONAL: 'badge-green', WHATSAPP_PUBLIC: 'badge-gray',
}

const BODY_MAX_LENGTH = 1000

export function BroadcastTab() {
  const { t } = useLanguage()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('ALL')
  const [sendWhatsapp, setSendWhatsapp] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['admin', 'broadcasts', 'preview', audience],
    queryFn: () => adminAPI.previewBroadcastRecipients(audience),
  })

  const { data: history = [], isLoading: historyLoading } = useQuery<BroadcastMessage[]>({
    queryKey: ['admin', 'broadcasts', 'history'],
    queryFn: () => adminAPI.listBroadcasts(),
  })

  const sendMutation = useMutation({
    mutationFn: () => adminAPI.createBroadcast({ title: title.trim(), body: body.trim(), audience, send_whatsapp: sendWhatsapp }),
    onSuccess: () => {
      setTitle('')
      setBody('')
      setError('')
      setConfirming(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'broadcasts'] })
    },
    onError: (err) => { setError(getErrorMessage(err)); setConfirming(false) },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (title.trim().length < 1 || body.trim().length < 1) {
      setError('Completá el título y el mensaje.')
      return
    }
    setError('')
    setConfirming(true)
  }

  const recipientsCount = preview?.recipients_count ?? 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B738A]">
        {t('Escribí un anuncio y elegí a quién llega. Se crea como notificación in-app y, si querés, también por WhatsApp — en ese caso los mensajes salen de a uno, con una espera aleatoria entre cada uno, para no verse como un envío automatizado.')}
      </p>

      <form onSubmit={handleSubmit} className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#141820]">{t('Nuevo anuncio')}</h3>
        {error && <Alert type="error" message={error} />}

        <div>
          <label className="text-xs font-medium text-[#6B738A]">{t('Título')}</label>
          <input
            className="input mt-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Ej: Mantenimiento programado')}
            maxLength={150}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-[#6B738A]">{t('Mensaje')}</label>
          <textarea
            className="input mt-1 min-h-[100px]"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX_LENGTH))}
            placeholder={t('Escribí el mensaje que van a recibir...')}
          />
          <p className="text-[10px] text-[#6B738A] mt-1 text-right">{body.length}/{BODY_MAX_LENGTH}</p>
        </div>

        <div>
          <label className="text-xs font-medium text-[#6B738A]">{t('Audiencia')}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
            {AUDIENCE_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setAudience(opt.value)}
                className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                  audience === opt.value
                    ? 'border-[#185FA5] bg-[#EAF2FB] text-[#141820]'
                    : 'border-[#DDE1EE] text-[#6B738A] hover:border-[#B7C0D6]'
                }`}
              >
                <span className="font-medium block">{t(opt.label)}</span>
                <span className="text-[10px]">{t(opt.hint)}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-[#6B738A] mt-2">
            {previewLoading
              ? t('Calculando destinatarios...')
              : t('Destinatarios estimados:') + ' ' }
            {!previewLoading && <strong className="text-[#141820]">{recipientsCount}</strong>}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-[#141820]">
          <input type="checkbox" checked={sendWhatsapp} onChange={(e) => setSendWhatsapp(e.target.checked)} />
          {t('Enviar también por WhatsApp (además de la notificación in-app)')}
        </label>

        {!confirming ? (
          <div className="flex justify-end pt-1">
            <button type="submit" className="btn-primary">{t('Continuar')}</button>
          </div>
        ) : (
          <div className="bg-[#FEF3E2] rounded-md px-3 py-3 space-y-2">
            <p className="text-sm text-[#854F0B]">
              {t('Vas a mandar este anuncio a')} <strong>{recipientsCount}</strong> {t('destinatario(s)')}
              {' '}({AUDIENCE_LABEL[audience]}){sendWhatsapp && <> {t('incluyendo WhatsApp')}</>}.{' '}
              {t('Esta acción no se puede deshacer.')}
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={sendMutation.isPending}>
                {t('Cancelar')}
              </button>
              <button type="button" className="btn-primary" onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
                {sendMutation.isPending ? t('Enviando...') : t('Confirmar y enviar')}
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide pt-2">{t('Historial de anuncios')}</h3>
        {historyLoading ? (
          <LoadingScreen text={t('Cargando historial...')} />
        ) : history.length === 0 ? (
          <EmptyState title={t('Todavía no mandaste ningún anuncio')} description={t('Usá el formulario de arriba para el primero.')} />
        ) : (
          history.map((b) => (
            <div key={b.id} className="card p-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={AUDIENCE_BADGE[b.audience] || 'badge-gray'}>{AUDIENCE_LABEL[b.audience] || b.audience}</span>
                {b.send_whatsapp && <span className="badge-blue">WhatsApp</span>}
                <span className="text-[10px] text-[#6B738A]">
                  · {b.recipients_count} {t('destinatario(s)')}
                </span>
                {b.created_at && (
                  <span className="text-[10px] text-[#6B738A]">· {new Date(b.created_at).toLocaleString()}</span>
                )}
              </div>
              <p className="text-sm font-medium text-[#141820]">{b.title}</p>
              <p className="text-xs text-[#6B738A] mt-1 whitespace-pre-wrap">{b.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
