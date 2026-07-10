// src/lib/api.ts
import axios, { AxiosError } from 'axios'
import type {
  AuthResponse, User, Professional, Consultation,
  Payment, Prescription, AgentResponse, Rating, FAQ
} from '@/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'

// Construye la URL pública que codifica el QR de una receta: al escanearla
// con la cámara del celular, abre directo la página de verificación con el
// código ya cargado — en vez de solo mostrar el texto plano del código.
export function buildPrescriptionVerifyUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://medicbolivia.com'
  return `${origin}/verificar-receta?code=${encodeURIComponent(code)}`
}

// ── Configuración de la plataforma (admin → Configuración) ──
export interface PlatformSettings {
  app_name: string
  commission_percent: number
  open_registration_patients: boolean
  open_registration_professionals: boolean
  maintenance_mode: boolean
  alerts: {
    no_response: boolean
    daily_report: boolean
    pending_payment: boolean
    low_rating: boolean
    new_professional: boolean
  }
  updated_at: string | null
}

export interface PlatformSettingsUpdate {
  app_name?: string
  commission_percent?: number
  open_registration_patients?: boolean
  open_registration_professionals?: boolean
  maintenance_mode?: boolean
  alert_no_response?: boolean
  alert_daily_report?: boolean
  alert_pending_payment?: boolean
  alert_low_rating?: boolean
  alert_new_professional?: boolean
}

// ── Comisión por período / por profesional ──
// Complementa a PlatformSettings.commission_percent: permite promociones
// con fecha de inicio/fin (scope GLOBAL) y comisiones individuales por
// profesional (scope PROFESSIONAL), por ejemplo un % reducido de
// bienvenida para profesionales nuevos.
export type CommissionScope = 'GLOBAL' | 'PROFESSIONAL'

export interface CommissionPeriod {
  id: string
  scope: CommissionScope
  professional_id: string | null
  percent: number
  label: string | null
  starts_at: string
  ends_at: string | null
  active: boolean
  created_at: string
}

export interface CommissionPeriodCreate {
  scope: CommissionScope
  professional_id?: string | null
  percent: number
  label?: string
  starts_at: string
  ends_at?: string | null
}

export interface CommissionPeriodUpdate {
  percent?: number
  label?: string
  starts_at?: string
  ends_at?: string | null
  active?: boolean
}

export interface CurrentCommission {
  percent: number
  source: 'PROFESSIONAL' | 'GLOBAL_PROMO' | 'DEFAULT'
  label: string | null
  ends_at: string | null
}

// ── Disputas de pago ──────────────────────────────────
export type DisputeCategory = 'NO_SHOW' | 'MALA_CALIDAD' | 'TECNICO' | 'OTRO'
export type DisputeResolution = 'RELEASE' | 'REFUND_FULL' | 'REFUND_PARTIAL'

export interface DisputedPayment {
  payment_id: string
  consultation_id: string
  amount: number
  professional_net: number
  dispute_category: string | null
  dispute_reason: string | null
  disputed_at: string | null
  sla_deadline: string | null
  consultation_duration_minutes: number | null
  has_clinical_note: boolean
  has_prescription: boolean
}

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('mb_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  // Si el cuerpo es FormData (subida de archivos), eliminamos el
  // Content-Type fijo de la instancia ('application/json') para que
  // axios/el navegador generen el header correcto con el boundary
  // del multipart. Si no se hace esto, el backend no puede parsear
  // el archivo aunque el FormData se arme bien.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    // Nota: excluimos /auth/login a propósito. Un 401 ahí es "contraseña
    // incorrecta" (no una sesión expirada), así que no corresponde borrar
    // el token ni recargar la página — eso hacía que el mensaje de error
    // desapareciera a los pocos segundos en cada intento fallido de login.
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('mb_token')
      localStorage.removeItem('mb_user')
      window.location.href = '/auth/login'
    }

    // Modo mantenimiento: el backend bloquea a todo rol que no sea ADMIN
    // (ver get_current_user en dependencies.py) y devuelve este código.
    const detail = (error.response?.data as any)?.detail
    if (error.response?.status === 503 && detail?.code === 'MAINTENANCE_MODE') {
      if (typeof window !== 'undefined' && window.location.pathname !== '/mantenimiento') {
        window.location.href = '/mantenimiento'
      }
    }

    return Promise.reject(error)
  }
)

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail

    // Caso normal: detail es un texto plano
    if (typeof detail === 'string') return detail

    // Caso 422 de FastAPI/Pydantic: detail es un arreglo de {type, loc, msg, input}
    if (Array.isArray(detail)) {
      const messages = detail
        .map((d: any) => {
          if (typeof d === 'string') return d
          const field = Array.isArray(d?.loc) ? d.loc[d.loc.length - 1] : null
          return field ? `${field}: ${d?.msg || 'valor inválido'}` : d?.msg
        })
        .filter(Boolean)
      if (messages.length) return messages.join(' — ')
    }

    // Caso menos común: detail es un objeto
    if (detail && typeof detail === 'object') {
      if (typeof (detail as any).msg === 'string') return (detail as any).msg
      if (typeof (detail as any).message === 'string') return (detail as any).message
    }

    return 'Error de conexión. Intenta de nuevo.'
  }
  return 'Error inesperado.'
}

