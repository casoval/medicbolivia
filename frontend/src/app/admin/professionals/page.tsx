'use client'
// src/app/admin/professionals/page.tsx — con filtro ciudad, contadores en tabs y mas datos
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { StatusBadge, LoadingScreen, Alert } from '@/components/ui'
import { api, getErrorMessage } from '@/lib/api'

const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
const IconCard  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
const IconBot   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconLog   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconCog   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>

const NAV = [
  { label: 'Resumen',       href: '/admin/dashboard',      icon: <IconGrid /> },
  { label: 'Profesionales', href: '/admin/professionals',  icon: <IconUsers /> },
  { label: 'Pacientes',     href: '/admin/patients',       icon: <IconUsers /> },
  { label: 'Pagos',         href: '/admin/payments',       icon: <IconCard /> },
  { label: 'Agente IA',     href: '/admin/agent',          icon: <IconBot /> },
  { label: 'Auditoria',     href: '/admin/logs',           icon: <IconLog /> },
  { label: 'Configuracion', href: '/admin/settings',       icon: <IconCog /> },
]

const DEPARTMENTS = ['Todos','La Paz','Santa Cruz','Cochabamba','Oruro','Potosi','Tarija','Beni','Pando','Chuquisaca']

interface Professional {
  id: string; name: string; specialty: string; status: string; availability: string
  rating: number; total_ratings: number; total_consultations: number; created_at: string
  bio?: string; languages?: string[]; years_experience?: number; cmb_matricula?: string
  sedes_number?: string; price_general?: number; price_urgent?: number; price_follow_up?: number
  phone?: string; email?: string; ci?: string; birth_date?: string; department?: string; gender?: string
  user_status?: string
}

function getAge(birthDate?: string): number | null {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25*24*60*60*1000))
}

