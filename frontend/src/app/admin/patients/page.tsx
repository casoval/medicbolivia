'use client'
// src/app/admin/patients/page.tsx
// Gestión completa de pacientes para el administrador

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, EmptyState, SectionTitle, Alert } from '@/components/ui'
import { api, adminAPI, getErrorMessage } from '@/lib/api'
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
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [local, setLocal] = useState(patient) // copia mostrada en pantalla, se actualiza tras guardar
  const [form, setForm] = useState({
    first_name: patient.first_name,
    last_name: patient.last_name,
    ci: patient.ci,
    birth_date: patient.birth_date ? patient.birth_date.slice(0, 10) : '',
    department: patient.department,
    gender: patient.gender || '',
    phone: patient.phone || '',
    email: patient.email || '',
  })
  const [confirmLogin, setConfirmLogin] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveWarnings, setSaveWarnings] = useState<string[]>([])

  // El login es solo por número de celular (el email es solo dato de contacto,
  // no se usa para entrar), así que solo el teléfono dispara la advertencia.
  const loginFieldChanged = form.phone !== (patient.phone || '')

  const saveMutation = useMutation({
    mutationFn: () => adminAPI.updatePatient(local.user_id, {
      first_name: form.first_name,
      last_name: form.last_name,
      ci: form.ci,
      birth_date: form.birth_date || undefined,
      department: form.department,
      gender: form.gender || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
    }),
    onSuccess: (res) => {
      setLocal((prev) => ({ ...prev, ...form }))
      setSaveWarnings(res.warnings || [])
      setEditing(false)
      setSaveError('')
      qc.invalidateQueries({ queryKey: ['admin', 'patients'] })
    },
    onError: (err) => setSaveError(getErrorMessage(err)),
  })

  function startEdit() {
    setForm({
      first_name: local.first_name,
      last_name: local.last_name,
      ci: local.ci,
      birth_date: local.birth_date ? local.birth_date.slice(0, 10) : '',
      department: local.department,
      gender: local.gender || '',
      phone: local.phone || '',
      email: local.email || '',
    })
    setConfirmLogin(false)
    setSaveError('')
    setEditing(true)
  }

  const age = local.birth_date
    ? Math.floor((Date.now() - new Date(local.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#DDE1EE]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#E6F1FB] text-[#185FA5] flex items-center justify-center text-base font-bold">
              {local.first_name[0]}{local.last_name[0]}
            </div>
            <div>
              <h3 className="text-base font-semibold">{local.first_name} {local.last_name}</h3>
              <p className="text-xs text-[#6B738A]">CI: {local.ci} · {local.department}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl font-light">✕</button>
        </div>

        <div className="p-5 space-y-4">

          {saveWarnings.length > 0 && (
            <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-xl p-3">
              {saveWarnings.map((w, i) => (
                <p key={i} className="text-xs text-[#854F0B]">⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Datos personales */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide">Datos personales</p>
              {!editing && (
                <button onClick={startEdit} className="text-xs text-[#185FA5] hover:underline">Editar</button>
              )}
            </div>

            {!editing ? (
              <div className="bg-[#F5F6FA] rounded-xl p-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-[#A0A8BF]">Fecha de nacimiento</p>
                  <p className="text-sm font-medium">
                    {local.birth_date
                      ? new Date(local.birth_date).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })
                      : 'No especificada'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#A0A8BF]">Edad</p>
                  <p className="text-sm font-medium">{age ? `${age} años` : 'No especificada'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#A0A8BF]">Género</p>
                  <p className="text-sm font-medium">{local.gender || 'No especificado'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#A0A8BF]">Teléfono</p>
                  <p className="text-sm font-medium">{local.phone || 'No disponible'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#A0A8BF]">Email</p>
                  <p className="text-sm font-medium truncate">{local.email || 'No especificado'}</p>
                </div>
                <div>
                  <p className="text-xs text-[#A0A8BF]">Departamento</p>
                  <p className="text-sm font-medium">{local.department}</p>
                </div>
                <div>
                  <p className="text-xs text-[#A0A8BF]">Registrado</p>
                  <p className="text-sm font-medium">
                    {new Date(local.created_at).toLocaleDateString('es-BO', {
                      day: 'numeric', month: 'short', year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-[#F5F6FA] rounded-xl p-3 space-y-3">
                {saveError && <Alert type="error" message={saveError} />}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Nombre</label>
                    <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Apellido</label>
                    <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">CI</label>
                    <input value={form.ci} onChange={(e) => setForm({ ...form, ci: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Fecha de nacimiento</label>
                    <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Departamento</label>
                    <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white">
                      {DEPARTMENTS.filter((d) => d !== 'Todos').map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Género</label>
                    <input value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Email</label>
                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                </div>

                {/* Teléfono — es el único dato usado para iniciar sesión */}
                <div className="bg-[#FAEEDA] border border-[#FAC775] rounded-lg p-2.5 space-y-2">
                  <p className="text-[11px] text-[#854F0B]">
                    ⚠ El paciente inicia sesión con su número de celular. Si lo cambias, ya no podrá
                    entrar con el número anterior — asegúrate de avisarle.
                  </p>
                  <div>
                    <label className="block text-xs text-[#6B738A] mb-1">Teléfono</label>
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm bg-white" />
                  </div>
                  {loginFieldChanged && (
                    <label className="flex items-start gap-2 text-[11px] text-[#854F0B]">
                      <input type="checkbox" checked={confirmLogin} onChange={(e) => setConfirmLogin(e.target.checked)}
                        className="mt-0.5" />
                      Entiendo que esto cambia cómo el paciente inicia sesión.
                    </label>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditing(false)} className="btn-secondary text-xs py-1.5 px-3">Cancelar</button>
                  <button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending || (loginFieldChanged && !confirmLogin)}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
                  >
                    {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Historial médico */}
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Historial médico</p>
            <div className="space-y-2">

              {/* Alergias */}
              <div className="bg-[#FCEBEB] rounded-xl p-3">
                <p className="text-xs font-medium text-[#A32D2D] mb-1">⚠ Alergias</p>
                {local.allergies && local.allergies.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {local.allergies.map((a, i) => (
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
                {local.chronic_conditions && local.chronic_conditions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {local.chronic_conditions.map((c, i) => (
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
                {local.current_medications && local.current_medications.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {local.current_medications.map((m, i) => (
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
                <p className="text-xl font-bold text-[#185FA5]">{local.total_consultations || 0}</p>
                <p className="text-xs text-[#6B738A]">Consultas</p>
              </div>
              <div className="w-px bg-[#DDE1EE]" />
              <div className="text-center flex-1">
                <p className="text-xs font-medium text-[#0F6E56] mt-1">
                  {local.status === 'ACTIVE' ? '✓ Activo' : '✗ Inactivo'}
                </p>
                <p className="text-xs text-[#6B738A]">Estado</p>
              </div>
            </div>
          </div>

          {/* Historial detallado de consultas */}
          <div className="pt-2 border-t border-[#DDE1EE]">
            <ConsultationHistorySection endpoint={`/admin/patients/${local.id}/history`} counterpartField="professional_name" />
          </div>
        </div>

        <div className="p-4 border-t border-[#DDE1EE] flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {local.status === 'ACTIVE' ? (
              <button
                onClick={() => onSuspend(local.user_id)}
                className="bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[#F7C1C1] transition-colors"
              >
                Suspender cuenta
              </button>
            ) : local.status === 'SUSPENDED' ? (
              <button
                onClick={() => onReactivate(local.user_id)}
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