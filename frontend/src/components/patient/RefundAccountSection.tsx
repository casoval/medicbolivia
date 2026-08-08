'use client'
// src/components/patient/RefundAccountSection.tsx
// Sección de Perfil: cuenta PERMANENTE para recibir reembolsos —
// espejo exacto de la sección "Cuenta bancaria" del profesional
// (ver src/app/professional/profile/page.tsx). El paciente la carga una
// sola vez; a partir de ahí, cualquier reembolso futuro entra directo a
// la cola de "listos para pagar" del admin en cuanto la verifica, sin
// tener que completar nada de nuevo. A diferencia del profesional, acá
// se ofrecen dos métodos porque no todo paciente tiene cuenta bancaria
// formal — billetera móvil / QR interpersonal es la opción accesible.
// Ver PUT /patients/me/refund-account y app/services/refund_payout.py.

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { professionalsAPI, patientsAPI, getErrorMessage } from '@/lib/api'
import { Alert, SectionTitle } from '@/components/ui'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const OTHER_BANK_VALUE = '__OTHER__'

export function RefundAccountSection() {
  const { t } = useLanguage()
  const queryClient = useQueryClient()

  const [method, setMethod] = useState<'BANK' | 'MOBILE_WALLET'>('MOBILE_WALLET')
  const [selectedBank, setSelectedBank] = useState('')
  const [otherBankName, setOtherBankName] = useState('')
  const [accountType, setAccountType] = useState<'AHORRO' | 'CORRIENTE'>('AHORRO')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountNumberConfirm, setAccountNumberConfirm] = useState('')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [accountHolderCi, setAccountHolderCi] = useState('')
  const [walletProvider, setWalletProvider] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [responsibilityAck, setResponsibilityAck] = useState(false)

  const [success, setSuccess] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const { data: myAccount } = useQuery({
    queryKey: ['patient', 'refund-account'],
    queryFn: patientsAPI.getMyRefundAccount,
  })

  const { data: bankListData } = useQuery({
    queryKey: ['bank-list'],
    queryFn: professionalsAPI.getBankList,
    enabled: method === 'BANK',
  })

  // Precarga el formulario con lo que ya tiene guardado, para que
  // "editar" no obligue a escribir todo de nuevo (salvo el número de
  // cuenta, que nunca se devuelve completo por seguridad).
  useEffect(() => {
    if (!myAccount) return
    setMethod(myAccount.method)
    if (myAccount.method === 'BANK') {
      setSelectedBank(myAccount.bank_name || '')
      setAccountType((myAccount.account_type as 'AHORRO' | 'CORRIENTE') || 'AHORRO')
      setAccountHolderName(myAccount.account_holder_name || '')
    } else {
      setWalletProvider(myAccount.wallet_provider || '')
      setPhoneNumber(myAccount.phone_number || '')
    }
  }, [myAccount])

  const saveMutation = useMutation({
    mutationFn: () => patientsAPI.updateMyRefundAccount(method === 'BANK' ? {
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
    onSuccess: () => {
      setSuccess(t('Cuenta guardada. Un administrador la revisará antes de tu próximo reembolso.'))
      setErrorMsg('')
      setAccountNumber('')
      setAccountNumberConfirm('')
      queryClient.invalidateQueries({ queryKey: ['patient', 'refund-account'] })
    },
    onError: (err) => { setErrorMsg(getErrorMessage(err)); setSuccess('') },
  })

  function save() {
    setErrorMsg('')
    if (!responsibilityAck) {
      setErrorMsg(t('Debes confirmar que los datos son correctos y aceptar la responsabilidad indicada'))
      return
    }
    if (method === 'BANK') {
      const bankNameFinal = selectedBank === OTHER_BANK_VALUE ? otherBankName.trim() : selectedBank
      if (!bankNameFinal) { setErrorMsg(t('Selecciona o escribe tu banco')); return }
      if (!accountNumber || !accountNumberConfirm) { setErrorMsg(t('Completa el número de cuenta')); return }
      if (accountNumber !== accountNumberConfirm) { setErrorMsg(t('El número de cuenta y su confirmación no coinciden')); return }
      if (!accountHolderName.trim() || !accountHolderCi.trim()) { setErrorMsg(t('Completa el nombre y CI del titular')); return }
    } else {
      if (!walletProvider.trim()) { setErrorMsg(t('Indica el proveedor (ej. Tigo Money, QR de tu banco)')); return }
      if (!phoneNumber.trim()) { setErrorMsg(t('Indica el número de celular')); return }
    }
    saveMutation.mutate()
  }

  return (
    <div className="card">
      <SectionTitle>{t('Cuenta para reembolsos')}</SectionTitle>
      <p className="text-xs text-[#475569] mb-3">
        {t('Si alguna vez te corresponde un reembolso (por ejemplo, una cita cancelada), lo transferimos acá. Cárgala una sola vez.')}
      </p>

      {success && <div className="mb-3"><Alert type="success" message={success} /></div>}
      {errorMsg && <div className="mb-3"><Alert type="error" message={errorMsg} /></div>}

      {myAccount && (
        <div className="mb-4 p-3 rounded-lg bg-[#F5F6FA] border border-[#DDE1EE]">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-[#141820]">
              {myAccount.method === 'BANK' ? myAccount.bank_name : myAccount.wallet_provider}
            </p>
            {myAccount.verified ? (
              <span className="text-xs font-semibold text-[#0F6E56] bg-[#E3F6EF] px-2 py-0.5 rounded-full whitespace-nowrap">
                ✓ {t('Verificada')}
              </span>
            ) : (
              <span className="text-xs font-semibold text-[#B45309] bg-[#FEF3C7] px-2 py-0.5 rounded-full whitespace-nowrap">
                {t('Pendiente de revisión')}
              </span>
            )}
          </div>
          {myAccount.method === 'BANK' ? (
            <>
              <p className="text-xs text-[#475569]">
                {myAccount.account_type === 'AHORRO' ? t('Cuenta de ahorro') : t('Cuenta corriente')} · {myAccount.account_number_masked}
              </p>
              <p className="text-xs text-[#475569]">{t('Titular')}: {myAccount.account_holder_name}</p>
            </>
          ) : (
            <p className="text-xs text-[#475569]">{myAccount.phone_number}</p>
          )}
          {!myAccount.verified && (
            <p className="text-xs text-[#B45309] mt-1">
              {t('Un administrador la revisará antes de tu próximo reembolso.')}
            </p>
          )}
        </div>
      )}

      <p className="text-xs font-semibold text-[#141820] mb-2">
        {myAccount ? t('Cambiar cuenta') : t('Registrar cuenta')}
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
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
            <label className="block text-xs font-medium text-[#475569] mb-1">{t('Proveedor')}</label>
            <input
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
              value={walletProvider}
              onChange={(e) => setWalletProvider(e.target.value)}
              placeholder={t('Ej. Tigo Money, QR de mi banco')}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">{t('Número de celular')}</label>
            <input
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="7XXXXXXX"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">{t('Banco')}</label>
            <select
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
              value={selectedBank}
              onChange={(e) => setSelectedBank(e.target.value)}
            >
              <option value="">{t('Selecciona tu banco')}</option>
              {(bankListData?.banks || []).map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
              <option value={OTHER_BANK_VALUE}>{bankListData?.other_label || t('Otro')}</option>
            </select>
          </div>

          {selectedBank === OTHER_BANK_VALUE && (
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-1">
                {t('Nombre del banco o cooperativa')}
              </label>
              <input
                className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                placeholder={t('Ej: Cooperativa Jesús Nazareno')}
                value={otherBankName}
                onChange={(e) => setOtherBankName(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">{t('Tipo de cuenta')}</label>
            <select
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as 'AHORRO' | 'CORRIENTE')}
            >
              <option value="AHORRO">{t('Cuenta de ahorro')}</option>
              <option value="CORRIENTE">{t('Cuenta corriente')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">{t('Número de cuenta')}</label>
            <input
              type="text" inputMode="numeric"
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">
              {t('Confirma tu número de cuenta')}
            </label>
            <input
              type="text" inputMode="numeric"
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
              value={accountNumberConfirm}
              onChange={(e) => setAccountNumberConfirm(e.target.value.replace(/[^\d]/g, ''))}
            />
            <p className="text-xs text-[#64748B] mt-1">
              {t('Revisa bien cada dígito — una vez transferido, un error en la cuenta puede ser difícil o imposible de corregir.')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">
              {t('Nombre completo del titular')}
            </label>
            <input
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
              placeholder={t('Tal como figura en el banco')}
              value={accountHolderName}
              onChange={(e) => setAccountHolderName(e.target.value)}
            />
            <p className="text-xs text-[#64748B] mt-1">
              {t('Puede ser otra persona, por ejemplo si la cuenta no está a tu nombre')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">{t('CI del titular')}</label>
            <input
              className="w-full px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
              value={accountHolderCi}
              onChange={(e) => setAccountHolderCi(e.target.value)}
            />
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 text-xs text-[#475569] leading-snug mt-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={responsibilityAck}
          onChange={(e) => setResponsibilityAck(e.target.checked)}
        />
        <span>
          {t('Confirmo que estos datos son correctos y son de mi titularidad. Entiendo que MedicBolivia no se hace responsable por transferencias enviadas a datos incorrectos que yo haya ingresado, y que corregir un envío ya realizado puede no ser posible o tomar tiempo adicional.')}
        </span>
      </label>

      <button
        onClick={save}
        disabled={saveMutation.isPending}
        className="btn-primary text-xs py-1.5 px-3 mt-3"
      >
        {saveMutation.isPending ? t('Guardando...') : t('Guardar cuenta')}
      </button>
    </div>
  )
}