export const authAPI = {
  registerPatient: (data: {
    phone: string; password: string; first_name: string
    last_name: string; ci: string; birth_date: string
    department: string; email?: string; gender?: string
  }) => api.post<AuthResponse>('/auth/register/patient', data),

  registerProfessional: (data: {
    phone: string; email?: string; password: string
    first_name: string; last_name: string; ci: string; specialty: string
    sub_specialties?: string[]
    languages?: string[]; birth_date?: string; department?: string; gender?: string
  }) => api.post<AuthResponse>('/auth/register/professional', data),

  login: (phone: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { phone, password }),

  me: () => api.get<User>('/auth/me'),
  logout: () => api.post('/auth/logout'),
}

// ── Verificación de teléfono por WhatsApp (OTP) ──────
export interface OTPSendResponse {
  message: string
  expires_in_minutes: number
}

export const otpAPI = {
  send: (phone: string) =>
    api.post<OTPSendResponse>('/auth/otp/send', { phone }),

  verify: (phone: string, code: string) =>
    api.post<{ message: string; verified: boolean }>('/auth/otp/verify', { phone, code }),
}

// ── Recuperación de contraseña vía código de WhatsApp ─
export const passwordResetAPI = {
  forgot: (phone: string) =>
    api.post<OTPSendResponse>('/auth/password/forgot', { phone }),

  reset: (phone: string, code: string, new_password: string) =>
    api.post<{ message: string }>('/auth/password/reset', { phone, code, new_password }),
}

export const professionalsAPI = {
  list: (params?: { specialty?: string; available_now?: boolean; search?: string }) =>
    api.get<Professional[]>('/professionals', { params }),

  getById: (id: string) =>
    api.get<Professional>(`/professionals/${id}`),

  getMyProfile: () =>
    api.get('/professionals/me').then(r => r.data),

  updateAvailability: (data: { availability?: string; auto_availability?: boolean }) =>
    api.patch('/professionals/availability', data),

  updatePrices: (prices: { price_general?: number; price_urgent?: number; price_follow_up?: number }) =>
    api.patch('/professionals/prices', prices),

  // Actualiza bio, idiomas y años de experiencia
  updateProfile: (data: { bio?: string; languages?: string; years_experience?: number; appointment_duration_minutes?: number }) => {
    const form = new FormData()
    if (data.bio !== undefined)              form.append('bio', data.bio)
    if (data.languages !== undefined)        form.append('languages', data.languages)
    if (data.years_experience !== undefined) form.append('years_experience', String(data.years_experience))
    if (data.appointment_duration_minutes !== undefined) form.append('appointment_duration_minutes', String(data.appointment_duration_minutes))
    return api.patch('/professionals/profile', form)
  },

  // Sube o reemplaza la foto de perfil — retorna { photo_url: string }
  uploadPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ photo_url: string; message: string }>(
      '/professionals/photo',
      form
    )
  },

  // Sube un documento de verificación (CI, título, etc.)
  uploadDocument: (docType: string, file: File) => {
    const form = new FormData()
    form.append('doc_type', docType)
    form.append('file', file)
    return api.post('/professionals/documents', form)
  },

  verify: (id: string, status: string, note?: string) =>
    api.patch(`/professionals/${id}/verify`, null, { params: { new_status: status, review_note: note } }),

  // Horarios disponibles de un profesional para una fecha dada (YYYY-MM-DD)
  getAvailableSlots: (professionalId: string, date: string) =>
    api.get<{ date: string; appointment_duration_minutes: number; slots: string[] }>(
      `/professionals/${professionalId}/available-slots`,
      { params: { date } }
    ),

  // Historial y estadísticas de mis pagos recibidos (ganancias)
  getMyEarnings: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<ProfessionalEarningsResponse>('/professionals/me/earnings', { params }).then(r => r.data),
}



