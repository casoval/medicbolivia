'use client'
// src/components/patient/RefundAccountModal.tsx
// El paciente indica a dónde transferirle un reembolso puntual ya
// aprobado (por un admin o automáticamente al cancelarse una cita).
// A diferencia de la cuenta bancaria del profesional (un perfil
// permanente), esto es un dato por-reembolso: cada uno puede ir a un
// destino distinto. Se ofrecen dos métodos porque no todo paciente
// tiene cuenta bancaria formal — billetera móvil / QR interpersonal
// (Tigo Money, QR de su banco a un número de celular) es mucho más
// accesible para algo puntual. Ver PUT /patients/me/refunds/{id}/account
// y app/services/refund_payout.py en el backend.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { professionalsAPI, patientsAPI, getErrorMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const OTHER_BANK_VALUE = '__OTHER__'

export function RefundAccountModal({
  paymentId, amount, onClose, onSuccess,
}: {
  paymentId: string
  amount: number
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useLanguage()
  const [method, setMethod] = useState<'BANK' | 'MOBILE_WALLET'>('MOBILE_WALLET')

  // Cuenta bancaria
  const [selectedBank, setSelectedBank] = useState('')
  const [otherBankName, setOtherBankName] = useState('')
  const [accountType, setAccountType] = useState<'AHORRO' | 'CORRIENTE'>('AHORRO')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountNumberConfirm, setAccountNumberConfirm] = useState('')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [accountHolderCi, setAccountHolderCi] = useState('')

  // Billetera móvil / QR interpersonal
  const [walletProvider, setWalletProvider] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')

  const [responsibilityAck, setResponsibilityAck] = useState(false)
  const [formError, setFormError] = useState('')

  const { data: bankListData } = useQuery({
    queryKey: ['bank-list'],
    queryFn: professionalsAPI.getBankList,
    enabled: method === 'BANK',
  })

  const mutation = useMutation({
    mutationFn: () => patientsAPI.submitRefundAccount(paymentId, method === 'BANK' ? {
      method: 'BANK',
      bank_name: selectedBank === OTHER_BANK_VALUE ? otherBankName.trim() : selectedBank,
      account_type: accountType,
      account_number: accountNumber,
      account_number_confirm: accountNumberConfirm,
      account_holder_name: accountHolderName.trim(),
      account_holder_ci: accountHolderCi.trim(),
      responsibility_acknowledged: responsibilityAck,
    } : {
      method: 'MOBILE_WALLET',
      wallet_provider: walletProvider.trim(),
      phone_number: phoneNumber,
      responsibility_acknowledged: responsibilityAck,
    }),
    onSuccess: () => onSuccess(),
    onError: (err) => setFormError(getErrorMessage(err)),
  })

  function submit() {
    setFormError('')
    if (!responsibilityAck) {
      setFormError(t('Debes confirmar que los datos son correctos y aceptar la responsabilidad indicada'))
      return
    }
    if (method === 'BANK') {
      const bankNameFinal = selectedBank === OTHER_BANK_VALUE ? otherBankName.trim() : selectedBank
      if (!bankNameFinal) { setFormError(t('Selecciona o escribe tu banco')); return }
      if (!accountNumber || !accountNumberConfirm) { setFormError(t('Completa el número de cuenta')); return }
      if (accountNumber !== accountNumberConfirm) { setFormError(t('El número de cuenta y su confirmación no coinciden')); return }
      if (!accountHolderName.trim() || !accountHolderCi.trim()) { setFormError(t('Completa el nombre y CI del titular')); return }
    } else {
      if (!walletProvider.trim()) { setFormError(t('Indica el proveedor (ej. Tigo Money, QR de tu banco)')); return }
      if (!phoneNumber.trim()) { setFormError(t('Indica el número de celular')); return }
    }
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#DDE1EE]">
          <div>
            <p className="text-sm font-semibold">{t('¿A dónde te transferimos tu reembolso?')}</p>
            <p className="text-xs text-[#64748B] mt-0.5">Bs. {amount.toFixed(2)}</p>
          </div>
          <button onClick={onClose} className="text-[#475569] hover:text-[#141820] text-xl leading-none">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* ── Selector de método ── */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod('MOBILE_WALLET')}
              className={`text-xs font-medium rounded-lg border py-2.5 px-2 text-center transition-colors ${
                method === 'MOBILE_WALLET' ? 'border-[#185FA5] bg-[#185FA5]/5 text-[#185FA5]' : 'border-[#DDE1EE] text-[#475569]'
              }`}
            >
              {t('Billetera móvil / QR')}
            </button>
            <button
              type="button"
              onClick={() => setMethod('BANK')}
              className={`text-xs font-medium rounded-lg border py-2.5 px-2 text-center transition-colors ${
                method === 'BANK' ? 'border-[#185FA5] bg-[#185FA5]/5 text-[#185FA5]' : 'border-[#DDE1EE] text-[#475569]'
              }`}
            >
              {t('Cuenta bancaria')}
            </button>
          </div>

          {method === 'MOBILE_WALLET' ? (
            <div className="space-y-3">
              <p className="text-xs text-[#64748B]">
                {t('La opción más rápida si no tienes cuenta bancaria: te transferimos a tu billetera móvil o por QR interpersonal, usando tu número de celular.')}
              </p>
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('Proveedor')}</label>
                <input
                  value={walletProvider}
                  onChange={(e) => setWalletProvider(e.target.value)}
                  placeholder={t('Ej. Tigo Money, QR de mi banco')}
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('Número de celular')}</label>
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="7XXXXXXX"
                  inputMode="numeric"
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('Banco')}</label>
                <select
                  value={selectedBank}
                  onChange={(e) => setSelectedBank(e.target.value)}
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2 bg-white"
                >
                  <option value="">{t('Selecciona tu banco')}</option>
                  {(bankListData?.banks || []).map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                  <option value={OTHER_BANK_VALUE}>{bankListData?.other_label || t('Otro')}</option>
                </select>
              </div>
              {selectedBank === OTHER_BANK_VALUE && (
                <input
                  value={otherBankName}
                  onChange={(e) => setOtherBankName(e.target.value)}
                  placeholder={t('Nombre del banco')}
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              )}
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('Tipo de cuenta')}</label>
                <div className="flex gap-2">
                  {(['AHORRO', 'CORRIENTE'] as const).map((tType) => (
                    <button
                      key={tType}
                      type="button"
                      onClick={() => setAccountType(tType)}
                      className={`flex-1 text-xs rounded-lg border py-2 ${
                        accountType === tType ? 'border-[#185FA5] bg-[#185FA5]/5 text-[#185FA5]' : 'border-[#DDE1EE] text-[#475569]'
                      }`}
                    >
                      {tType === 'AHORRO' ? t('Ahorro') : t('Corriente')}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('N° de cuenta')}</label>
                <input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('Confirma el N° de cuenta')}</label>
                <input
                  value={accountNumberConfirm}
                  onChange={(e) => setAccountNumberConfirm(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('Nombre completo del titular')}</label>
                <input
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs text-[#475569] block mb-1">{t('CI del titular')}</label>
                <input
                  value={accountHolderCi}
                  onChange={(e) => setAccountHolderCi(e.target.value)}
                  className="w-full text-sm border border-[#DDE1EE] rounded-lg px-3 py-2"
                />
              </div>
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-[#475569] cursor-pointer">
            <input
              type="checkbox"
              checked={responsibilityAck}
              onChange={(e) => setResponsibilityAck(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('Confirmo que estos datos son correctos y son de mi titularidad. Entiendo que la plataforma no se hace responsable por transferencias a datos incorrectos que yo haya proporcionado.')}
            </span>
          </label>

          {formError && (
            <p className="text-xs px-3 py-2 rounded-lg border bg-[#FCEBEB] text-[#A32D2D] border-[#F09595]">
              {formError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 text-sm font-medium rounded-lg border border-[#DDE1EE] text-[#475569] py-2.5"
            >
              {t('Cancelar')}
            </button>
            <button
              onClick={submit}
              disabled={mutation.isPending}
              className="flex-1 text-sm font-medium rounded-lg bg-[#185FA5] text-white py-2.5 disabled:opacity-60"
            >
              {mutation.isPending ? t('Guardando...') : t('Guardar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
