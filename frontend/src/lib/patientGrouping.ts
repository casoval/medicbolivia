// src/lib/patientGrouping.ts
//
// Agrupa las consultas de un profesional por paciente, combinando el
// historial de consultas con la lista de vínculos (activos y revocados)
// en una sola fuente de verdad — usada tanto en "Mis pacientes" como en
// el calendario (para elegir a quién agendarle una cita directa).
//
// Estados que cuentan como "el paciente está activo conmigo ahora" — listo
// para atender, en curso, o con una cita agendada todavía por venir.
import type { PatientLink } from '@/lib/api'

const ACTIVE_STATUSES = new Set(['WAITING_PROFESSIONAL', 'PAYMENT_CONFIRMED', 'IN_PROGRESS'])

export interface PatientGroup {
  patientId: string
  name: string
  firstName: string
  lastName: string
  photoUrl: string | null
  initials: string
  consultations: any[]
  total: number
  completed: number
  isActive: boolean
  lastAt: string
  // true si tiene un vínculo activo (PatientProfessionalLink) — ya sea
  // porque se vinculó a mano o porque se creó automáticamente al
  // completarse una consulta.
  hasActiveLink: boolean
  // true si el paciente se desvinculó explícitamente (existe una fila de
  // vínculo, pero con revoked_at). En ese caso NUNCA se habilita
  // "Agendar cita", aunque tenga consultas completadas previas — la
  // desvinculación es una decisión explícita del paciente y hay que
  // respetarla (ver has_effective_link en el backend).
  linkWasRevoked: boolean
  link: PatientLink | null
}

// Combina el historial de consultas con la lista de vínculos (activos y
// revocados) en una sola lista de pacientes, para no tener "Mis
// pacientes" y "Membresía" mostrando datos distintos y confusos.
// - Pacientes con consultas: aparecen con su historial completo.
// - Pacientes solo vinculados (nunca tuvieron consulta, se vincularon a
//   mano desde la búsqueda): aparecen igual, con 0 consultas.
// - Si se desvincularon explícitamente, se marcan con linkWasRevoked
//   para que la tarjeta no ofrezca "Agendar cita" aunque tengan
//   historial de consultas.
export function groupByPatient(consultations: any[], links: PatientLink[]): PatientGroup[] {
  const map = new Map<string, PatientGroup>()
  // `links` trae la fila MÁS RECIENTE por paciente (activa o revocada) —
  // ver GET /professionals/my-patients.
  const linkByPatient = new Map(links.map((l) => [l.patient_id, l]))

  for (const c of consultations) {
    if (!c.patient_id) continue
    const name = c.patient_first_name ? `${c.patient_first_name} ${c.patient_last_name || ''}`.trim() : 'Paciente'
    const initials = ((c.patient_first_name?.[0] || '') + (c.patient_last_name?.[0] || '')).toUpperCase() || 'P'

    const isFutureScheduled =
      c.consultation_type === 'SCHEDULED' &&
      c.scheduled_at &&
      new Date(c.scheduled_at).getTime() > Date.now() &&
      c.status !== 'CANCELLED' && c.status !== 'REFUNDED'

    const isActiveNow = ACTIVE_STATUSES.has(c.status) || isFutureScheduled

    let group = map.get(c.patient_id)
    if (!group) {
      const link = linkByPatient.get(c.patient_id) || null
      group = {
        patientId: c.patient_id,
        name,
        firstName: c.patient_first_name || '',
        lastName: c.patient_last_name || '',
        photoUrl: c.patient_photo_url || null,
        initials,
        consultations: [],
        total: 0,
        completed: 0,
        isActive: false,
        lastAt: c.created_at,
        hasActiveLink: !!link && link.revoked_at === null,
        linkWasRevoked: !!link && link.revoked_at !== null,
        link,
      }
      map.set(c.patient_id, group)
    }
    // La foto es del paciente (no de la consulta), así que basta con
    // quedarnos con la primera que venga con foto.
    if (c.patient_photo_url && !group.photoUrl) {
      group.photoUrl = c.patient_photo_url
    }
    group.consultations.push(c)
    group.total += 1
    if (c.status === 'COMPLETED') group.completed += 1
    if (isActiveNow) group.isActive = true
    if (new Date(c.created_at).getTime() > new Date(group.lastAt).getTime()) group.lastAt = c.created_at
  }

  // Pacientes vinculados ACTIVAMENTE que todavía no tienen ninguna
  // consulta (se vincularon a mano desde la búsqueda) — no están en
  // `consultations`, hay que agregarlos aparte para que no queden
  // "escondidos" en otra pantalla. Los revocados sin ninguna consulta NO
  // se agregan: no hay nada que mostrar y ya no están vinculados.
  for (const link of links) {
    if (map.has(link.patient_id)) continue
    if (link.revoked_at !== null) continue
    const name = link.patient_first_name ? `${link.patient_first_name} ${link.patient_last_name || ''}`.trim() : 'Paciente'
    const initials = ((link.patient_first_name?.[0] || '') + (link.patient_last_name?.[0] || '')).toUpperCase() || 'P'
    map.set(link.patient_id, {
      patientId: link.patient_id,
      name,
      firstName: link.patient_first_name || '',
      lastName: link.patient_last_name || '',
      photoUrl: link.patient_photo_url || null,
      initials,
      consultations: [],
      total: 0,
      completed: 0,
      isActive: false,
      lastAt: link.created_at,
      hasActiveLink: true,
      linkWasRevoked: false,
      link,
    })
  }

  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

// Vínculo "efectivo" para agendamiento directo — replica exactamente la
// regla del backend (app/services/patient_links.py::has_effective_link):
// cuenta el vínculo manual activo O el historial de consultas completadas,
// pero nunca si el paciente se desvinculó explícitamente.
export function hasEffectiveLink(group: PatientGroup): boolean {
  return !group.linkWasRevoked && (group.hasActiveLink || group.completed > 0)
}

// Construye un objeto PatientLink mínimo y válido para pasarle a
// ProfessionalScheduleModal, aun cuando el paciente no tiene una fila de
// vínculo real (solo llegó por su historial de consultas) — el modal solo
// usa patient_id y el nombre del paciente.
export function linkForSchedule(group: PatientGroup): PatientLink {
  return (
    group.link ?? {
      id: '',
      patient_id: group.patientId,
      professional_id: '',
      created_at: group.lastAt,
      revoked_at: null,
      patient_first_name: group.firstName,
      patient_last_name: group.lastName,
      patient_photo_url: group.photoUrl,
    }
  )
}