// ── Historial de pagos del paciente ───────────────────
export interface PatientPaymentStats {
  total_pagado: number
  total_pendiente: number
  total_reembolsado: number
  total_en_disputa: number
  consultas_pagadas: number
  cantidad_pagos: number
}

export interface PatientPaymentItem {
  id: string
  consultation_id: string
  amount: number
  platform_fee: number
  professional_net: number
  status: string
  bank_name: string | null
  bank_tx_id: string | null
  paid_at: string | null
  created_at: string
  released_at: string | null
  refunded_at: string | null
  refunded_amount: number | null
  refund_note: string | null
  disputed_at: string | null
  dispute_category: string | null
  dispute_reason: string | null
  resolution_note: string | null
  professional_id: string | null
  professional_first_name: string | null
  professional_last_name: string | null
  professional_photo_url: string | null
  specialty: string | null
  consultation_type: string | null
  consultation_status: string | null
  scheduled_at: string | null
  outcome_note: string | null
}

export interface PatientPaymentsResponse {
  stats: PatientPaymentStats
  items: PatientPaymentItem[]
}

// ── Historial de pagos recibidos por el profesional ───
export interface ProfessionalEarningStats {
  total_recibido: number
  total_retenido: number
  total_en_disputa: number
  total_comision_plataforma: number
  consultas_cobradas: number
  cantidad_pagos: number
}

export interface ProfessionalEarningItem {
  id: string
  consultation_id: string
  amount: number
  platform_fee: number
  professional_net: number
  status: string
  paid_at: string | null
  created_at: string
  released_at: string | null
  refunded_at: string | null
  refunded_amount: number | null
  disputed_at: string | null
  dispute_category: string | null
  resolution_note: string | null
  patient_id: string | null
  patient_first_name: string | null
  patient_last_name: string | null
  patient_photo_url: string | null
  specialty: string | null
  consultation_type: string | null
  consultation_status: string | null
  scheduled_at: string | null
  outcome_note: string | null
}

export interface ProfessionalEarningsResponse {
  stats: ProfessionalEarningStats
  items: ProfessionalEarningItem[]
}

export const patientsAPI = {
  getMyProfile: () =>
    api.get('/patients/me').then(r => r.data),
  updateMyProfile: (data: { allergies?: string[]; chronic_conditions?: string[]; current_medications?: string[]; department?: string }) =>
    api.patch('/patients/me', data).then(r => r.data),

  // Sube o reemplaza la foto de perfil del paciente — retorna { photo_url: string }
  uploadPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ photo_url: string; message: string }>('/patients/photo', form)
  },
  // [Profesional] datos médicos básicos de un paciente con el que ya tuvo consultas
  getMedicalInfo: (patientId: string) =>
    api.get(`/patients/${patientId}/medical-info`).then(r => r.data as {
      allergies: string[]; chronic_conditions: string[]; current_medications: string[]
    }),
  // Historial y estadísticas de mis pagos realizados
  getMyPayments: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<PatientPaymentsResponse>('/patients/me/payments', { params }).then(r => r.data),
}

export interface ScheduleBlock {
  id: string
  day_of_week: number   // 0=Domingo..6=Sábado
  start_time: string    // "HH:MM"
  end_time: string
  is_blocked: boolean
}

