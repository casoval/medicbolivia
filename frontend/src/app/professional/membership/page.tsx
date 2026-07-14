'use client'
// src/app/professional/membership/page.tsx
//
// Estado de mi membresía (la habilita/deshabilita un admin manualmente) +
// lista de pacientes vinculados. Con membresía activa puedo agendarles
// citas directamente, sin límite de horario disponible y con comisión 0%.
// El vínculo en sí lo crea y revoca siempre el paciente — acá solo leo.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, EmptyState, Alert, SectionTitle } from '@/components/ui'
import { PatientAvatar } from '@/components/shared/PatientAvatar'
import { ProfessionalScheduleModal } from '@/components/professional/ProfessionalScheduleModal'
import { professionalsAPI } from '@/lib/api'
import type { PatientLink } from '@/lib/api'

export default function MembershipPage() {
  const [scheduling, setScheduling] = useState<PatientLink | null>(null)

  const { data: membership, isLoading: loadingMembership } = useQuery({
    queryKey: ['my-membership'],
    queryFn: professionalsAPI.getMyMembership,
    staleTime: 30_000,
  })

  const { data: patients = [], isLoading: loadingPatients } = useQuery({
    queryKey: ['my-linked-patients'],
    queryFn: professionalsAPI.getMyPatients,
    staleTime: 30_000,
  })

  const { data: profile } = useQuery({
    queryKey: ['professional-profile'],
    queryFn: professionalsAPI.getMyProfile,
    staleTime: 60_000,
  })

  const isActive = !!membership?.active
  const defaultAmount = profile ? parseFloat((profile as any).price_general || '0') : 0
  const isLoading = loadingMembership || loadingPatients

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/membership" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Membresía</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Pacientes vinculados y agendamiento directo sin comisión
          </p>
        </div>

        {isLoading ? (
          <LoadingScreen text="Cargando..." />
        ) : (
          <div className="space-y-4">
            {isActive ? (
              <Alert
                type="success"
                message="Tu membresía está activa: no pagas comisión por tus consultas y puedes agendar directamente a tus pacientes vinculados, en cualquier horario."
              />
            ) : (
              <Alert
                type="info"
                message="No tienes una membresía activa. Contacta al administrador para habilitarla — mientras tanto, sigues operando con la comisión normal por consulta."
              />
            )}

            <div className="card">
              <SectionTitle>Mis pacientes vinculados</SectionTitle>
              <p className="text-xs text-[#6B738A] mb-3">
                Aparecen acá los pacientes que se vincularon a ti desde su cuenta (el vínculo lo crea y lo revoca
                siempre el paciente).
              </p>

              {patients.length === 0 ? (
                <EmptyState
                  title="Todavía no tienes pacientes vinculados"
                  description="Cuando un paciente se vincule contigo desde su búsqueda de profesionales, aparecerá aquí."
                />
              ) : (
                <div className="divide-y divide-[#DDE1EE]">
                  {patients.map((link) => (
                    <div key={link.id} className="flex items-center gap-3 py-3">
                      <PatientAvatar
                        firstName={link.patient_first_name}
                        lastName={link.patient_last_name}
                        photoUrl={link.patient_photo_url}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {link.patient_first_name} {link.patient_last_name}
                        </p>
                        <p className="text-xs text-[#6B738A]">
                          Vinculado desde el {new Date(link.created_at).toLocaleDateString('es-BO', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </p>
                      </div>
                      <button
                        onClick={() => setScheduling(link)}
                        disabled={!isActive}
                        title={!isActive ? 'Necesitas una membresía activa para agendar directamente' : undefined}
                        className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Agendar cita
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {scheduling && (
        <ProfessionalScheduleModal
          link={scheduling}
          defaultAmount={defaultAmount}
          onClose={() => setScheduling(null)}
        />
      )}
    </DashboardLayout>
  )
}
