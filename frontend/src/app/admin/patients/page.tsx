'use client'
// src/app/admin/patients/page.tsx
// Gestión completa de pacientes para el administrador

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, EmptyState, SectionTitle, Alert } from '@/components/ui'
import { api, getErrorMessage } from '@/lib/api'
import { ConsultationHistorySection } from '@/components/admin/ConsultationHistorySection'

const DEPARTMENTS = [
  'Todos', 'La Paz', 'Santa Cruz', 'Cochabamba', 'Oruro',
  'Potosi', 'Tarija', 'Beni', 'Pando', 'Chuquisaca'
]

interface Patient {
  id: string
  user_id: string
  first_name: string
  last_name: string
  ci: string
  birth_date: string
  department: string
  gender?: string
  allergies: string[]
  chronic_conditions: string[]
  current_medications: string[]
  phone?: string
  email?: string
  created_at: string
  total_consultations?: number
  status?: string
}

// Modal de detalle del paciente
function PatientModal({ patient, onClose, onSuspend, onReactivate }: { patient: Patient; onClose: () => void; onSuspend: (userId: string) => void; onReactivate: (userId: string) => void }) {
  const age = patient.birth_date
    ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#DDE1EE]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-base font-bold">
              {patient.first_name[0]}{patient.last_name[0]}
            </div>
            <div>
              <h3 className="text-base font-semibold">{patient.first_name} {patient.last_name}</h3>
              <p className="text-xs text-[#6B738A]">CI: {patient.ci} · {patient.department}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl font-light">✕</button>
        </div>

        <div className="p-5 space-y-4">

          {/* Datos personales */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Datos personales</p>
            <div className="bg-[#F5F6FA] rounded-xl p-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-[#A0A8BF]">Edad</p>
                <p className="text-sm font-medium">{age ? `${age} años` : 'No especificada'}</p>
              </div>
              <div>
                <p className="text-xs text-[#A0A8BF]">Género</p>
                <p className="text-sm font-medium">{patient.gender || 'No especificado'}</p>
              </div>
              <div>
                <p className="text-xs text-[#A0A8BF]">Teléfono</p>
                <p className="text-sm font-medium">{patient.phone || 'No disponible'}</p>
              </div>
              <div>
                <p className="text-xs text-[#A0A8BF]">Email</p>
                <p className="text-sm font-medium truncate">{patient.email || 'No especificado'}</p>
              </div>
              <div>
                <p className="text-xs text-[#A0A8BF]">Departamento</p>
                <p className="text-sm font-medium">{patient.department}</p>
              </div>
              <div>
                <p className="text-xs text-[#A0A8BF]">Registrado</p>
                <p className="text-sm font-medium">
                  {new Date(patient.created_at).toLocaleDateString('es-BO', {
                    day: 'numeric', month: 'short', year: 'numeric'
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Historial médico */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Historial médico</p>
            <div className="space-y-2">

              {/* Alergias */}
              <div className="bg-[#FCEBEB] rounded-xl p-3">
                <p className="text-xs font-medium text-[#A32D2D] mb-1">⚠ Alergias</p>
                {patient.allergies && patient.allergies.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {patient.allergies.map((a, i) => (
                      <span key={i} className="bg-[#F7C1C1] text-[#A32D2D] text-xs px-2 py-0.5 rounded-full">
                        {a}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B738A]">Sin alergias registradas</p>
                )}
              </div>

              {/* Condiciones crónicas */}
              <div className="bg-[#FAEEDA] rounded-xl p-3">
                <p className="text-xs font-medium text-[#854F0B] mb-1">🏥 Condiciones crónicas</p>
                {patient.chronic_conditions && patient.chronic_conditions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {patient.chronic_conditions.map((c, i) => (
                      <span key={i} className="bg-[#FAD89A] text-[#854F0B] text-xs px-2 py-0.5 rounded-full">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B738A]">Sin condiciones crónicas</p>
                )}
              </div>

              {/* Medicación actual */}
              <div className="bg-[#E6F1FB] rounded-xl p-3">
                <p className="text-xs font-medium text-[#185FA5] mb-1">💊 Medicación actual</p>
                {patient.current_medications && patient.current_medications.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {patient.current_medications.map((m, i) => (
                      <span key={i} className="bg-[#B5D4F4] text-[#0C447C] text-xs px-2 py-0.5 rounded-full">
                        {m}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B738A]">Sin medicación registrada</p>
                )}
              </div>
            </div>
          </div>

          {/* Estadísticas */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Actividad</p>
            <div className="bg-[#F5F6FA] rounded-xl p-3 flex gap-4">
              <div className="text-center flex-1">
                <p className="text-xl font-bold text-[#185FA5]">{patient.total_consultations || 0}</p>
                <p className="text-xs text-[#6B738A]">Consultas</p>
              </div>
              <div className="w-px bg-[#DDE1EE]" />
              <div className="text-center flex-1">
                <p className="text-xs font-medium text-[#0F6E56] mt-1">
                  {patient.status === 'ACTIVE' ? '✓ Activo' : '✗ Inactivo'}
                </p>
                <p className="text-xs text-[#6B738A]">Estado</p>
              </div>
            </div>
          </div>

          {/* Historial detallado de consultas */}
          <div className="pt-2 border-t border-[#DDE1EE]">
            <ConsultationHistorySection endpoint={`/admin/patients/${patient.id}/history`} counterpartField="professional_name" />
          </div>
        </div>

        <div className="p-4 border-t border-[#DDE1EE] flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {patient.status === 'ACTIVE' ? (
              <button
                onClick={() => onSuspend(patient.user_id)}
                className="bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[#F7C1C1] transition-colors"
              >
                Suspender cuenta
              </button>
            ) : patient.status === 'SUSPENDED' ? (
              <button
                onClick={() => onReactivate(patient.user_id)}
                className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[#9FE1CB] transition-colors"
              >
                Reactivar cuenta
              </button>
            ) : null}
          </div>
          <button onClick={onClose} className="btn-secondary text-xs">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminPatientsPage() {
  const qc = useQueryClient()
  const [search, setSearch]         = useState('')
  const [department, setDepartment] = useState('Todos')
  const [selected, setSelected]     = useState<Patient | null>(null)
  const [tab, setTab]               = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE')
  const [success, setSuccess]       = useState('')
  const [error, setError]           = useState('')

  const suspendMutation = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: 'suspend' | 'reactivate' }) =>
      api.patch(`/admin/patients/${userId}/${action}`),
    onSuccess: (_, { action }) => {
      setSuccess(action === 'suspend' ? 'Cuenta suspendida' : 'Cuenta reactivada')
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['admin', 'patients'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['admin', 'patients'],
    queryFn: () => api.get('/admin/patients').then(r => r.data),
  })

  // Filtrar en frontend
  const filtered = patients.filter((p: Patient) => {
    const matchSearch = !search ||
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      p.ci.includes(search) ||
      p.phone?.includes(search)
    const matchDept = department === 'Todos' || p.department === department
    const matchTab  = tab === 'ACTIVE' ? p.status !== 'SUSPENDED' : p.status === 'SUSPENDED'
    return matchSearch && matchDept && matchTab
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/patients" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Gestión de pacientes</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            {patients.length} pacientes registrados
          </p>
        </div>

        {/* Tabs activos / suspendidos */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          <button onClick={() => setTab('ACTIVE')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === 'ACTIVE' ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
            }`}>
            Activos ({patients.filter((p:any) => p.status !== 'SUSPENDED').length})
          </button>
          <button onClick={() => setTab('SUSPENDED')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === 'SUSPENDED' ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
            }`}>
            Suspendidos ({patients.filter((p:any) => p.status === 'SUSPENDED').length})
          </button>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        {/* Filtros */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A8BF]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              className="w-full pl-8 pr-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
              placeholder="Buscar por nombre, CI o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Resultado */}
        {isLoading ? (
          <LoadingScreen text="Cargando pacientes..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No se encontraron pacientes"
            description="Intenta con otro filtro de búsqueda"
            action={
              <button onClick={() => { setSearch(''); setDepartment('Todos') }}
                className="btn-secondary text-xs">
                Limpiar filtros
              </button>
            }
          />
        ) : (
          <div className="card">
            <SectionTitle>
              {filtered.length} paciente{filtered.length !== 1 ? 's' : ''}
              {search && ` · búsqueda: "${search}"`}
            </SectionTitle>
            <div className="divide-y divide-[#DDE1EE]">
              {filtered.map((p: Patient) => {
                const age = p.birth_date
                  ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                  : null

                return (
                  <div
                    key={p.id}
                    className="py-3 flex items-center gap-3 hover:bg-[#F5F6FA] -mx-4 px-4 cursor-pointer transition-colors rounded-lg"
                    onClick={() => setSelected(p)}
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {p.first_name[0]}{p.last_name[0]}
                    </div>

                    {/* Info principal */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-[#6B738A]">
                        CI: {p.ci}
                        {age && ` · ${age} años`}
                        {' · '}{p.department}
                      </p>
                    </div>

                    {/* Alertas médicas */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      {p.allergies && p.allergies.length > 0 && (
                        <span className="badge-red text-[10px]" title="Tiene alergias">
                          ⚠ Alergia
                        </span>
                      )}
                      {p.chronic_conditions && p.chronic_conditions.length > 0 && (
                        <span className="badge-amber text-[10px]" title="Condición crónica">
                          🏥 Crónico
                        </span>
                      )}
                    </div>

                    {/* Consultas */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium text-[#185FA5]">
                        {p.total_consultations || 0} consultas
                      </p>
                      <p className="text-xs text-[#A0A8BF]">
                        {new Date(p.created_at).toLocaleDateString('es-BO', {
                          day: 'numeric', month: 'short'
                        })}
                      </p>
                    </div>

                    {/* Flecha */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="2" className="flex-shrink-0">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal detalle */}
      {selected && (
        <PatientModal
          patient={selected}
          onClose={() => setSelected(null)}
          onSuspend={(userId) => suspendMutation.mutate({ userId, action: 'suspend' })}
          onReactivate={(userId) => suspendMutation.mutate({ userId, action: 'reactivate' })}
        />
      )}
    </DashboardLayout>
  )
}