export interface ScheduleBlockInput {
  day_of_week: number
  start_time: string
  end_time: string
  is_blocked?: boolean
}

export const consultationsAPI = {
  create: (data: {
    professional_id: string
    consultation_type?: string
    specialty?: string
    chief_complaint?: string
    scheduled_at?: string
  }) => api.post<Consultation>('/consultations', data),

  getMyConsultations: () =>
    api.get<Consultation[]>('/consultations/my'),

  getStatus: async (consultationId: string) => {
    const res = await api.get(`/consultations/${consultationId}/status`)
    return res.data as { consultation_id: string; status: string; professional_busy: boolean; message: string | null }
  },

  generateQR: (consultationId: string) =>
    api.post<Payment>(`/consultations/${consultationId}/payment/qr`),

  updateStatus: (id: string, status: string) =>
    api.patch(`/consultations/${id}/status`, null, { params: { new_status: status } }),

  cancel: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/cancel`),

  acceptConsultation: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/accept`),

  rejectConsultation: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/reject`),

  simulatePayment: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/simulate-payment`),

  proposeReschedule: (consultationId: string, newScheduledAt: string) =>
    api.post(`/consultations/${consultationId}/reschedule/propose`, { new_scheduled_at: newScheduledAt }),

  respondReschedule: (consultationId: string, decision: 'ACCEPT' | 'REJECT') =>
    api.post(`/consultations/${consultationId}/reschedule/respond`, { decision }),

  // Paciente cancela una cita agendada YA PAGADA, avisando con ≥24h. Solo
  // funciona si todavía no se usó la única reprogramación permitida.
  cancelScheduledWithRefund: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/cancel-with-refund`),

  // El profesional reporta que el paciente no llegó (libera el pago a su favor)
  reportPatientNoShow: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/no-show/patient`),

  // El paciente reporta que el profesional no llegó (devuelve el dinero)
  reportProfessionalNoShow: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/no-show/professional`),

  // El profesional cancela la cita por percance propio (devuelve el dinero al paciente)
  cancelByProfessional: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/cancel-by-professional`),

  // GAP 1: paciente cancela consulta INMEDIATA pagada — el médico no inició
  // el video en 15 min. El botón se habilita en frontend, no hay auto-cancel.
  cancelNoVideoImmediate: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/cancel-no-video-immediate`),

  // GAP 2: paciente cancela cita AGENDADA pagada — el médico no inició el
  // video a la hora de la cita (+15 min). Igual, sin auto-cancel.
  cancelNoVideoScheduled: (consultationId: string) =>
    api.post(`/consultations/${consultationId}/cancel-no-video-scheduled`),

  startVideo: async (consultationId: string) => {
    const res = await api.post(`/consultations/${consultationId}/start-video`)
    return res.data as { room_name: string; livekit_url: string; token: string; consultation_id: string }
  },

  getVideoToken: async (consultationId: string) => {
    const res = await api.get(`/consultations/${consultationId}/video-token`)
    return res.data as { room_name: string; livekit_url: string; token: string; consultation_id: string }
  },

  rejoinVideo: async (consultationId: string) => {
    const res = await api.get(`/consultations/${consultationId}/rejoin-video`)
    return res.data as { room_name: string; livekit_url: string; token: string; consultation_id: string }
  },

  // El paciente reporta un problema con una consulta ya finalizada (dentro
  // de la ventana de PAYMENT_HOLD_MINUTES). Congela el pago para revisión
  // de un admin — no libera ni reembolsa nada por sí solo.
  dispute: (consultationId: string, category: DisputeCategory, reason: string) =>
    api.post<{ message: string; consultation_id: string }>(
      `/consultations/${consultationId}/dispute`,
      { category, reason }
    ),
}

export const scheduleAPI = {
  getMine: async (): Promise<ScheduleBlock[]> => {
    const res = await api.get<ScheduleBlock[]>('/professionals/schedule')
    return res.data
  },

  setMine: async (blocks: ScheduleBlockInput[]): Promise<ScheduleBlock[]> => {
    const res = await api.put<ScheduleBlock[]>('/professionals/schedule', { blocks })
    return res.data
  },

  getSuggested: async (professionalId: string): Promise<ScheduleBlock[]> => {
    const res = await api.get<ScheduleBlock[]>(`/professionals/${professionalId}/schedule`)
    return res.data
  },

  getAvailableSlots: async (professionalId: string, date: string): Promise<{
    date: string; appointment_duration_minutes: number; slots: string[]
  }> => {
    const res = await api.get(`/professionals/${professionalId}/available-slots`, { params: { date } })
    return res.data
  },
}

export const agentAPI = {
  chat: (message: string, sessionId?: string) =>
    api.post<AgentResponse>('/agent/chat', { message, session_id: sessionId }),

  onboarding: (message: string, sessionId?: string) =>
    api.post<AgentResponse>('/agent/onboarding', { message, session_id: sessionId }),

  getHistory: (sessionId: string) =>
    api.get(`/agent/history/${sessionId}`),

  tts: (text: string) =>
    api.post('/agent/tts', null, { params: { text } }),

  voiceChat: (formData: FormData) =>
    api.post('/agent/voice-chat', formData, {
      timeout: 30000,
    }),
}

export const prescriptionsAPI = {
  create: (data: {
    consultation_id: string
    medications: any[]
    instructions?: string
    replaces_prescription_id?: string
  }) => api.post<Prescription>('/prescriptions', data),

  void: (prescriptionId: string, reason?: string) =>
    api.post<Prescription>(`/prescriptions/${prescriptionId}/void`, { reason }),

  getMy: async (): Promise<Prescription[]> => {
    const res = await api.get<Prescription[]>('/prescriptions/my')
    return res.data
  },

  getMyPatient: async (): Promise<Prescription[]> => {
    const res = await api.get<Prescription[]>('/prescriptions/patient/my')
    return res.data
  },

  getByConsultation: (consultationId: string) =>
    api.get<Prescription[]>(`/prescriptions/consultation/${consultationId}`),

  // [Profesional] Recetas que YO emití para un paciente específico
  // (todas sus consultas conmigo) — para revisar antes de atenderlo.
  getMineForPatient: async (patientId: string): Promise<Prescription[]> => {
    const res = await api.get<Prescription[]>(`/prescriptions/patient/${patientId}/mine`)
    return res.data
  },

  verify: (code: string) =>
    api.get(`/prescriptions/verify/${code}`),
}

// ── FAQ (landing pública + admin) ─────────────────────
export const faqAPI = {
  // Público — sin token. audience opcional: 'GENERAL' | 'PATIENT' | 'PROFESSIONAL'
  list: (audience?: string) =>
    api.get<FAQ[]>('/faq', { params: audience ? { audience } : undefined }),

  // Admin
  listAdmin: () => api.get<FAQ[]>('/faq/admin'),

  create: (data: { question: string; answer: string; audience: string; display_order?: number; is_active?: boolean }) =>
    api.post<FAQ>('/faq', data),

  update: (id: string, data: Partial<{ question: string; answer: string; audience: string; display_order: number; is_active: boolean }>) =>
    api.put<FAQ>(`/faq/${id}`, data),

  delete: (id: string) => api.delete(`/faq/${id}`),
}

// ── IA / WhatsApp (panel admin, 4 pestañas) ───────────
export const whatsappAPI = {
  // Pestaña 1 — monitor y edición del bot
  getStatus: () => api.get('/whatsapp/status'),
  getQR: () => api.get('/whatsapp/qr'),
  sendTestMessage: (data: { phone: string; message?: string }) =>
    api.post('/whatsapp/test-message', data),

  // Pestaña 2 — recordatorios automáticos
  listReminders: () => api.get('/whatsapp/reminders'),
  createReminder: (data: {
    name: string; trigger_type: string; audience: string; channel?: string
    offset_minutes?: number | null; message_template: string; is_active?: boolean
  }) => api.post('/whatsapp/reminders', data),
  updateReminder: (id: string, data: {
    name: string; trigger_type: string; audience: string; channel?: string
    offset_minutes?: number | null; message_template: string; is_active?: boolean
  }) => api.put(`/whatsapp/reminders/${id}`, data),
  deleteReminder: (id: string) => api.delete(`/whatsapp/reminders/${id}`),
  getReminderLogs: (id: string) => api.get(`/whatsapp/reminders/${id}/logs`),

  // Pestaña 3 — conversaciones + configuración del agente
  listConversations: (audience?: string) =>
    api.get('/whatsapp/conversations', { params: audience ? { audience } : undefined }),
  getConversationMessages: (id: string) => api.get(`/whatsapp/conversations/${id}/messages`),
  sendManualMessage: (id: string, message: string) =>
    api.post(`/whatsapp/conversations/${id}/send`, { message }),
  toggleConversationAgent: (id: string, agent_enabled: boolean) =>
    api.patch(`/whatsapp/conversations/${id}/agent`, { agent_enabled }),
  getAgentConfig: () => api.get('/whatsapp/agent-config'),
  updateAgentConfig: (data: {
    is_active: boolean; auto_reply_public: boolean; auto_reply_patients: boolean
    auto_reply_professionals: boolean; business_hours_only: boolean
  }) => api.put('/whatsapp/agent-config', data),

  // Pestaña 4 — automatización de base de datos → Gmail
  getBackupConfig: () => api.get('/whatsapp/backup-config'),
  updateBackupConfig: (data: {
    is_active: boolean; frequency: string; hour_utc: number
    recipient_emails: string[]; include_full_dump?: boolean
  }) => api.put('/whatsapp/backup-config', data),
  sendBackupNow: () => api.post('/whatsapp/backup-config/send-now'),
  getBackupLogs: () => api.get('/whatsapp/backup-logs'),
}

// ── GAP 4: Historia clínica ──────────────────────────
export interface ClinicalNoteAddendum {
  id: string
  clinical_note_id: string
  professional_id: string
  content: string
  created_at: string
  professional_name?: string | null
}

export interface ClinicalNote {
  id: string
  consultation_id: string
  professional_id: string
  patient_id: string
  subjective?: string | null
  objective?: string | null
  assessment?: string | null
  plan?: string | null
  is_visible_to_patient: boolean
  shared_with_professionals: boolean
  created_at: string
  updated_at: string
  professional_name?: string | null
  professional_specialty?: string | null
  patient_name?: string | null
  patient_photo_url?: string | null
  edit_count?: number
  is_editable?: boolean | null
  edit_window_expires_at?: string | null
  addenda?: ClinicalNoteAddendum[]
}

export const clinicalNotesAPI = {
  // El médico la crea — puede hacerse EN VIVO durante la videollamada
  // (consulta en IN_PROGRESS) o justo después (COMPLETED).
  create: (data: {
    consultation_id: string
    subjective?: string
    objective?: string
    assessment?: string
    plan?: string
    is_visible_to_patient?: boolean
  }) => api.post<ClinicalNote>('/clinical-notes', data),

  // Edición incremental — pensada para autosave mientras el médico escribe.
  update: (noteId: string, data: {
    subjective?: string
    objective?: string
    assessment?: string
    plan?: string
    is_visible_to_patient?: boolean
  }) => api.patch<ClinicalNote>(`/clinical-notes/${noteId}`, data),

  // Corrección/agregado posterior a la ventana de edición de 24h. Nunca
  // sobreescribe la nota original — queda como entrada nueva con su fecha real.
  addAddendum: (noteId: string, content: string) =>
    api.post<ClinicalNote>(`/clinical-notes/${noteId}/addendum`, { content }),

  // SOLO el paciente decide compartir una nota con otros médicos de la plataforma
  share: (noteId: string, sharedWithProfessionals: boolean) =>
    api.patch<ClinicalNote>(`/clinical-notes/${noteId}/share`, { shared_with_professionals: sharedWithProfessionals }),

  getByConsultation: (consultationId: string) =>
    api.get<ClinicalNote>(`/clinical-notes/consultation/${consultationId}`),

  // [Paciente] Todo mi historial clínico visible
  getMyHistory: () =>
    api.get<ClinicalNote[]>('/clinical-notes/patient/my'),

  // [Profesional] Historial que el paciente compartió con la plataforma
  getPatientSharedHistory: (patientId: string) =>
    api.get<ClinicalNote[]>(`/clinical-notes/patient/${patientId}/shared`),

  // [Profesional] Todas las notas que yo mismo escribí
  getMyWrittenNotes: () =>
    api.get<ClinicalNote[]>('/clinical-notes/my'),

  // [Profesional] Notas que YO escribí para un paciente específico
  // (todas sus consultas conmigo) — para revisar antes de atenderlo.
  getMineForPatient: async (patientId: string): Promise<ClinicalNote[]> => {
    const res = await api.get<ClinicalNote[]>(`/clinical-notes/patient/${patientId}/mine`)
    return res.data
  },
}

export const ratingsAPI = {
  create: (consultationId: string, score: number, comment?: string) =>
    api.post<Rating>('/ratings', { consultation_id: consultationId, score, comment }),

  check: (consultationId: string) =>
    api.get<{ rated: boolean; rating: Rating | null }>(`/ratings/check/${consultationId}`),

  getMy: () =>
    api.get<{ ratings: any[]; average: number; total: number }>('/ratings/my'),
}

export interface CatalogItem {
  id: string
  name: string
  is_active?: boolean
}

export interface SubSpecialtyItem extends CatalogItem {
  specialty_id: string
  created_at?: string | null
}

export interface SpecialtyWithSubs extends CatalogItem {
  created_at?: string | null
  sub_specialties: SubSpecialtyItem[]
}

export interface SpecialtyProposal {
  id: string
  professional_id: string
  type: 'SPECIALTY' | 'SUB_SPECIALTY'
  proposed_name: string
  parent_specialty_id: string | null
  parent_specialty_name: string | null
  parent_proposal_id: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  admin_note: string | null
  created_at: string
  reviewed_at: string | null
  depends_on_pending_specialty?: boolean
  parent_proposal_name?: string | null
}

export const specialtiesAPI = {
  // ── Catálogo público (usado en selectores de registro/perfil) ──
  list: async (): Promise<CatalogItem[]> => {
    const res = await api.get<CatalogItem[]>('/specialties')
    return res.data
  },

  listSubSpecialties: async (specialtyId: string): Promise<CatalogItem[]> => {
    const res = await api.get<CatalogItem[]>(`/specialties/${specialtyId}/sub-specialties`)
    return res.data
  },

  // ── Propuestas (profesional crea, admin revisa) ──
  createProposal: async (data: {
    type: 'SPECIALTY' | 'SUB_SPECIALTY'
    proposed_name: string
    parent_specialty_id?: string
    parent_proposal_id?: string
  }) => {
    const res = await api.post('/specialties/proposals', data)
    return res.data
  },

  listProposals: async (status?: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<SpecialtyProposal[]> => {
    const res = await api.get<SpecialtyProposal[]>('/specialties/proposals', {
      params: status ? { status_filter: status } : undefined,
    })
    return res.data
  },

  reviewProposal: async (
    id: string,
    data: { decision: 'APPROVE' | 'REJECT'; final_name?: string; admin_note?: string }
  ) => {
    const res = await api.patch(`/specialties/proposals/${id}`, data)
    return res.data
  },

  // ── Administración del catálogo (incluye inactivas) ──
  adminListCatalog: async (): Promise<SpecialtyWithSubs[]> => {
    const res = await api.get<SpecialtyWithSubs[]>('/specialties/admin/catalog')
    return res.data
  },

  adminCreateSpecialty: async (name: string): Promise<SpecialtyWithSubs> => {
    const res = await api.post<SpecialtyWithSubs>('/specialties/admin/catalog', { name })
    return res.data
  },

  adminUpdateSpecialty: async (
    specialtyId: string,
    data: { name?: string; is_active?: boolean }
  ): Promise<SpecialtyWithSubs> => {
    const res = await api.patch<SpecialtyWithSubs>(`/specialties/admin/catalog/${specialtyId}`, data)
    return res.data
  },

  adminCreateSubSpecialty: async (specialtyId: string, name: string): Promise<SubSpecialtyItem> => {
    const res = await api.post<SubSpecialtyItem>(
      `/specialties/admin/catalog/${specialtyId}/sub-specialties`,
      { name }
    )
    return res.data
  },

  adminUpdateSubSpecialty: async (
    subId: string,
    data: { name?: string; is_active?: boolean }
  ): Promise<SubSpecialtyItem> => {
    const res = await api.patch<SubSpecialtyItem>(`/specialties/admin/catalog/sub-specialties/${subId}`, data)
    return res.data
  },
}

export const adminAPI = {
  getSettings: () =>
    api.get<PlatformSettings>('/admin/settings').then(r => r.data),

  updateSettings: (data: PlatformSettingsUpdate) =>
    api.put<PlatformSettings>('/admin/settings', data).then(r => r.data),

  // Períodos/promociones de comisión (globales o por profesional)
  listCommissionPeriods: (params?: { professional_id?: string; scope?: CommissionScope }) =>
    api.get<CommissionPeriod[]>('/admin/commission-periods', { params }).then(r => r.data),

  createCommissionPeriod: (data: CommissionPeriodCreate) =>
    api.post<CommissionPeriod>('/admin/commission-periods', data).then(r => r.data),

  updateCommissionPeriod: (id: string, data: CommissionPeriodUpdate) =>
    api.put<CommissionPeriod>(`/admin/commission-periods/${id}`, data).then(r => r.data),

  deactivateCommissionPeriod: (id: string) =>
    api.delete(`/admin/commission-periods/${id}`),

  getCurrentCommission: (professionalId?: string) =>
    api.get<CurrentCommission>('/admin/commission-periods/current', {
      params: professionalId ? { professional_id: professionalId } : undefined,
    }).then(r => r.data),

  // Cola de pagos congelados por reclamo del paciente, pendientes de que
  // un admin decida si se liberan al profesional o se reembolsan.
  getDisputedPayments: () =>
    api.get<DisputedPayment[]>('/admin/payments/disputed').then(r => r.data),

  resolveDispute: (
    paymentId: string,
    resolution: DisputeResolution,
    note: string,
    amount?: number
  ) =>
    api.post(`/admin/payments/${paymentId}/resolve-dispute`, {
      resolution,
      note,
      ...(amount !== undefined ? { amount } : {}),
    }),

  // Edición de datos por el admin (paciente / profesional). Devuelve
  // changed_fields y, si tocó teléfono/email, warnings explicando que el
  // usuario ya no podrá loguearse con el dato anterior.
  updatePatient: (userId: string, data: Record<string, unknown>) =>
    api.patch<{ message: string; changed_fields: string[]; warnings: string[] }>(
      `/admin/patients/${userId}`, data
    ).then(r => r.data),

  updateProfessional: (professionalId: string, data: Record<string, unknown>) =>
    api.patch<{ message: string; changed_fields: string[]; warnings: string[] }>(
      `/admin/professionals/${professionalId}`, data
    ).then(r => r.data),
}

export const maintenanceAPI = {
  // Endpoint público, sin auth — lo usa la página /mantenimiento para
  // saber cuándo puede redirigir de vuelta al usuario.
  check: () =>
    api.get<{ maintenance_mode: boolean }>('/admin/maintenance-status').then(r => r.data),
}

// ── Contacto (formulario público de la landing) ───────
export type ContactInquiryType = 'PACIENTE' | 'PROFESIONAL' | 'SOPORTE' | 'FACTURACION' | 'OTRO'

export interface ContactInquiryPayload {
  full_name: string
  city: string | null
  country: string
  // Código de país + número, ya concatenado por PhoneInput (mismo formato
  // que registro/login).
  phone: string
  email?: string
  inquiry_type: ContactInquiryType
  message: string
}

export interface ContactInquiryResponse {
  id: string
  full_name: string
  city: string | null
  country: string
  phone: string
  email: string | null
  inquiry_type: ContactInquiryType
  message: string
  created_at: string
}

export const contactAPI = {
  // Público — sin token.
  send: (data: ContactInquiryPayload) =>
    api.post<ContactInquiryResponse>('/contact', data).then(r => r.data),
}