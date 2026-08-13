'use client'
// src/app/admin/specialties/page.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, SectionTitle, EmptyState, Alert } from '@/components/ui'
import { specialtiesAPI, getErrorMessage } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

interface Proposal {
  id: string
  professional_id: string
  type: 'SPECIALTY' | 'SUB_SPECIALTY'
  proposed_name: string
  parent_specialty_id: string | null
  parent_specialty_name: string | null
  parent_proposal_id: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  final_name: string | null
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
  depends_on_pending_specialty?: boolean
  parent_proposal_name?: string | null
}

interface SubSpecialtyItem {
  id: string
  name: string
  is_active: boolean
  specialty_id: string
}

interface SpecialtyWithSubs {
  id: string
  name: string
  is_active: boolean
  sub_specialties: SubSpecialtyItem[]
}

function TypeBadge({ type }: { type: 'SPECIALTY' | 'SUB_SPECIALTY' }) {
  const { t } = useLanguage()
  return type === 'SPECIALTY' ? (
    <span className="badge-blue">{t('Especialidad')}</span>
  ) : (
    <span className="badge-amber">{t('Subespecialidad')}</span>
  )
}

export default function AdminSpecialtiesPage() {
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'catalog' | 'proposals'>('catalog')

  // ── Estado: catálogo ──
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [newSpecialtyName, setNewSpecialtyName] = useState('')
  const [editingSpecialty, setEditingSpecialty] = useState<{ id: string; name: string } | null>(null)
  const [newSubName, setNewSubName] = useState<{ [specialtyId: string]: string }>({})
  const [editingSub, setEditingSub] = useState<{ id: string; name: string } | null>(null)
  const [catalogError, setCatalogError] = useState('')

  const { data: catalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: ['admin', 'specialties-catalog'],
    queryFn: () => specialtiesAPI.adminListCatalog() as Promise<SpecialtyWithSubs[]>,
  })

  const invalidateCatalog = () => queryClient.invalidateQueries({ queryKey: ['admin', 'specialties-catalog'] })

  const createSpecialtyMutation = useMutation({
    mutationFn: (name: string) => specialtiesAPI.adminCreateSpecialty(name),
    onSuccess: () => {
      setNewSpecialtyName('')
      setCatalogError('')
      invalidateCatalog()
    },
    onError: (err) => setCatalogError(getErrorMessage(err)),
  })

  const updateSpecialtyMutation = useMutation({
    mutationFn: (vars: { id: string; data: { name?: string; is_active?: boolean } }) =>
      specialtiesAPI.adminUpdateSpecialty(vars.id, vars.data),
    onSuccess: () => {
      setEditingSpecialty(null)
      setCatalogError('')
      invalidateCatalog()
    },
    onError: (err) => setCatalogError(getErrorMessage(err)),
  })

  const createSubMutation = useMutation({
    mutationFn: (vars: { specialtyId: string; name: string }) =>
      specialtiesAPI.adminCreateSubSpecialty(vars.specialtyId, vars.name),
    onSuccess: (_, vars) => {
      setNewSubName((prev) => ({ ...prev, [vars.specialtyId]: '' }))
      setCatalogError('')
      invalidateCatalog()
    },
    onError: (err) => setCatalogError(getErrorMessage(err)),
  })

  const updateSubMutation = useMutation({
    mutationFn: (vars: { id: string; data: { name?: string; is_active?: boolean } }) =>
      specialtiesAPI.adminUpdateSubSpecialty(vars.id, vars.data),
    onSuccess: () => {
      setEditingSub(null)
      setCatalogError('')
      invalidateCatalog()
    },
    onError: (err) => setCatalogError(getErrorMessage(err)),
  })

  // ── Estado: propuestas ──
  // Esta pestaña es de SOLO LECTURA — historial de propuestas. Aprobar o
  // rechazar (con la opción de corregir el nombre) ya se hace desde la
  // ficha del profesional en Admin → Profesionales (ver SpecialtyReviewRow
  // en esa página), que es donde el admin ya está revisando el resto de
  // sus datos y documentos. Tener el mismo Aprobar/Rechazar acá también
  // era exactamente el duplicado que se pidió sacar.
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING')

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ['admin', 'specialty-proposals', statusFilter],
    queryFn: () => specialtiesAPI.listProposals(statusFilter) as Promise<Proposal[]>,
    refetchInterval: 30000,
  })

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/specialties" role="ADMIN">
      <div className="max-w-4xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Especialidades y subespecialidades')}</h1>
          <p className="text-xs text-[#475569] mt-0.5">
            {t('Gestiona el catálogo y revisa las propuestas enviadas por profesionales')}
          </p>
        </div>

        {/* Selector de pestañas */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('catalog')}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              tab === 'catalog'
                ? 'bg-[#E6F1FB] border-[#185FA5] text-[#185FA5] font-medium'
                : 'bg-white border-[#DDE1EE] text-[#475569]'
            }`}
          >
            {t('Catálogo')}
          </button>
          <button
            onClick={() => setTab('proposals')}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              tab === 'proposals'
                ? 'bg-[#E6F1FB] border-[#185FA5] text-[#185FA5] font-medium'
                : 'bg-white border-[#DDE1EE] text-[#475569]'
            }`}
          >
            {t('Propuestas')}
          </button>
        </div>

        {tab === 'catalog' && (
          <div>
            {catalogError && (
              <div className="mb-3">
                <Alert type="error" message={catalogError} />
              </div>
            )}

            {/* Crear especialidad nueva */}
            <div className="card mb-4">
              <SectionTitle>{t('Nueva especialidad')}</SectionTitle>
              <div className="flex gap-2 mt-2">
                <input
                  className="flex-1 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                  placeholder={t('Ej. Medicina General')}
                  value={newSpecialtyName}
                  onChange={(e) => setNewSpecialtyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSpecialtyName.trim()) {
                      createSpecialtyMutation.mutate(newSpecialtyName.trim())
                    }
                  }}
                />
                <button
                  className="btn-secondary text-sm py-2 px-4 flex-shrink-0 disabled:opacity-50"
                  disabled={!newSpecialtyName.trim() || createSpecialtyMutation.isPending}
                  onClick={() => createSpecialtyMutation.mutate(newSpecialtyName.trim())}
                >
                  {createSpecialtyMutation.isPending ? 'Creando...' : '+ Agregar'}
                </button>
              </div>
            </div>

            {catalogLoading ? <LoadingScreen /> : (
              <div className="card">
                <SectionTitle>
                  {catalog.length} especialidad{catalog.length !== 1 ? 'es' : ''} en el catálogo
                </SectionTitle>

                {catalog.length === 0 ? (
                  <EmptyState title="Todavía no hay especialidades creadas" />
                ) : (
                  <div className="divide-y divide-[#DDE1EE]">
                    {catalog.map((s) => {
                      const isExpanded = expandedId === s.id
                      const isEditingThis = editingSpecialty?.id === s.id
                      return (
                        <div key={s.id} className="py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : s.id)}
                              className="text-[#475569] flex-shrink-0"
                              aria-label="Expandir"
                            >
                              {isExpanded ? '▾' : '▸'}
                            </button>

                            {isEditingThis ? (
                              <input
                                autoFocus
                                className="flex-1 px-2 py-1 border border-[#185FA5] rounded text-sm focus:outline-none"
                                value={editingSpecialty.name}
                                onChange={(e) => setEditingSpecialty({ id: s.id, name: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && editingSpecialty.name.trim()) {
                                    updateSpecialtyMutation.mutate({ id: s.id, data: { name: editingSpecialty.name.trim() } })
                                  }
                                  if (e.key === 'Escape') setEditingSpecialty(null)
                                }}
                              />
                            ) : (
                              <span className={`flex-1 text-sm font-medium ${!s.is_active ? 'text-[#64748B] line-through' : ''}`}>
                                {s.name}
                              </span>
                            )}

                            {!s.is_active && <span className="badge-red">{t('Inactiva')}</span>}

                            {isEditingThis ? (
                              <>
                                <button
                                  className="text-xs text-[#185FA5] font-medium flex-shrink-0"
                                  onClick={() => editingSpecialty.name.trim() && updateSpecialtyMutation.mutate({ id: s.id, data: { name: editingSpecialty.name.trim() } })}
                                >
                                  {t('Guardar')}
                                </button>
                                <button
                                  className="text-xs text-[#475569] flex-shrink-0"
                                  onClick={() => setEditingSpecialty(null)}
                                >
                                  {t('Cancelar')}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="text-xs text-[#185FA5] flex-shrink-0"
                                  onClick={() => setEditingSpecialty({ id: s.id, name: s.name })}
                                >
                                  {t('Editar')}
                                </button>
                                <button
                                  className={`text-xs flex-shrink-0 ${s.is_active ? 'text-[#A32D2D]' : 'text-[#0F6E56]'}`}
                                  onClick={() => updateSpecialtyMutation.mutate({ id: s.id, data: { is_active: !s.is_active } })}
                                  disabled={updateSpecialtyMutation.isPending}
                                >
                                  {s.is_active ? 'Desactivar' : 'Activar'}
                                </button>
                              </>
                            )}
                          </div>

                          {isExpanded && (
                            <div className="ml-6 mt-2 space-y-1.5">
                              {s.sub_specialties.length === 0 && (
                                <p className="text-xs text-[#64748B]">{t('Sin subespecialidades todavía')}</p>
                              )}
                              {s.sub_specialties.map((sub) => {
                                const isEditingSub = editingSub?.id === sub.id
                                return (
                                  <div key={sub.id} className="flex items-center gap-2">
                                    {isEditingSub ? (
                                      <input
                                        autoFocus
                                        className="flex-1 px-2 py-1 border border-[#185FA5] rounded text-xs focus:outline-none"
                                        value={editingSub.name}
                                        onChange={(e) => setEditingSub({ id: sub.id, name: e.target.value })}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && editingSub.name.trim()) {
                                            updateSubMutation.mutate({ id: sub.id, data: { name: editingSub.name.trim() } })
                                          }
                                          if (e.key === 'Escape') setEditingSub(null)
                                        }}
                                      />
                                    ) : (
                                      <span className={`flex-1 text-xs ${!sub.is_active ? 'text-[#64748B] line-through' : 'text-[#3C4257]'}`}>
                                        {sub.name}
                                      </span>
                                    )}

                                    {!sub.is_active && <span className="badge-red">{t('Inactiva')}</span>}

                                    {isEditingSub ? (
                                      <>
                                        <button
                                          className="text-xs text-[#185FA5] font-medium flex-shrink-0"
                                          onClick={() => editingSub.name.trim() && updateSubMutation.mutate({ id: sub.id, data: { name: editingSub.name.trim() } })}
                                        >
                                          {t('Guardar')}
                                        </button>
                                        <button
                                          className="text-xs text-[#475569] flex-shrink-0"
                                          onClick={() => setEditingSub(null)}
                                        >
                                          {t('Cancelar')}
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          className="text-xs text-[#185FA5] flex-shrink-0"
                                          onClick={() => setEditingSub({ id: sub.id, name: sub.name })}
                                        >
                                          {t('Editar')}
                                        </button>
                                        <button
                                          className={`text-xs flex-shrink-0 ${sub.is_active ? 'text-[#A32D2D]' : 'text-[#0F6E56]'}`}
                                          onClick={() => updateSubMutation.mutate({ id: sub.id, data: { is_active: !sub.is_active } })}
                                          disabled={updateSubMutation.isPending}
                                        >
                                          {sub.is_active ? 'Desactivar' : 'Activar'}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )
                              })}

                              {/* Agregar subespecialidad */}
                              <div className="flex gap-2 mt-2">
                                <input
                                  className="flex-1 px-2 py-1 border border-[#DDE1EE] rounded text-xs focus:outline-none focus:border-[#185FA5]"
                                  placeholder={t('Nueva subespecialidad...')}
                                  value={newSubName[s.id] || ''}
                                  onChange={(e) => setNewSubName((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    const val = (newSubName[s.id] || '').trim()
                                    if (e.key === 'Enter' && val) {
                                      createSubMutation.mutate({ specialtyId: s.id, name: val })
                                    }
                                  }}
                                />
                                <button
                                  className="text-xs text-[#185FA5] font-medium flex-shrink-0 disabled:opacity-50"
                                  disabled={!(newSubName[s.id] || '').trim() || createSubMutation.isPending}
                                  onClick={() => {
                                    const val = (newSubName[s.id] || '').trim()
                                    if (val) createSubMutation.mutate({ specialtyId: s.id, name: val })
                                  }}
                                >
                                  {t('+ Agregar')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'proposals' && (
        <div className="max-w-4xl">

        {/* Filtros */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                statusFilter === s
                  ? 'bg-[#E6F1FB] border-[#185FA5] text-[#185FA5] font-medium'
                  : 'bg-white border-[#DDE1EE] text-[#475569]'
              }`}
            >
              {s === 'PENDING' ? 'Pendientes' : s === 'APPROVED' ? 'Aprobadas' : 'Rechazadas'}
            </button>
          ))}
        </div>

        {isLoading ? <LoadingScreen /> : (
          <div className="card">
            <SectionTitle>
              {proposals.length} propuesta{proposals.length !== 1 ? 's' : ''}
            </SectionTitle>

            {proposals.length === 0 ? (
              <EmptyState
                title="No hay propuestas con este filtro"
                description={statusFilter === 'PENDING' ? 'Todo al día por ahora.' : undefined}
              />
            ) : (
              <div className="divide-y divide-[#DDE1EE]">
                {proposals.map((p) => (
                  <div key={p.id} className="py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TypeBadge type={p.type} />
                        <span className="text-sm font-medium">{p.proposed_name}</span>
                      </div>
                      {p.type === 'SUB_SPECIALTY' && (
                        <p className="text-xs text-[#475569] mt-1">
                          de {p.parent_specialty_name || p.parent_proposal_name || 'especialidad sin determinar'}
                          {p.depends_on_pending_specialty && (
                            <span className="text-[#854F0B]"> {t('· depende de una propuesta aún pendiente')}</span>
                          )}
                        </p>
                      )}
                      {p.status === 'APPROVED' && p.final_name && p.final_name !== p.proposed_name && (
                        <p className="text-xs text-[#0F6E56] mt-0.5">→ aprobada como: {p.final_name}</p>
                      )}
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {new Date(p.created_at).toLocaleString('es-BO')}
                      </p>
                      {p.admin_note && (
                        <p className="text-xs text-[#475569] mt-1 italic">Nota: {p.admin_note}</p>
                      )}
                    </div>
                    {p.status === 'PENDING' ? (
                      <span className="text-xs text-[#64748B] flex-shrink-0 text-right">
                        {t('Revisar desde el perfil del profesional')}
                      </span>
                    ) : (
                      <span className={p.status === 'APPROVED' ? 'badge-green' : 'badge-red'}>
                        {p.status === 'APPROVED' ? 'Aprobada' : 'Rechazada'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
        )}
      </div>
    </DashboardLayout>
  )
}