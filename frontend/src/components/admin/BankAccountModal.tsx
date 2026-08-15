// src/components/admin/BankAccountModal.tsx
// Modal para ver la cuenta bancaria completa de un profesional puntual
// (número sin enmascarar) y, si corresponde, marcarla como verificada.
// Cada vista queda registrada en auditoría en el backend.
//
// Extraído de admin/payouts/page.tsx (donde vivía como función local) para
// poder reutilizarlo también desde la ficha de un profesional en
// admin/professionals — antes la ÚNICA forma de verificar una cuenta era
// entrar a "Pagos a profesionales", y esa lista solo incluye a quienes ya
// tienen ganancias liberadas sin pagar. Un profesional recién aprobado que
// todavía no tuvo ninguna consulta cobrada JAMÁS aparecía ahí, así que su
// cuenta quedaba sin forma de verificarse hasta su primer pago pendiente.
'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { LoadingScreen, Alert } from '@/components/ui'
import { adminAPI, getErrorMessage } from '@/lib/api'

function fmtFecha(iso?: string | null): string {
  if (!iso) return '—'
  const s = iso.endsWith('Z') ? iso : iso + 'Z'
  return new Date(s).toLocaleDateString('es-BO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz',
  })
}

export function BankAccountModal({
  professionalId, professionalName, onClose, onVerified,
}: {
  professionalId: string
  professionalName: string
  onClose: () => void
  onVerified: () => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-bank-account', professionalId],
    queryFn: () => adminAPI.getProfessionalBankAccount(professionalId),
  })

  const verifyMutation = useMutation({
    mutationFn: () => adminAPI.verifyProfessionalBankAccount(professionalId),
    onSuccess: () => {
      onVerified()
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">{professionalName}</p>
          <button onClick={onClose} className="text-[#475569] hover:text-[#141820] text-xl">✕</button>
        </div>

        {isLoading && <LoadingScreen text="Cargando cuenta bancaria..." />}
        {error && <Alert type="error" message={getErrorMessage(error)} />}

        {data && (
          <div className="space-y-2 text-sm">
            <div><span className="text-[#64748B]">Banco: </span><span className="font-medium">{data.bank_name}</span></div>
            <div>
              <span className="text-[#64748B]">Tipo de cuenta: </span>
              <span className="font-medium">{data.account_type === 'AHORRO' ? 'Ahorro' : 'Corriente'}</span>
            </div>
            <div><span className="text-[#64748B]">Número de cuenta: </span><span className="font-mono font-medium">{data.account_number}</span></div>
            <div><span className="text-[#64748B]">Titular: </span><span className="font-medium">{data.account_holder_name}</span></div>
            <div><span className="text-[#64748B]">CI del titular: </span><span className="font-medium">{data.account_holder_ci}</span></div>
            <p className="text-xs text-[#94A0B8] pt-2">
              Aceptó la responsabilidad por estos datos el {fmtFecha(data.responsibility_acknowledged_at)}.
            </p>

            {!data.verified && (
              <button
                onClick={() => verifyMutation.mutate()}
                disabled={verifyMutation.isPending}
                className="btn-primary text-xs py-1.5 px-3 mt-2"
              >
                {verifyMutation.isPending ? 'Verificando...' : 'Marcar como verificada'}
              </button>
            )}
            {data.verified && (
              <p className="text-xs text-[#0F6E56] font-medium pt-1">✓ Cuenta verificada</p>
            )}
            {verifyMutation.isError && (
              <div className="mt-2"><Alert type="error" message={getErrorMessage(verifyMutation.error)} /></div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
