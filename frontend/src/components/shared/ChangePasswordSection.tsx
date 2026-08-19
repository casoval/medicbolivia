'use client'
// src/components/shared/ChangePasswordSection.tsx
// Sección de Perfil (paciente y profesional): cambiar la contraseña
// estando logueado, sin tener que pasar por el flujo de "olvidé mi
// contraseña" (que exige cerrar sesión y verificar por WhatsApp). Pide la
// contraseña actual para confirmar que es el dueño de la cuenta quien la
// está cambiando. Ver POST /auth/password/change.

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { passwordResetAPI, getErrorMessage } from '@/lib/api'
import { Alert, SectionTitle, PasswordInput } from '@/components/ui'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export function ChangePasswordSection() {
  const { t } = useLanguage()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const changeMutation = useMutation({
    mutationFn: () => passwordResetAPI.change(currentPassword, newPassword),
    onSuccess: () => {
      setError('')
      setSuccess(t('Contraseña actualizada correctamente.'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (err) => {
      setSuccess('')
      setError(getErrorMessage(err))
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('Completa los 3 campos.'))
      return
    }
    if (newPassword.length < 4) {
      setError(t('La contraseña nueva debe tener al menos 4 caracteres.'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('Las contraseñas nuevas no coinciden.'))
      return
    }
    changeMutation.mutate()
  }

  return (
    <div>
      <SectionTitle>{t('Cambiar contraseña')}</SectionTitle>
      <p className="text-xs text-[#64748B] mb-3">
        {t('Si querés cambiar tu contraseña, escribí la actual y la nueva acá abajo. No hace falta cerrar sesión ni recibir un código por WhatsApp.')}
      </p>

      {success && <div className="mb-3"><Alert type="success" message={success} /></div>}
      {error && <div className="mb-3"><Alert type="error" message={error} /></div>}

      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label className="label">{t('Contraseña actual')}</label>
          <PasswordInput
            autoComplete="current-password"
            className="input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">{t('Contraseña nueva')}</label>
          <PasswordInput
            autoComplete="new-password"
            className="input"
            placeholder={t('Mínimo 4 caracteres')}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={4}
          />
        </div>
        <div>
          <label className="label">{t('Confirmar contraseña nueva')}</label>
          <PasswordInput
            autoComplete="new-password"
            className="input"
            placeholder={t('Repetir contraseña nueva')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <button
          type="submit"
          disabled={changeMutation.isPending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {changeMutation.isPending ? t('Guardando...') : t('Cambiar contraseña')}
        </button>
      </form>
    </div>
  )
}
