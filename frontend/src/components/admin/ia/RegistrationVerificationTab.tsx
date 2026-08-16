'use client'
// src/components/admin/ia/RegistrationVerificationTab.tsx
// Pestaña 6 — kill switch de la verificación de teléfono por WhatsApp en
// el registro de pacientes y profesionales. Distinto del "Kill switch de
// envíos" de la pestaña Bot: aquel frena TODO mensaje saliente; este solo
// hace opcional el paso de OTP dentro del registro, para usarlo cuando el
// bot no está disponible (caído, número baneado, corte del proveedor) sin
// dejar de recibir altas nuevas mientras se resuelve.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { SectionTitle, Alert, LoadingScreen } from '@/components/ui'
import { whatsappAPI, getErrorMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export function RegistrationVerificationTab() {
  const { t } = useLanguage()
  const [actionError, setActionError] = useState('')

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'whatsapp', 'registration-verification-status'],
    queryFn: async () => (await whatsappAPI.getRegistrationVerificationStatus()).data,
    refetchInterval: 15000,
  })

  const disableMutation = useMutation({
    mutationFn: (reason: string) => whatsappAPI.disableRegistrationVerification(reason),
    onSuccess: () => { setActionError(''); refetch() },
    onError: (err) => setActionError(getErrorMessage(err)),
  })

  const enableMutation = useMutation({
    mutationFn: () => whatsappAPI.enableRegistrationVerification(),
    onSuccess: () => { setActionError(''); refetch() },
    onError: (err) => setActionError(getErrorMessage(err)),
  })

  if (isLoading) return <LoadingScreen text="Consultando estado de la verificación de registro..." />

  const info = status?.info as { reason?: string; by?: string; at?: string } | null | undefined
  const isRequired = status?.required !== false
  const isDisabled = !isRequired

  const handleDisableClick = () => {
    const confirmed = window.confirm(
      '¿Desactivar la verificación obligatoria de WhatsApp en el registro? Mientras esté desactivada, cualquier persona va a poder crear una cuenta de paciente o profesional con solo cargar su número, SIN confirmarlo por WhatsApp.'
    )
    if (!confirmed) return
    const reason = window.prompt('¿Por qué la desactivás? (queda registrado, opcional)') || ''
    disableMutation.mutate(reason)
  }

  const handleEnableClick = () => {
    const confirmed = window.confirm('¿Reactivar la verificación obligatoria de WhatsApp en el registro?')
    if (!confirmed) return
    enableMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <SectionTitle>{t('Verificación de teléfono en el registro')}</SectionTitle>
        <p className="text-xs text-[#475569] mb-3">
          Por defecto, todo paciente o profesional nuevo tiene que confirmar su número de celular
          por WhatsApp (código OTP) antes de poder crear la cuenta. Desactivá esto solo si el bot de
          WhatsApp no está disponible por algún problema interno o externo (caído, número baneado,
          corte del proveedor) y no querés frenar el alta de cuentas nuevas mientras se soluciona.
        </p>

        {actionError && <div className="mb-2"><Alert type="error" message={actionError} /></div>}

        {isDisabled ? (
          <>
            <Alert
              type="warning"
              message={`⏸ Verificación desactivada${info?.by ? ` por ${info.by}` : ''}${info?.reason ? `: "${info.reason}"` : ''} — el registro no exige confirmar el número por WhatsApp.`}
            />
            <button
              className="btn-primary mt-3"
              disabled={enableMutation.isPending}
              onClick={handleEnableClick}
            >
              {enableMutation.isPending ? 'Reactivando...' : t('Reactivar verificación obligatoria')}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 bg-[#F5F6FA] rounded-xl mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-[#0F6E56]" />
              <div>
                <p className="text-sm font-medium">{t('Verificación obligatoria (por defecto)')}</p>
                <p className="text-xs text-[#475569]">{t('El registro exige confirmar el número por WhatsApp antes de crear la cuenta.')}</p>
              </div>
            </div>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#A32D2D] hover:bg-[#8A2626] transition-colors"
              disabled={disableMutation.isPending}
              onClick={handleDisableClick}
            >
              {disableMutation.isPending ? 'Desactivando...' : t('Desactivar verificación obligatoria')}
            </button>
          </>
        )}
      </div>

      <div className="card p-4">
        <SectionTitle>{t('Qué cambia con la verificación desactivada')}</SectionTitle>
        <ul className="text-xs text-[#475569] space-y-1.5 list-disc list-inside">
          <li>{t('En las pantallas de registro desaparece el paso y el botón de "Verificar número por WhatsApp".')}</li>
          <li>{t('/auth/register/patient y /auth/register/professional dejan de exigir el código OTP para crear la cuenta.')}</li>
          <li>{t('El resto del registro (nombre, CI, contraseña, etc.) sigue igual — solo se salta la confirmación del número.')}</li>
          <li>{t('El cambio es inmediato para todos los usuarios, sin reiniciar nada.')}</li>
          <li>{t('Recordá reactivarla apenas el bot vuelva a funcionar.')}</li>
        </ul>
      </div>
    </div>
  )
}
