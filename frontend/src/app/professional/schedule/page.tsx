'use client'
// src/app/professional/schedule/page.tsx

import { useState, useEffect } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Alert, SectionTitle } from '@/components/ui'
import { professionalsAPI, getErrorMessage } from '@/lib/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
const IconCal   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
const IconFile  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconStar  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
const IconUser  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>

const NAV = [
  { label: 'Resumen',        href: '/professional/dashboard',     icon: <IconGrid /> },
  { label: 'Consultas',      href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Horarios',       href: '/professional/schedule',      icon: <IconCal /> },
  { label: 'Recetario',      href: '/professional/prescriptions', icon: <IconFile /> },
  { label: 'Calificaciones', href: '/professional/ratings',       icon: <IconStar /> },
  { label: 'Mi perfil',      href: '/professional/profile',       icon: <IconUser /> },
]

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SLOT_DURATIONS = [15, 20, 30, 45, 60]

function generateTimeSlots(durationMin: number): string[] {
  const slots: string[] = []
  for (let h = 7; h < 21; h++) {
    for (let m = 0; m < 60; m += durationMin) {
      if (h === 20 && m > 0) break
      slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
    }
  }
  return slots
}

type SlotState = 'available' | 'blocked' | 'free'
type SlotGrid  = Record<string, SlotState>

const SLOT_NEXT: Record<SlotState, SlotState> = {
  available: 'blocked',
  blocked:   'free',
  free:      'available',
}

const SLOT_STYLES: Record<SlotState, string> = {
  available: 'bg-[#E6F1FB] border-[#85B7EB] text-[#0C447C]',
  blocked:   'bg-[#F5F6FA] border-[#DDE1EE] text-[#A0A8BF]',
  free:      'bg-white border-[#DDE1EE] text-[#6B738A]',
}

const SLOT_LABELS: Record<SlotState, string> = {
  available: 'Disp.',
  blocked:   'Bloq.',
  free:      'Libre',
}

function buildGrid(duration: number): SlotGrid {
  const slots = generateTimeSlots(duration)
  const grid: SlotGrid = {}
  for (const time of slots) {
    for (let d = 0; d < 7; d++) {
      grid[`${d}-${time}`] = (d === 0 || d === 6) ? 'free' : 'available'
    }
  }
  return grid
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange?.(!on)}
      disabled={disabled}
      className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
        on ? 'bg-[#185FA5]' : 'bg-[#DDE1EE]'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
        on ? 'translate-x-5' : 'translate-x-1'
      }`} />
    </button>
  )
}

export default function SchedulePage() {
  const [success, setSuccess] = useState('')
  const [error, setError]     = useState('')
  const [initialized, setInitialized] = useState(false)

  // ── Disponibilidad ───────────────────────────────
  const [availMode, setAvailMode] = useState<'ONLINE_NOW' | 'SCHEDULED_ONLY' | 'OFFLINE'>('OFFLINE')

  // ── Precios ──────────────────────────────────────
  const [priceGeneral, setPriceGeneral]       = useState(100)
  const [priceUrgent, setPriceUrgent]         = useState(150)
  const [priceFollowUp, setPriceFollowUp]     = useState(80)
  const [urgentEnabled, setUrgentEnabled]     = useState(false)
  const [followUpEnabled, setFollowUpEnabled] = useState(false)

  // ── Horario ──────────────────────────────────────
  const [duration, setDuration] = useState(30)
  const [grid, setGrid]         = useState<SlotGrid>(() => buildGrid(30))

  // ── Cargar datos actuales desde la API ───────────
  const { data: myProfile } = useQuery({
    queryKey: ['professional-me'],
    queryFn: () => professionalsAPI.getMyProfile(),
    retry: false,
    staleTime: 0,
  })

  // Cuando llegan los datos, sincronizar el estado local (solo una vez)
  useEffect(() => {
    if (!myProfile || initialized) return
    if (myProfile.availability) setAvailMode(myProfile.availability)
    if (myProfile.price_general) setPriceGeneral(myProfile.price_general)
    if (myProfile.price_urgent    && myProfile.price_urgent    > 0) { setPriceUrgent(myProfile.price_urgent);     setUrgentEnabled(true)   }
    if (myProfile.price_follow_up && myProfile.price_follow_up > 0) { setPriceFollowUp(myProfile.price_follow_up); setFollowUpEnabled(true) }
    setInitialized(true)
  }, [myProfile, initialized])

  function handleDurationChange(newDur: number) {
    setDuration(newDur)
    setGrid(buildGrid(newDur))
  }

  function toggleSlot(day: number, time: string) {
    const key = `${day}-${time}`
    setGrid((prev) => ({ ...prev, [key]: SLOT_NEXT[prev[key]] }))
  }

  const queryClient = useQueryClient()

  const availMutation = useMutation({
      mutationFn: (mode: string) => professionalsAPI.updateAvailability(mode),
      onSuccess: (data, mode) => {
        setAvailMode(mode as any)
        queryClient.setQueryData(['professional-me'], (old: any) => ({
          ...old,
          availability: mode,
        }))
        setSuccess('Disponibilidad actualizada')
        setError('')
        setTimeout(() => setSuccess(''), 2500)
      },
    onError: (err) => {
      setError(getErrorMessage(err))
      setTimeout(() => setError(''), 4000)
    },
  })

  const priceMutation = useMutation({
    mutationFn: () => professionalsAPI.updatePrices({
      price_general:   priceGeneral,
      price_urgent:    urgentEnabled   ? priceUrgent   : 0,
      price_follow_up: followUpEnabled ? priceFollowUp : 0,
    }),
    onSuccess: () => {
      queryClient.setQueryData(['professional-me'], (old: any) => ({
        ...old,
        price_urgent:    urgentEnabled   ? priceUrgent   : 0,
        price_follow_up: followUpEnabled ? priceFollowUp : 0,
      }))
      setSuccess('Precios guardados correctamente')
      setError('')
      setTimeout(() => setSuccess(''), 2500)
    },
    onError: (err) => {
      setError(getErrorMessage(err))
      setTimeout(() => setError(''), 4000)
    },
  })

  const timeSlots = generateTimeSlots(duration)

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/schedule" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Horarios y precios</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Configura cuándo y a qué precio atiendes</p>
        </div>

        {success && <div className="mb-4"><Alert type="success" message={success} /></div>}
        {error   && <div className="mb-4"><Alert type="error"   message={error} /></div>}

        {/* Disponibilidad inmediata */}
        <div className="card mb-4">
          <SectionTitle>Disponibilidad ahora mismo</SectionTitle>
          <div className="space-y-2">
            {[
              { mode: 'ONLINE_NOW',     label: 'Disponible ahora',        desc: 'El agente IA te asignará pacientes en tiempo real', color: 'teal' },
              { mode: 'SCHEDULED_ONLY', label: 'Solo citas programadas',   desc: 'No recibirás pacientes inmediatos',                 color: 'amber' },
              { mode: 'OFFLINE',        label: 'No disponible',            desc: 'No aparecerás en el directorio',                   color: 'gray' },
            ].map(({ mode, label, desc, color }) => (
              <button key={mode} onClick={() => availMutation.mutate(mode)}
                disabled={availMutation.isPending}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                  availMode === mode
                    ? color === 'teal'  ? 'bg-[#E1F5EE] border-[#1D9E75]'
                    : color === 'amber' ? 'bg-[#FAEEDA] border-[#EF9F27]'
                    :                    'bg-[#F5F6FA] border-[#A0A8BF]'
                    : 'bg-white border-[#DDE1EE] hover:border-[#A0A8BF]'
                }`}>
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  availMode === mode
                    ? color === 'teal' ? 'bg-[#1D9E75]' : color === 'amber' ? 'bg-[#EF9F27]' : 'bg-[#A0A8BF]'
                    : 'bg-[#DDE1EE]'
                }`} />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-[#6B738A]">{desc}</p>
                </div>
                {availMutation.isPending && availMode !== mode ? null : availMode === mode && (
                  <span className="ml-auto text-xs font-medium text-[#0F6E56] bg-[#E1F5EE] px-2 py-0.5 rounded-full">Activo</span>
                )}
                {availMutation.isPending && (
                  <span className="ml-auto text-xs text-[#A0A8BF]">Guardando...</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Precios */}
        <div className="card mb-4">
          <SectionTitle>Precios de consulta (Bs.)</SectionTitle>

          <div className="flex items-center gap-4 py-3 border-b border-[#DDE1EE]">
            <div className="flex-1">
              <p className="text-sm font-medium">Consulta general</p>
              <p className="text-xs text-[#6B738A]">Primera consulta estándar · <span className="text-[#185FA5] font-medium">Obligatoria</span></p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#6B738A]">Bs.</span>
              <input type="number" min={0} step={10}
                value={priceGeneral}
                onChange={(e) => setPriceGeneral(Number(e.target.value))}
                className="w-20 px-3 py-1.5 border border-[#DDE1EE] rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[#185FA5]" />
            </div>
          </div>

          <div className={`flex items-center gap-4 py-3 border-b border-[#DDE1EE] transition-opacity ${!urgentEnabled ? 'opacity-60' : ''}`}>
            <div className="flex-1">
              <p className="text-sm font-medium">Consulta urgente</p>
              <p className="text-xs text-[#6B738A]">Atención prioritaria, tiempo de espera reducido</p>
            </div>
            <div className="flex items-center gap-2">
              {urgentEnabled && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[#6B738A]">Bs.</span>
                  <input type="number" min={0} step={10}
                    value={priceUrgent}
                    onChange={(e) => setPriceUrgent(Number(e.target.value))}
                    className="w-20 px-3 py-1.5 border border-[#DDE1EE] rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[#185FA5]" />
                </div>
              )}
              <Toggle on={urgentEnabled} onChange={setUrgentEnabled} />
            </div>
          </div>

          <div className={`flex items-center gap-4 py-3 transition-opacity ${!followUpEnabled ? 'opacity-60' : ''}`}>
            <div className="flex-1">
              <p className="text-sm font-medium">Consulta de control</p>
              <p className="text-xs text-[#6B738A]">Seguimiento de paciente previo (precio reducido)</p>
            </div>
            <div className="flex items-center gap-2">
              {followUpEnabled && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[#6B738A]">Bs.</span>
                  <input type="number" min={0} step={10}
                    value={priceFollowUp}
                    onChange={(e) => setPriceFollowUp(Number(e.target.value))}
                    className="w-20 px-3 py-1.5 border border-[#DDE1EE] rounded-lg text-sm text-right font-semibold focus:outline-none focus:border-[#185FA5]" />
                </div>
              )}
              <Toggle on={followUpEnabled} onChange={setFollowUpEnabled} />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#DDE1EE] flex items-center justify-between">
            <p className="text-xs text-[#A0A8BF]">
              Plataforma retiene 15% · Tu ganancia neta por consulta general:{' '}
              <span className="font-medium text-[#0F6E56]">Bs. {Math.round(priceGeneral * 0.85)}</span>
            </p>
            <button onClick={() => priceMutation.mutate()} disabled={priceMutation.isPending}
              className="btn-primary text-xs py-1.5 px-3">
              {priceMutation.isPending ? 'Guardando...' : 'Guardar precios'}
            </button>
          </div>
        </div>

        {/* Grilla de horarios */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle>Horario semanal</SectionTitle>
          </div>

          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <p className="text-xs font-medium text-[#6B738A] flex-shrink-0">Duración por consulta:</p>
            <div className="flex gap-1.5 flex-wrap">
              {SLOT_DURATIONS.map((d) => (
                <button key={d} onClick={() => handleDurationChange(d)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    duration === d
                      ? 'bg-[#185FA5] text-white border-[#185FA5] font-medium'
                      : 'bg-white border-[#DDE1EE] text-[#6B738A] hover:border-[#185FA5]'
                  }`}>
                  {d} min
                </button>
              ))}
            </div>
            <span className="text-xs text-[#A0A8BF]">
              ({Math.floor(60 / duration)} consultas/hora)
            </span>
          </div>

          <p className="text-xs text-[#6B738A] mb-3">
            Haz clic en cada bloque para cambiar entre <span className="text-[#185FA5]">Disponible</span> → <span className="text-[#A0A8BF]">Bloqueado</span> → Libre
          </p>

          <div className="overflow-x-auto">
            <div style={{
              display: 'grid',
              gridTemplateColumns: `56px repeat(7, 1fr)`,
              gap: '2px',
              minWidth: '520px'
            }}>
              <div />
              {DAYS.map((d, i) => (
                <div key={i} className="text-center text-xs font-medium text-[#6B738A] py-1.5">{d}</div>
              ))}

              {timeSlots.map((time) => (
                <>
                  <div key={`t-${time}`} className="text-xs text-[#A0A8BF] flex items-center justify-end pr-1.5 text-right leading-tight">
                    {time}
                  </div>
                  {[0,1,2,3,4,5,6].map((day) => {
                    const key   = `${day}-${time}`
                    const state = grid[key] || 'free'
                    return (
                      <button key={key} onClick={() => toggleSlot(day, time)}
                        style={{ fontSize: '10px', padding: '3px 2px' }}
                        className={`rounded border transition-colors ${SLOT_STYLES[state]}`}>
                        {SLOT_LABELS[state]}
                      </button>
                    )
                  })}
                </>
              ))}
            </div>
          </div>

          <div className="flex gap-4 mt-3 flex-wrap">
            {(Object.keys(SLOT_STYLES) as SlotState[]).map((state) => (
              <div key={state} className="flex items-center gap-1.5">
                <div className={`w-6 h-5 rounded border text-[10px] flex items-center justify-center ${SLOT_STYLES[state]}`}>
                  {SLOT_LABELS[state][0]}
                </div>
                <span className="text-xs text-[#6B738A]">{SLOT_LABELS[state]}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-between items-center pt-3 border-t border-[#DDE1EE]">
            <p className="text-xs text-[#A0A8BF]">
              {Object.values(grid).filter(v => v === 'available').length} bloques disponibles
            </p>
            <button className="btn-primary text-xs py-1.5 px-3">
              Guardar horario
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}