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

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'whatsapp', 'status'],
    queryFn: async () => (await whatsappAPI.getStatus()).data,
    refetchInterval: 15000,
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

  if (isLoading) return <LoadingScreen text="Consultando estado del bot..." />

  const state = status?.connection_state || 'DOWN'
  const reachable = status?.service_reachable

  return (
    <div className="space-y-4">
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
              <p className="text-xs text-[#6B738A]">{t('Número vinculado vía whatsapp-service (Baileys)')}</p>
            </div>
            <span className={`ml-auto ${STATE_BADGE[state] || 'badge-gray'}`}>{state}</span>
          </div>
        )}

        {state === 'QR_PENDING' && (
          <div className="mt-4 p-4 border border-[#DDE1EE] rounded-xl text-center">
            <p className="text-xs text-[#6B738A] mb-3">
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
        <p className="text-xs text-[#6B738A] mb-3">
          Manda un WhatsApp real a un número para confirmar que todo el pipeline funciona
          (backend → Celery → whatsapp-service → WhatsApp).
        </p>
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
        <ul className="text-xs text-[#6B738A] space-y-1.5 list-disc list-inside">
          <li>{t('La sesión de WhatsApp vive en')} <code>whatsapp-service/auth_info/</code> {t('— respaldala aparte, no está en git.')}</li>
          <li>Si aparece &quot;Desconectado&quot; sin QR, revisá los logs de PM2: <code>{t('pm2 logs medicbolivia-whatsapp-service')}</code>.</li>
          <li>{t('Un cierre de sesión desde el celular obliga a volver a escanear el QR.')}</li>
        </ul>
      </div>
    </div>
  )
}