function ProfessionalModal({ professional: pro, onClose, onAction, loading }: {
  professional: Professional; onClose: () => void
  onAction: (id: string, status: string) => void; loading: boolean
}) {
  const age = getAge(pro.birth_date)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#DDE1EE]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-base font-bold">
              {pro.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
            </div>
            <div>
              <h3 className="text-base font-semibold">{pro.name}</h3>
              <p className="text-xs text-[#6B738A]">{pro.specialty}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B738A] hover:text-[#141820] text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
              <StatusBadge status={pro.status} />
              <p className="text-xs text-[#6B738A] mt-1">Estado</p>
            </div>
            <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-[#EF9F27]">{Number(pro.rating).toFixed(1)} ★</p>
              <p className="text-xs text-[#6B738A]">{pro.total_ratings} calificaciones</p>
            </div>
            <div className="bg-[#F5F6FA] rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-[#185FA5]">{pro.total_consultations}</p>
              <p className="text-xs text-[#6B738A]">Consultas</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Datos personales</p>
            <div className="bg-[#F5F6FA] rounded-xl p-3 grid grid-cols-2 gap-3">
              <div><p className="text-xs text-[#A0A8BF]">Telefono</p><p className="text-sm font-medium">{pro.phone || 'No disponible'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Email</p><p className="text-sm font-medium truncate">{pro.email || 'No especificado'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Cedula</p><p className="text-sm font-medium">{pro.ci || 'No disponible'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Edad</p><p className="text-sm font-medium">{age ? `${age} anios` : 'No especificada'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Ciudad / Departamento</p><p className="text-sm font-medium">{pro.department || 'No especificado'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Genero</p><p className="text-sm font-medium">{pro.gender || 'No especificado'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Experiencia</p><p className="text-sm font-medium">{pro.years_experience ? `${pro.years_experience} anios` : 'No especificada'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Idiomas</p><p className="text-sm font-medium">{pro.languages?.join(', ') || 'Espanol'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">Matricula CMB</p><p className="text-sm font-medium">{pro.cmb_matricula || 'No registrada'}</p></div>
              <div><p className="text-xs text-[#A0A8BF]">SEDES</p><p className="text-sm font-medium">{pro.sedes_number || 'No registrado'}</p></div>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Precios de consulta</p>
            <div className="bg-[#F5F6FA] rounded-xl p-3 grid grid-cols-3 gap-3">
              <div className="text-center"><p className="text-sm font-bold text-[#185FA5]">Bs. {pro.price_general || 0}</p><p className="text-xs text-[#6B738A]">General</p></div>
              <div className="text-center"><p className="text-sm font-bold text-[#A32D2D]">Bs. {pro.price_urgent || 0}</p><p className="text-xs text-[#6B738A]">Urgente</p></div>
              <div className="text-center"><p className="text-sm font-bold text-[#0F6E56]">Bs. {pro.price_follow_up || 0}</p><p className="text-xs text-[#6B738A]">Seguimiento</p></div>
            </div>
          </div>
          {pro.bio && (
            <div>
              <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-2">Presentacion</p>
              <p className="text-sm text-[#3A4155] bg-[#F5F6FA] rounded-xl p-3 leading-relaxed">{pro.bio}</p>
            </div>
          )}
          <div className="pt-2 border-t border-[#DDE1EE]">
            <p className="text-xs font-semibold text-[#6B738A] uppercase tracking-wide mb-3">Acciones</p>
            <div className="flex gap-2 flex-wrap">
              {(pro.status === 'PENDING_DOCS' || pro.status === 'UNDER_REVIEW') && (<>
                <button onClick={() => onAction(pro.id,'APPROVED')} disabled={loading}
                  className="flex-1 bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] py-2 rounded-lg text-xs font-medium disabled:opacity-50">Aprobar</button>
                <button onClick={() => onAction(pro.id,'REJECTED')} disabled={loading}
                  className="flex-1 bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] py-2 rounded-lg text-xs font-medium disabled:opacity-50">Rechazar</button>
              </>)}
              {pro.status === 'APPROVED' && (
                <button onClick={() => onAction(pro.id,'SUSPENDED')} disabled={loading}
                  className="bg-[#FCEBEB] text-[#A32D2D] border border-[#F09595] px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50">Suspender cuenta</button>
              )}
              {pro.status === 'SUSPENDED' && (
                <button onClick={() => onAction(pro.id,'APPROVED')} disabled={loading}
                  className="bg-[#E1F5EE] text-[#0F6E56] border border-[#9FE1CB] px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50">Reactivar cuenta</button>
              )}
              <button onClick={onClose} className="btn-secondary text-xs px-4 py-2">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminProfessionalsPage() {
  const qc = useQueryClient()
  const [tab, setTab]           = useState<'APPROVED'|'PENDING_DOCS'|'SUSPENDED'>('APPROVED')
  const [success, setSuccess]   = useState('')
  const [error, setError]       = useState('')
  const [selected, setSelected] = useState<Professional|null>(null)
  const [search, setSearch]     = useState('')
  const [department, setDepartment] = useState('Todos')

  const { data: allPros = [], isLoading } = useQuery({
    queryKey: ['admin', 'professionals', 'all'],
    queryFn: () => api.get('/admin/professionals').then(r => r.data),
  })

  // Counts for each tab
  const counts = {
    APPROVED:    allPros.filter((p:Professional) => p.status === 'APPROVED').length,
    PENDING_DOCS: allPros.filter((p:Professional) => ['PENDING_DOCS','UNDER_REVIEW'].includes(p.status)).length,
    SUSPENDED:   allPros.filter((p:Professional) => p.status === 'SUSPENDED').length,
  }

  // Filter by tab + search + department
  const filtered = allPros.filter((p: Professional) => {
    const matchTab = tab === 'APPROVED'
      ? p.status === 'APPROVED'
      : tab === 'PENDING_DOCS'
      ? ['PENDING_DOCS','UNDER_REVIEW'].includes(p.status)
      : p.status === 'SUSPENDED'
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.specialty.toLowerCase().includes(search.toLowerCase()) ||
      p.phone?.includes(search)
    const matchDept = department === 'Todos' || p.department === department
    return matchTab && matchSearch && matchDept
  })

  const verifyMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/professionals/${id}/verify`, null, { params: { new_status: status } }),
    onSuccess: (_, { status }) => {
      const msgs: Record<string,string> = { APPROVED:'Profesional aprobado', REJECTED:'Profesional rechazado', SUSPENDED:'Profesional suspendido' }
      setSuccess(msgs[status] || 'Estado actualizado')
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['admin','professionals'] })
      setTimeout(() => setSuccess(''), 3000)
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/professionals" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Gestion de profesionales</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Clic en un profesional para ver su detalle completo</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        {/* Tabs con contadores */}
        <div className="flex gap-1 bg-[#F5F6FA] p-1 rounded-xl mb-4 w-fit">
          {([
            { key: 'APPROVED',    label: 'Activos' },
            { key: 'PENDING_DOCS',label: 'Pendientes' },
            { key: 'SUSPENDED',   label: 'Suspendidos' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                tab === key ? 'bg-white text-[#141820] border border-[#DDE1EE]' : 'text-[#6B738A]'
              }`}>
              {label}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                tab === key ? 'bg-[#185FA5] text-white' : 'bg-[#DDE1EE] text-[#6B738A]'
              }`}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A0A8BF]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="w-full pl-8 pr-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
              placeholder="Buscar por nombre, especialidad o celular..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5] bg-white"
            value={department} onChange={(e) => setDepartment(e.target.value)}>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {isLoading ? <LoadingScreen /> : (
          <div className="card">
            {filtered.length === 0 ? (
              <p className="text-sm text-[#6B738A] text-center py-8">No hay profesionales en este estado</p>
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {filtered.map((pro: Professional) => {
                  const age = getAge(pro.birth_date)
                  return (
                    <div key={pro.id}
                      className="py-3 flex items-center gap-3 hover:bg-[#F5F6FA] -mx-4 px-4 cursor-pointer transition-colors rounded-lg"
                      onClick={() => setSelected(pro)}>
                      <div className="w-10 h-10 rounded-full bg-[#E1F5EE] text-[#0F6E56] flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {pro.name.split(' ').map((n:string)=>n[0]).join('').slice(0,2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{pro.name}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <span className="text-xs text-[#6B738A]">{pro.specialty}</span>
                          {pro.department && <span className="text-xs text-[#A0A8BF]">· {pro.department}</span>}
                          {age && <span className="text-xs text-[#A0A8BF]">· {age} años</span>}
                          {pro.phone && <span className="text-xs text-[#A0A8BF]">· {pro.phone}</span>}
                        </div>
                      </div>
                      {pro.rating > 0 && (
                        <span className="text-xs text-[#EF9F27] flex-shrink-0">★ {Number(pro.rating).toFixed(1)}</span>
                      )}
                      <StatusBadge status={pro.status} />
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A0A8BF" strokeWidth="2" className="flex-shrink-0">
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && (
        <ProfessionalModal professional={selected} onClose={() => setSelected(null)}
          onAction={(id, status) => verifyMutation.mutate({ id, status })}
          loading={verifyMutation.isPending} />
      )}
    </DashboardLayout>
  )
}
