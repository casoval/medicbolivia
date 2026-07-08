'use client'
// src/app/admin/faq/page.tsx
// CRUD de preguntas frecuentes que se muestran en la landing pública (/).

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { ADMIN_NAV as NAV } from '@/lib/nav'
import { LoadingScreen, SectionTitle, EmptyState, Alert } from '@/components/ui'
import { faqAPI, getErrorMessage } from '@/lib/api'
import type { FAQ, FAQAudience } from '@/types'

const AUDIENCE_LABEL: Record<FAQAudience, string> = {
  GENERAL: 'General',
  PATIENT: 'Paciente',
  PROFESSIONAL: 'Profesional',
}

const AUDIENCE_BADGE: Record<FAQAudience, string> = {
  GENERAL: 'badge-gray',
  PATIENT: 'badge-blue',
  PROFESSIONAL: 'badge-green',
}

interface FormState {
  id: string | null // null = creando una nueva
  question: string
  answer: string
  audience: FAQAudience
  display_order: number
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  question: '',
  answer: '',
  audience: 'GENERAL',
  display_order: 0,
  is_active: true,
}

export default function AdminFAQPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'ALL' | FAQAudience>('ALL')

  const { data: faqs = [], isLoading } = useQuery({
    queryKey: ['admin', 'faqs'],
    queryFn: async () => (await faqAPI.listAdmin()).data,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'faqs'] })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        audience: form.audience,
        display_order: form.display_order,
        is_active: form.is_active,
      }
      if (form.id) return (await faqAPI.update(form.id, payload)).data
      return (await faqAPI.create(payload)).data
    },
    onSuccess: () => {
      setForm(EMPTY_FORM)
      setError('')
      invalidate()
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (vars: { id: string; is_active: boolean }) =>
      faqAPI.update(vars.id, { is_active: vars.is_active }),
    onSuccess: invalidate,
    onError: (err) => setError(getErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => faqAPI.delete(id),
    onSuccess: invalidate,
    onError: (err) => setError(getErrorMessage(err)),
  })

  function startEdit(faq: FAQ) {
    setForm({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      audience: faq.audience,
      display_order: faq.display_order,
      is_active: faq.is_active,
    })
    setError('')
  }

  function cancelEdit() {
    setForm(EMPTY_FORM)
    setError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.question.trim().length < 3 || form.answer.trim().length < 1) {
      setError('Completá la pregunta (mín. 3 caracteres) y la respuesta.')
      return
    }
    saveMutation.mutate()
  }

  const visibleFaqs = filter === 'ALL' ? faqs : faqs.filter((f) => f.audience === filter)

  return (
    <DashboardLayout navItems={NAV} activeHref="/admin/faq" role="ADMIN">
      <SectionTitle>Preguntas frecuentes</SectionTitle>
      <p className="text-sm text-[#6B738A] mb-4">
        Estas preguntas se muestran en la página principal (medicbolivia.com), visibles para
        cualquier visitante sin necesidad de iniciar sesión.
      </p>

      {/* ── Formulario crear/editar ── */}
      <form onSubmit={handleSubmit} className="card p-4 mb-6 space-y-3">
        <h3 className="text-sm font-semibold text-[#141820]">
          {form.id ? 'Editar pregunta' : 'Nueva pregunta'}
        </h3>

        {error && <Alert type="error" message={error} />}

        <div>
          <label className="text-xs font-medium text-[#6B738A]">Pregunta</label>
          <input
            className="input mt-1"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="Ej: ¿Cómo pago la consulta?"
            maxLength={300}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-[#6B738A]">Respuesta</label>
          <textarea
            className="input mt-1 min-h-[90px]"
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            placeholder="Respuesta completa que verá el visitante..."
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-[#6B738A]">Audiencia</label>
            <select
              className="input mt-1"
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value as FAQAudience })}
            >
              <option value="GENERAL">General (quiénes somos, etc.)</option>
              <option value="PATIENT">Paciente</option>
              <option value="PROFESSIONAL">Profesional</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-[#6B738A]">Orden</label>
            <input
              type="number"
              className="input mt-1"
              value={form.display_order}
              onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })}
            />
          </div>

          <div className="flex items-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm text-[#141820]">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Visible en el sitio
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear pregunta'}
          </button>
          {form.id && (
            <button type="button" className="btn-secondary" onClick={cancelEdit}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {/* ── Filtro por audiencia ── */}
      <div className="flex gap-2 mb-3">
        {(['ALL', 'GENERAL', 'PATIENT', 'PROFESSIONAL'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? 'bg-[#185FA5] text-white border-[#185FA5]'
                : 'bg-white text-[#6B738A] border-[#DDE1EE]'
            }`}
          >
            {f === 'ALL' ? 'Todas' : AUDIENCE_LABEL[f]}
          </button>
        ))}
      </div>

      {/* ── Listado ── */}
      {isLoading ? (
        <LoadingScreen text="Cargando preguntas..." />
      ) : visibleFaqs.length === 0 ? (
        <EmptyState title="No hay preguntas todavía" description="Creá la primera con el formulario de arriba." />
      ) : (
        <div className="space-y-2">
          {visibleFaqs.map((faq) => (
            <div key={faq.id} className="card p-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={AUDIENCE_BADGE[faq.audience]}>{AUDIENCE_LABEL[faq.audience]}</span>
                  {!faq.is_active && <span className="badge-gray">Oculta</span>}
                  <span className="text-[10px] text-[#6B738A]">orden: {faq.display_order}</span>
                </div>
                <p className="text-sm font-medium text-[#141820]">{faq.question}</p>
                <p className="text-xs text-[#6B738A] mt-1 whitespace-pre-wrap">{faq.answer}</p>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <button className="text-xs text-[#185FA5] hover:underline" onClick={() => startEdit(faq)}>
                  Editar
                </button>
                <button
                  className="text-xs text-[#854F0B] hover:underline"
                  onClick={() => toggleActiveMutation.mutate({ id: faq.id, is_active: !faq.is_active })}
                >
                  {faq.is_active ? 'Ocultar' : 'Mostrar'}
                </button>
                <button
                  className="text-xs text-[#A32D2D] hover:underline"
                  onClick={() => {
                    if (confirm('¿Eliminar esta pregunta? No se puede deshacer.')) {
                      deleteMutation.mutate(faq.id)
                    }
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
