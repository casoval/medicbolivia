'use client'
// src/app/professional/schedule/page.tsx

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, SectionTitle, Alert } from '@/components/ui'
import { scheduleAPI, professionalsAPI, getErrorMessage } from '@/lib/api'
import type { ScheduleBlock, ScheduleBlockInput } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

const DAYS = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]

interface EditableBlock extends ScheduleBlockInput {
  _key: string
}

function makeKey() {
  return Math.random().toString(36).slice(2)
}

export default function ProfessionalSchedulePage() {
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  const [blocks, setBlocks] = useState<EditableBlock[]>([])
  const [duration, setDuration] = useState(30)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const { data: existingBlocks, isLoading } = useQuery({
    queryKey: ['professional', 'schedule'],
    queryFn: () => scheduleAPI.getMine(),
  })

  const { data: myProfile } = useQuery({
    queryKey: ['professional', 'me', 'duration'],
    queryFn: () => professionalsAPI.getMyProfile(),
  })

  useEffect(() => {
    if (existingBlocks) {
      setBlocks(existingBlocks.map((b: ScheduleBlock) => ({
        _key: b.id,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        is_blocked: b.is_blocked,
      })))
    }
  }, [existingBlocks])

  useEffect(() => {
    if (myProfile?.appointment_duration_minutes) {
      setDuration(myProfile.appointment_duration_minutes)
    }
  }, [myProfile])

  const saveMutation = useMutation({
    mutationFn: async () => {
      await scheduleAPI.setMine(
        blocks.map(({ _key, ...rest }) => rest)
      )
      await professionalsAPI.updateProfile({ appointment_duration_minutes: duration })
    },
    onSuccess: () => {
      setError('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
      queryClient.invalidateQueries({ queryKey: ['professional', 'schedule'] })
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  function addBlock(day: number) {
    setBlocks((prev) => [
      ...prev,
      { _key: makeKey(), day_of_week: day, start_time: '09:00', end_time: '12:00', is_blocked: false },
    ])
  }

  function updateBlock(key: string, field: 'start_time' | 'end_time', value: string) {
    setBlocks((prev) => prev.map((b) => (b._key === key ? { ...b, [field]: value } : b)))
  }

  function removeBlock(key: string) {
    setBlocks((prev) => prev.filter((b) => b._key !== key))
  }

  if (isLoading) {
    return (
      <DashboardLayout navItems={NAV} activeHref="/professional/schedule" role="PROFESSIONAL">
        <LoadingScreen />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/schedule" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Mi horario semanal')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">
            Estos bloques se usan para sugerirle horarios al paciente cuando agenda una cita
            contigo, y también para el modo automático de disponibilidad.
          </p>
        </div>

        {error && (
          <div className="mb-4">
            <Alert type="error" message={error} />
          </div>
        )}
        {success && (
          <div className="mb-4">
            <Alert type="success" message="Horario guardado correctamente." />
          </div>
        )}

        {/* Duración de cada cita */}
        <div className="card mb-4">
          <SectionTitle>{t('Duración de cada cita')}</SectionTitle>
          <p className="text-xs text-[#6B738A] mt-1 mb-3">
            {t('Se usa para calcular los horarios disponibles y detectar choques entre citas.')}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={10}
              max={240}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
            />
            <span className="text-sm text-[#6B738A]">{t('minutos')}</span>
          </div>
        </div>

        {/* Bloques por día */}
        <div className="card">
          <SectionTitle>{t('Bloques de disponibilidad')}</SectionTitle>
          <div className="divide-y divide-[#DDE1EE] mt-2">
            {DAYS.map((day) => {
              const dayBlocks = blocks.filter((b) => b.day_of_week === day.value)
              return (
                <div key={day.value} className="py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{day.label}</p>
                    <button
                      onClick={() => addBlock(day.value)}
                      className="text-xs text-[#185FA5] font-medium"
                    >
                      {t('+ Agregar bloque')}
                    </button>
                  </div>

                  {dayBlocks.length === 0 ? (
                    <p className="text-xs text-[#A0A8BF]">{t('Sin horario este día')}</p>
                  ) : (
                    <div className="space-y-2">
                      {dayBlocks.map((b) => (
                        <div key={b._key} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={b.start_time}
                            onChange={(e) => updateBlock(b._key, 'start_time', e.target.value)}
                            className="px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                          />
                          <span className="text-xs text-[#A0A8BF]">a</span>
                          <input
                            type="time"
                            value={b.end_time}
                            onChange={(e) => updateBlock(b._key, 'end_time', e.target.value)}
                            className="px-2 py-1.5 border border-[#DDE1EE] rounded-lg text-sm focus:outline-none focus:border-[#185FA5]"
                          />
                          <button
                            onClick={() => removeBlock(b._key)}
                            className="text-xs text-[#A32D2D] ml-2"
                          >
                            {t('Eliminar')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="btn-primary text-sm py-2 px-5 mt-4 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Guardando...' : 'Guardar horario'}
          </button>
        </div>
      </div>
    </DashboardLayout>
  )
}