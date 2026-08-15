'use client'
// src/components/admin/ia/BotTab.tsx
// Pestaña 1 — estado de conexión del bot (whatsapp-service/Baileys), QR de
// vinculación y un botón de mensaje de prueba para verificar el pipeline
// completo (backend → whatsapp-service → WhatsApp real) sin esperar a que
// llegue un mensaje real.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { SectionTitle, Alert, LoadingScreen } from '@/components/ui'
import { whatsappAPI, getErrorMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const STATE_LABEL: Record<string, string> = {
  CONNECTED: 'Conectado',
  QR_PENDING: 'Esperando escaneo de QR',
  CONNECTING: 'Conectando…',
  DOWN: 'Desconectado',
  ERROR: 'Error',
}

const STATE_BADGE: Record<string, string> = {
  CONNECTED: 'badge-green',
  QR_PENDING: 'badge-blue',
  CONNECTING: 'badge-blue',
  DOWN: 'badge-red',
  ERROR: 'badge-red',
}

export function BotTab() {
  const { t } = useLanguage()
  const [testPhone, setTestPhone] = useState('')
  const [testError, setTestError] = useState('')
  const [testOk, setTestOk] = useState(false)
  const [pauseError, setPauseError] = useState('')

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'whatsapp', 'status'],
    queryFn: async () => (await whatsappAPI.getStatus()).data,
    refetchInterval: 15000,
  })

  const { data: volumeStats } = useQuery({
    queryKey: ['admin', 'whatsapp', 'volume-stats'],
    queryFn: async () => (await whatsappAPI.getVolumeStats()).data,
    refetchInterval: 60000,
  })

  const { data: qrData, refetch: refetchQR } = useQuery({
    queryKey: ['admin', 'whatsapp', 'qr'],
    queryFn: async () => (await whatsappAPI.getQR()).data,
    enabled: status?.connection_state === 'QR_PENDING',
    refetchInterval: status?.connection_state === 'QR_PENDING' ? 8000 : false,
  })

  const testMutation = useMutation({
    mutationFn: () => whatsappAPI.sendTestMessage({ phone: testPhone }),
    onSuccess: () => { setTestOk(true); setTestError('') },
    onError: (err) => { setTestError(getErrorMessage(err)); setTestOk(false) },
  })

  const pauseMutation = useMutation({
    mutationFn: (reason: string) => whatsappAPI.pause(reason),
    onSuccess: () => { setPauseError(''); refetch() },
    onError: (err) => setPauseError(getErrorMessage(err)),
  })

  const resumeMutation = useMutation({
    mutationFn: () => whatsappAPI.resume(),
    onSuccess: () => { setPauseError(''); refetch() },
    onError: (err) => setPauseError(getErrorMessage(err)),
  })

  if (isLoading) return <LoadingScreen text="Consultando estado del bot..." />

  const state = status?.connection_state || 'DOWN'
  const reachable = status?.service_reachable
  const pausedInfo = status?.paused as { reason?: string; by?: string; at?: string } | null | undefined
  const isPaused = !!pausedInfo

  const handlePauseClick = () => {
    const confirmed = window.confirm(
      '¿Frenar TODOS los envíos de WhatsApp ahora mismo? Ningún mensaje (recordatorios, broadcast, agente IA, OTP) va a salir hasta que lo reanudes vos u otro admin.'
    )
    if (!confirmed) return
    const reason = window.prompt('¿Por qué lo pausás? (queda registrado, opcional)') || ''
    pauseMutation.mutate(reason)
  }

  const handleResumeClick = () => {
    const confirmed = window.confirm('¿Reanudar los envíos de WhatsApp?')
    if (!confirmed) return
    resumeMutation.mutate()
  }

  return (
    <div className="space-y-4">
      {/* ── Kill switch ── */}
      <div className="card p-4">
        <SectionTitle>{t('Kill switch de envíos')}</SectionTitle>
        <p className="text-xs text-[#475569] mb-3">
          Frena todo envío de WhatsApp al instante (recordatorios, broadcast, agente IA, OTP) sin
          bajar ningún proceso. Usalo apenas algo se vea raro — mensajes duplicados, respuestas del
          bot fuera de lugar, o cualquier señal de que el número podría terminar bloqueado.
        </p>

        {pauseError && <div className="mb-2"><Alert type="error" message={pauseError} /></div>}

        {isPaused ? (
          <>
            <Alert
              type="warning"
              message={`⏸ Envíos pausados${pausedInfo?.by ? ` por ${pausedInfo.by}` : ''}${pausedInfo?.reason ? `: "${pausedInfo.reason}"` : ''}`}
            />
            <button
              className="btn-primary mt-3"
              disabled={resumeMutation.isPending}
              onClick={handleResumeClick}
            >
              {resumeMutation.isPending ? 'Reanudando...' : t('Reanudar envíos')}
            </button>
          </>
        ) : (
          <button
            className="mt-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#A32D2D] hover:bg-[#8A2626] transition-colors"
            disabled={pauseMutation.isPending}
            onClick={handlePauseClick}
          >
            {pauseMutation.isPending ? 'Pausando...' : t('⏸ Pausar todos los envíos')}
          </button>
        )}
      </div>

      {/* ── Volumen de envíos ── */}
      <div className="card p-4">
        <SectionTitle>{t('Volumen de envíos')}</SectionTitle>
        <p className="text-xs text-[#475569] mb-3">
          Para correlacionar un bloqueo con lo que se mandó, sin ir a buscarlo en logs de Celery.
          No incluye OTP (esos no dejan registro en esta tabla).
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 bg-[#F5F6FA] rounded-xl">
            <p className="text-xs text-[#475569]">{t('Última hora')}</p>
            <p className="text-lg font-semibold">
              {volumeStats?.last_hour?.sent ?? '—'}
              <span className="text-xs font-normal text-[#475569]"> {t('enviados')}</span>
            </p>
            {!!volumeStats?.last_hour?.failed && (
              <p className="text-xs text-[#A32D2D]">{volumeStats.last_hour.failed} {t('fallidos')}</p>
            )}
          </div>
          <div className="p-3 bg-[#F5F6FA] rounded-xl">
            <p className="text-xs text-[#475569]">{t('Últimas 24 horas')}</p>
            <p className="text-lg font-semibold">
              {volumeStats?.last_24h?.sent ?? '—'}
              <span className="text-xs font-normal text-[#475569]"> {t('enviados')}</span>
            </p>
            {!!volumeStats?.last_24h?.failed && (
              <p className="text-xs text-[#A32D2D]">{volumeStats.last_24h.failed} {t('fallidos')}</p>
            )}
          </div>
        </div>

        {volumeStats?.last_24h?.by_sent_by && Object.keys(volumeStats.last_24h.by_sent_by).length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(volumeStats.last_24h.by_sent_by as Record<string, number>).map(([origin, count]) => (
              <span key={origin} className="text-xs px-2 py-1 rounded-full bg-[#E6F1FB] text-[#185FA5]">
                {origin}: {count}
              </span>
            ))}
          </div>
        )}

        {Array.isArray(volumeStats?.hourly_24h) && volumeStats.hourly_24h.length > 0 && (() => {
          const hourly = volumeStats.hourly_24h as { hour_bolivia: string; sent: number; failed: number }[]
          const maxVal = Math.max(1, ...hourly.map((h) => h.sent + h.failed))
          return (
            <div>
              <p className="text-xs text-[#475569] mb-2">{t('Por hora (últimas 24h, hora Bolivia)')}</p>
              <div className="flex items-end gap-1 h-24">
                {hourly.map((h) => (
                  <div key={h.hour_bolivia} className="flex-1 flex flex-col items-center justify-end group relative">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                      {h.failed > 0 && (
                        <div
                          className="w-full bg-[#A32D2D] rounded-t-sm"
                          style={{ height: `${(h.failed / maxVal) * 100}%` }}
                          title={`${h.hour_bolivia} — ${h.failed} fallidos`}
                        />
                      )}
                      <div
                        className="w-full bg-[#185FA5]"
                        style={{ height: `${(h.sent / maxVal) * 100}%` }}
                        title={`${h.hour_bolivia} — ${h.sent} enviados`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-[#475569] mt-1">
                <span>{hourly[0]?.hour_bolivia}</span>
                <span>{hourly[hourly.length - 1]?.hour_bolivia}</span>
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Estado de conexión ── */}
      <div className="card p-4">
        <SectionTitle
          action={
            <button className="text-xs text-[#185FA5] hover:underline" onClick={() => refetch()}>
              {t('Actualizar')}
            </button>
          }
        >
          {t('Estado del bot')}
        </SectionTitle>

        {!reachable && (
          <Alert
            type="error"
            message="El microservicio whatsapp-service no responde. Verificá que el proceso PM2 'medicbolivia-whatsapp-service' esté corriendo."
          />
        )}

        {reachable && (
          <div className="flex items-center gap-3 p-3 bg-[#F5F6FA] rounded-xl mt-2">
            <div className={`w-2.5 h-2.5 rounded-full ${state === 'CONNECTED' ? 'bg-[#0F6E56]' : state === 'DOWN' || state === 'ERROR' ? 'bg-[#A32D2D]' : 'bg-[#185FA5] animate-pulse'}`} />
            <div>
              <p className="text-sm font-medium">{STATE_LABEL[state] || state}</p>
              <p className="text-xs text-[#475569]">{t('Número vinculado vía whatsapp-service (Baileys)')}</p>
            </div>
            <span className={`ml-auto ${STATE_BADGE[state] || 'badge-gray'}`}>{state}</span>
          </div>
        )}

        {state === 'QR_PENDING' && (
          <div className="mt-4 p-4 border border-[#DDE1EE] rounded-xl text-center">
            <p className="text-xs text-[#475569] mb-3">
              Escaneá este código desde WhatsApp → Dispositivos vinculados → Vincular un dispositivo.
              Usá primero un número de pruebas — ver advertencia de riesgo de baneo en el README de whatsapp-service.
            </p>
            {qrData?.qr_available ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrData.qr_data_url} alt="QR de vinculación de WhatsApp" className="mx-auto rounded-lg" width={220} height={220} />
            ) : (
              <button className="btn-secondary text-xs" onClick={() => refetchQR()}>{t('Buscar QR')}</button>
            )}
          </div>
        )}
      </div>

      {/* ── Mensaje de prueba ── */}
      <div className="card p-4">
        <SectionTitle>{t('Mensaje de prueba')}</SectionTitle>
        <p className="text-xs text-[#475569] mb-3">
          Manda un WhatsApp real a un número para confirmar que todo el pipeline funciona
          (backend → Celery → whatsapp-service → WhatsApp).
        </p>
        {isPaused && (
          <div className="mb-2">
            <Alert type="warning" message="Los envíos están pausados — el mensaje de prueba quedará en espera y no llegará hasta que reanudes." />
          </div>
        )}
        {testError && <div className="mb-2"><Alert type="error" message={testError} /></div>}
        {testOk && <div className="mb-2"><Alert type="success" message="Mensaje encolado. Debería llegar en unos segundos." /></div>}
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder={t('Ej: 59169625434')}
            value={testPhone}
            onChange={(e) => { setTestPhone(e.target.value); setTestOk(false) }}
          />
          <button
            className="btn-primary whitespace-nowrap"
            disabled={testMutation.isPending || testPhone.trim().length < 6}
            onClick={() => testMutation.mutate()}
          >
            {testMutation.isPending ? 'Enviando...' : 'Enviar prueba'}
          </button>
        </div>
      </div>

      {/* ── Notas de configuración ── */}
      <div className="card p-4">
        <SectionTitle>{t('Configuración')}</SectionTitle>
        <ul className="text-xs text-[#475569] space-y-1.5 list-disc list-inside">
          <li>{t('La sesión de WhatsApp vive en')} <code>whatsapp-service/auth_info/</code> {t('— respaldala aparte, no está en git.')}</li>
          <li>Si aparece &quot;Desconectado&quot; sin QR, revisá los logs de PM2: <code>{t('pm2 logs medicbolivia-whatsapp-service')}</code>.</li>
          <li>{t('Un cierre de sesión desde el celular obliga a volver a escanear el QR.')}</li>
        </ul>
      </div>
    </div>
  )
}
