// src/lib/api.ts
import axios, { AxiosError } from 'axios'
import type {
  AuthResponse, User, Professional, Consultation,
  Payment, Prescription, AgentResponse, Rating, FAQ,
  ChatConversationSummary, ChatMessage, ChatReasonCategory,
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
export interface SystemInfo {
  app_name: string
  app_version: string
  environment: string
  backend: string
  database: string
  frontend: string
  ai_agent_provider: string
  ai_agent_model: string
  whatsapp_engine: string
  background_jobs: string
  server_time_utc: string
}

export interface ChatReport {
  id: string
  kind: 'CHAT_BLOCK' | 'PATIENT_VISIBILITY'
  reason_category: string | null
  reason_text: string | null
  created_at: string | null
  admin_reviewed_at: string | null
  admin_reviewed_by_id: string | null
  admin_resolution_notes: string | null
  status: 'pending' | 'reviewed'
}

export interface BroadcastMessage {
  id: string
  title: string
  body: string
  audience: 'ALL' | 'PATIENT' | 'PROFESSIONAL' | 'WHATSAPP_PUBLIC'
  send_whatsapp: boolean
  status: 'PENDING' | 'SENT' | 'FAILED'
  recipients_count: number
  sent_by_id: string
  created_at: string | null
}

// ── Buscador de médicos / captación (DoctorLead) ──
export type DoctorLeadStatus =
  | 'NUEVO' | 'CONTACTADO' | 'INTERESADO' | 'NO_INTERESADO' | 'REGISTRADO' | 'NO_CONTACTAR'

export interface DoctorLead {
  id: string
  full_name: string
  specialty: string | null
  city: string | null
  phone: string | null
  email: string | null
  clinic_or_hospital: string | null
  address: string | null
  source: 'MANUAL' | 'CSV_IMPORT' | 'GOOGLE_PLACES' | 'REFERIDO'
  place_id: string | null
  maps_url: string | null
  status: DoctorLeadStatus
  notes: string | null
  last_contacted_at: string | null
  converted_professional_id: string | null
  created_at: string
  updated_at: string
  // Estado del último WhatsApp enviado a este lead. Refleja si el envío
  // se completó sin error (SENT) o falló tras reintentos (FAILED) — NO
  // si el médico lo recibió o leyó de verdad.
  last_invite_status: 'SENT' | 'FAILED' | null
  last_invite_included_pdf: boolean
  last_invite_sent_at: string | null
  last_invite_error: string | null
}

export interface DoctorLeadListResponse {
  items: DoctorLead[]
  total: number
  page: number
  page_size: number
  funnel: Record<DoctorLeadStatus, number>
}

export interface MapsSearchResult {
  place_id: string
  name: string
  address: string | null
  rating: number | null
  user_rating_count: number | null
  maps_url: string | null
  already_imported: boolean
}

export interface MapsPlaceDetails {
  place_id: string
  name: string
  address: string | null
  phone: string | null
  phone_normalized: string | null
  website: string | null
  maps_url: string | null
}

export interface PlatformSettings {
  app_name: string
  commission_percent: number
  open_registration_patients: boolean
  open_registration_professionals: boolean
  maintenance_mode: boolean
  chat_window_days: number
  chat_attachments_enabled_patient: boolean
  chat_attachments_enabled_professional: boolean
  updated_at: string | null
}

export interface PlatformSettingsUpdate {
  app_name?: string
  commission_percent?: number
  open_registration_patients?: boolean
  open_registration_professionals?: boolean
  maintenance_mode?: boolean
  chat_window_days?: number
  chat_attachments_enabled_patient?: boolean
  chat_attachments_enabled_professional?: boolean
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
  source: 'MEMBERSHIP' | 'PROFESSIONAL' | 'GLOBAL_PROMO' | 'DEFAULT'
  label: string | null
  ends_at: string | null
}

// ── Membresía mensual del profesional (comisión 0% + agendamiento directo) ──
// La habilita/deshabilita SOLO un admin, manualmente, con un registro por
// mes — no hay cobro recurrente automático dentro de la plataforma.
export interface ProfessionalMembership {
  id: string
  professional_id: string
  period_label: string | null
  starts_at: string
  ends_at: string | null
  active: boolean
  // true si "hoy" cae dentro de [starts_at, ends_at) y active=true.
  // Úsalo para decidir si mostrar "Renovar" (sigue vigente) o forzar
  // "Nueva membresía" (ya venció) — no lo calcules a mano en el front.
  is_current: boolean
  note: string | null
  enabled_by_admin_id: string | null
  created_at: string
}

export interface ProfessionalMembershipCreate {
  professional_id: string
  // Nota libre del admin (ej. "2026-07"), opcional. No afecta la
  // vigencia — eso lo deciden starts_at/months.
  period_label?: string
  // Si se omite, arranca "hoy" (hora del server).
  starts_at?: string | null
  // Meses pagados de una vez (mínimo 1). ends_at se calcula en el
  // backend como starts_at + months meses calendario — ya no se manda.
  months: number
  note?: string
}

export interface ProfessionalMembershipRenew {
  // Mínimo 1 mes. El backend rechaza esto si la membresía ya venció.
  months: number
  note?: string
}

export interface ProfessionalMembershipUpdate {
  active?: boolean
  ends_at?: string | null
  note?: string
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
  // El JWT ahora viaja en una cookie httpOnly seteada por el backend
  // (ver AUTH_COOKIE_NAME en security.py) — withCredentials hace que el
  // navegador la mande sola en cada request, sin que este código tenga
  // que leerla ni adjuntarla a mano (de hecho no podría: httpOnly la
  // esconde de JavaScript a propósito, es la protección ante XSS).
  withCredentials: true,
})

api.interceptors.request.use((config) => {
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
    // incorrecta" (no una sesión expirada), así que no corresponde
    // recargar la página — eso hacía que el mensaje de error
    // desapareciera a los pocos segundos en cada intento fallido de login.
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
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

  // Pacientes que se vincularon a mí (ver PatientProfessionalLink) —
  // el vínculo lo crea/revoca siempre el paciente, esto es solo lectura.
  getMyPatients: () =>
    api.get<PatientLink[]>('/professionals/my-patients').then(r => r.data),

  // Estado y detalle de mi membresía (la habilita/deshabilita un admin
  // manualmente). Si active=false, /consultations/professional-schedule
  // devuelve 403.
  getMyMembership: () =>
    api.get<MyMembershipStatus>('/professionals/my-membership').then(r => r.data),
}

export interface MembershipPeriod {
  id: string
  period_label: string | null
  starts_at: string | null
  ends_at: string | null
  active: boolean
  note: string | null
  is_current: boolean
}

export interface MyMembershipStatus {
  active: boolean
  current: MembershipPeriod | null
  history: MembershipPeriod[]
}



// ── Historial de pagos del paciente ───────────────────
export interface PatientPaymentStats {
  total_pagado: number
  total_pendiente: number
  total_reembolsado: number
  total_en_disputa: number
  consultas_pagadas: number
  cantidad_pagos: number
  // Desglose por canal — plataforma (QR) vs cobro directo con el
  // profesional (agendamiento por membresía, ver PaymentChannel).
  total_pagado_plataforma: number
  total_pagado_directo: number
  total_pendiente_cobro_directo: number
}

export interface PatientPaymentItem {
  id: string
  consultation_id: string
  amount: number
  platform_fee: number
  professional_net: number
  status: string
  payment_channel: 'PLATFORM_QR' | 'CASH' | null
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
  created_by_role: 'PATIENT' | 'PROFESSIONAL' | null
  modality: 'VIDEO_CALL' | 'IN_PERSON' | null
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
  // Desglose por canal — plataforma (QR, con comisión y garantía) vs
  // cobro directo en efectivo con el paciente (agendamiento por
  // membresía, sin comisión ni garantía — ver PaymentChannel).
  total_recibido_plataforma: number
  total_recibido_directo: number
  total_pendiente_cobro_directo: number
}

export interface ProfessionalEarningItem {
  id: string
  consultation_id: string
  amount: number
  platform_fee: number
  professional_net: number
  status: string
  payment_channel: 'PLATFORM_QR' | 'CASH' | null
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
  created_by_role: 'PATIENT' | 'PROFESSIONAL' | null
  modality: 'VIDEO_CALL' | 'IN_PERSON' | null
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

// ── Notificaciones (campanita) — comunes a paciente y profesional ────
// Ambos roles tienen el mismo shape de endpoint (/me/notifications), solo
// cambia el prefijo del recurso ("patients" vs "professionals"). Se centraliza
// acá para reutilizar tanto en la página de Perfil como en el ícono flotante
// global (FloatingNotificationBell).
export interface NotificationItem {
  id: string
  title: string
  body: string
  type: string
  entity_type?: string | null
  entity_id?: string | null
  read: boolean
  created_at: string
}

function notifBase(role: 'PATIENT' | 'PROFESSIONAL') {
  return role === 'PATIENT' ? '/patients' : '/professionals'
}

export const notificationsAPI = {
  getMine: (role: 'PATIENT' | 'PROFESSIONAL') =>
    api.get<NotificationItem[]>(`${notifBase(role)}/me/notifications`).then(r => r.data),
  markAllRead: (role: 'PATIENT' | 'PROFESSIONAL') =>
    api.patch(`${notifBase(role)}/me/notifications/read-all`),
  markRead: (role: 'PATIENT' | 'PROFESSIONAL', notificationId: string) =>
    api.patch(`${notifBase(role)}/me/notifications/${notificationId}/read`),
}

// ── Vínculo "Mis pacientes" (PatientProfessionalLink) ─
// Solo el PACIENTE puede crear y revocar el vínculo. Una vez activo, el
// profesional lo ve en su lista (professionalsAPI.getMyPatients) y — si
// además tiene membresía activa — puede agendarle citas directamente
// (consultationsAPI.professionalSchedule).
export interface PatientLink {
  id: string
  patient_id: string
  professional_id: string
  created_at: string
  revoked_at: string | null
  professional_first_name?: string | null
  professional_last_name?: string | null
  professional_photo_url?: string | null
  professional_specialty?: string | null
  patient_first_name?: string | null
  patient_last_name?: string | null
  patient_photo_url?: string | null
}

export const patientLinksAPI = {
  // Vincularme a un profesional (para que me pueda agendar citas directamente)
  create: (professionalId: string) =>
    api.post<PatientLink>('/patients/links', { professional_id: professionalId }).then(r => r.data),

  getMine: () =>
    api.get<PatientLink[]>('/patients/links').then(r => r.data),

  // Solo funciona si no tengo ninguna cita activa/pendiente con ese profesional
  revoke: (professionalId: string) =>
    api.delete(`/patients/links/${professionalId}`).then(r => r.data),
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

  // [Profesional con membresía activa] Agendar directamente a un paciente
  // ya vinculado, sin límite de horario disponible. El cobro es SIEMPRE
  // directo entre el profesional y el paciente — amount es opcional
  // (default = price_general del profesional), acepta 0.
  professionalSchedule: (data: {
    patient_id: string
    scheduled_at: string
    specialty?: string
    chief_complaint?: string
    amount?: number
    charge_now?: boolean
    modality?: 'VIDEO_CALL' | 'IN_PERSON'
  }) => api.post<Consultation>('/consultations/professional-schedule', data),

  // Reprogramar una cita que el propio profesional agendó — sin
  // negociación con el paciente (a diferencia de proposeReschedule, que es
  // para citas que agendó el paciente). Se puede repetir cuantas veces se
  // quiera, ya que no hay ningún pago de plataforma que reprocesar.
  professionalReschedule: (consultationId: string, scheduledAt: string) =>
    api.patch<Consultation>(`/consultations/${consultationId}/professional-reschedule`, {
      scheduled_at: scheduledAt,
    }),

  // Registrar/actualizar cuánto y CUÁNDO se cobró realmente una cita que
  // el profesional agendó directamente (pago fuera de la plataforma). La
  // fecha de pago es libre — a mitad de la consulta, al final, o en otra
  // fecha — se puede editar las veces que haga falta.
  recordDirectPayment: (consultationId: string, amount: number, paidAt: string) =>
    api.patch<Consultation>(`/consultations/${consultationId}/record-direct-payment`, {
      amount,
      paid_at: paidAt,
    }),

  // Elegir videollamada o presencial para una cita que el propio
  // profesional agendó (membresía) — no aplica al flujo normal.
  setConsultationModality: (consultationId: string, modality: 'VIDEO_CALL' | 'IN_PERSON') =>
    api.patch<Consultation>(`/consultations/${consultationId}/set-modality`, { modality }),

  // Marcar como completada una cita presencial (modality=IN_PERSON) que el
  // profesional agendó directamente — equivalente a "Iniciar consulta" pero
  // sin crear una sala de videollamada.
  completeInPerson: (consultationId: string) =>
    api.patch<Consultation>(`/consultations/${consultationId}/complete-in-person`, {}),
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

  // Agente de Ayuda persistente — a diferencia de onboarding, no depende de
  // onboarding_completed, se puede usar en cualquier momento desde el botón
  // "Ayuda" del menú.
  help: (message: string, sessionId?: string) =>
    api.post<AgentResponse>('/agent/help', { message, session_id: sessionId }),

  getHistory: (sessionId: string) =>
    api.get(`/agent/history/${sessionId}`),

  tts: (text: string) =>
    api.post('/agent/tts', null, { params: { text } }),

  voiceChat: (formData: FormData) =>
    api.post('/agent/voice-chat', formData, {
      timeout: 30000,
    }),

  // Usado por la llamada de voz (Gemini Live, function calling) — mismo
  // mecanismo de búsqueda que usa el agente coordinador de texto.
  searchProfessionals: (specialty: string) =>
    api.get('/agent/search-professionals', { params: { specialty } }),
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
  getReminderStats: () => api.get('/whatsapp/reminders/stats'),

  // Pestaña 3 — conversaciones + configuración del agente
  listConversations: (audience?: string) =>
    api.get('/whatsapp/conversations', { params: audience ? { audience } : undefined }),
  getConversationMessages: (id: string) => api.get(`/whatsapp/conversations/${id}/messages`),
  sendManualMessage: (id: string, message: string) =>
    api.post(`/whatsapp/conversations/${id}/send`, { message }),
  toggleConversationAgent: (id: string, agent_enabled: boolean) =>
    api.patch(`/whatsapp/conversations/${id}/agent`, { agent_enabled }),
  resolveEscalation: (id: string) =>
    api.patch(`/whatsapp/conversations/${id}/resolve-escalation`),
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
  // Datos reales del stack (versión, DB, motor de IA/WhatsApp, etc.) para
  // la sección "Información del sistema" — ver admin/system-info en el backend.
  getSystemInfo: () =>
    api.get<SystemInfo>('/admin/system-info').then(r => r.data),

  // Chat > Reportes — bloqueos con is_reported=True (tanto del chat puntual
  // como del bloqueo integral desde "Mis Pacientes"), unificados.
  listChatReports: (reportStatus: 'pending' | 'reviewed' | 'all' = 'pending') =>
    api.get<ChatReport[]>('/admin/chat-reports', { params: { report_status: reportStatus } }).then(r => r.data),

  getChatReportDetail: (kind: 'CHAT_BLOCK' | 'PATIENT_VISIBILITY', id: string) =>
    api.get<ChatReport>(`/admin/chat-reports/${kind}/${id}`).then(r => r.data),

  reviewChatReport: (kind: 'CHAT_BLOCK' | 'PATIENT_VISIBILITY', id: string, resolutionNotes: string) =>
    api.post<ChatReport>(`/admin/chat-reports/${kind}/${id}/review`, { resolution_notes: resolutionNotes }).then(r => r.data),

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

  // Membresía mensual (comisión 0% + agendamiento directo). Habilitación
  // manual — el admin la crea cuando confirma el pago por fuera de la plataforma.
  listMemberships: (professionalId?: string) =>
    api.get<ProfessionalMembership[]>('/admin/memberships', {
      params: professionalId ? { professional_id: professionalId } : undefined,
    }).then(r => r.data),

  createMembership: (data: ProfessionalMembershipCreate) =>
    api.post<ProfessionalMembership>('/admin/memberships', data).then(r => r.data),

  renewMembership: (id: string, data: ProfessionalMembershipRenew) =>
    api.post<ProfessionalMembership>(`/admin/memberships/${id}/renew`, data).then(r => r.data),

  updateMembership: (id: string, data: ProfessionalMembershipUpdate) =>
    api.put<ProfessionalMembership>(`/admin/memberships/${id}`, data).then(r => r.data),

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

  // Mensajería masiva (broadcast) — anuncio libre a un segmento de usuarios.
  previewBroadcastRecipients: (audience: string) =>
    api.get<{ audience: string; recipients_count: number }>(
      '/admin/broadcasts/preview', { params: { audience } }
    ).then(r => r.data),

  createBroadcast: (data: { title: string; body: string; audience: string; send_whatsapp: boolean }) =>
    api.post<BroadcastMessage>('/admin/broadcasts', data).then(r => r.data),

  listBroadcasts: () =>
    api.get<BroadcastMessage[]>('/admin/broadcasts').then(r => r.data),

  // Buscador de médicos / captación (DoctorLead)
  searchDoctorsOnMaps: (query: string, city: string) =>
    api.get<{ query: string; city: string; results: MapsSearchResult[] }>(
      '/admin/doctor-leads/search-maps', { params: { query, city } }
    ).then(r => r.data),

  getDoctorPlaceDetails: (placeId: string) =>
    api.get<MapsPlaceDetails>(`/admin/doctor-leads/place-details/${placeId}`).then(r => r.data),

  listDoctorLeads: (params: {
    status?: string; specialty?: string; city?: string; search?: string
    page?: number; page_size?: number
  }) =>
    api.get<DoctorLeadListResponse>('/admin/doctor-leads', { params }).then(r => r.data),

  createDoctorLead: (data: Partial<DoctorLead> & { full_name: string }) =>
    api.post<DoctorLead>('/admin/doctor-leads', data).then(r => r.data),

  updateDoctorLead: (id: string, data: Partial<DoctorLead>) =>
    api.put<DoctorLead>(`/admin/doctor-leads/${id}`, data).then(r => r.data),

  deleteDoctorLead: (id: string) =>
    api.delete(`/admin/doctor-leads/${id}`).then(r => r.data),

  inviteDoctorLead: (id: string, message: string, includePdf: boolean = true) =>
    api.post<DoctorLead>(`/admin/doctor-leads/${id}/invite`, { message, include_pdf: includePdf }).then(r => r.data),
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
  // Honeypot anti-spam: campo trampa, invisible para una persona real.
  // Se manda siempre vacío desde acá; solo un bot que autorellena todos
  // los inputs del formulario terminaría completándolo.
  website?: string
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

// ── Chat interno paciente-profesional ─────────────────
// Por política, el paciente nunca ve el número del profesional: este es
// el único canal de mensajería directa dentro de la plataforma. Cada
// conversación nace ligada a una Consultation ya finalizada y queda
// disponible por CHAT_WINDOW_DAYS (ver backend/app/core/config.py).
// Tamaño de página del historial de chat: 20 al abrir la conversación y
// 20 por cada "Ver mensajes anteriores". El backend soporta hasta 100
// por request como tope de seguridad, pero acá se pagina de a 20 para
// mantener liviana la carga inicial (menos adjuntos/imágenes de golpe).
export const CHAT_PAGE_SIZE = 20

export const chatAPI = {
  listConversations: () =>
    api.get<ChatConversationSummary[]>('/chat/conversations').then(r => r.data),

  // Bloqueo GLOBAL: acción general del usuario, no depende de ninguna
  // conversación puntual — se usa desde el listado de Mensajes.
  getGlobalBlockStatus: () =>
    api.get<{ blocked: boolean }>('/chat/block-all/status').then(r => r.data),

  blockAll: (opts?: { isReported?: boolean; reasonCategory?: ChatReasonCategory; reasonText?: string }) =>
    api.post('/chat/block-all', {
      is_reported: opts?.isReported ?? false,
      reason_category: opts?.reasonCategory ?? null,
      reason_text: opts?.reasonText ?? null,
    }),

  unblockAll: () =>
    api.delete('/chat/block-all'),

  // Carga inicial y cada lote de "mensajes anteriores" traen 20 mensajes
  // (CHAT_PAGE_SIZE). El backend acepta hasta 100 por request (tope de
  // seguridad, ver endpoints/chat.py), pero acá siempre pedimos de a 20
  // para no golpear con muchas imágenes/adjuntos de una sola vez.
  getMessages: (conversationId: string, before?: string) =>
    api.get<ChatMessage[]>(`/chat/conversations/${conversationId}/messages`, {
      params: before ? { before, limit: CHAT_PAGE_SIZE } : { limit: CHAT_PAGE_SIZE },
    }).then(r => r.data),

  sendAttachment: (conversationId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ChatMessage>(`/chat/conversations/${conversationId}/attachments`, form)
      .then(r => r.data)
  },

  // Bloqueo puntual (CONTACT) dentro de una conversación. Para el
  // bloqueo general, usar blockAll/unblockAll de arriba.
  block: (
    conversationId: string,
    opts?: { isReported?: boolean; reasonCategory?: ChatReasonCategory; reasonText?: string }
  ) =>
    api.post(`/chat/conversations/${conversationId}/block`, {
      scope: 'CONTACT',
      is_reported: opts?.isReported ?? false,
      reason_category: opts?.reasonCategory ?? null,
      reason_text: opts?.reasonText ?? null,
    }),

  unblock: (conversationId: string) =>
    api.delete(`/chat/conversations/${conversationId}/block`),
}

// Bloqueo INTEGRAL desde "Mis Pacientes" (solo profesional -> paciente).
// Distinto de chatAPI.block: corta chat + visibilidad + nuevas citas,
// todo junto — ver backend/app/services/chat.py.
export const patientBlockAPI = {
  getStatus: (patientId: string) =>
    api.get<{ blocked: boolean; reason_category?: string | null }>(`/professionals/patients/${patientId}/block`).then(r => r.data),

  block: (
    patientId: string,
    opts?: { isReported?: boolean; reasonCategory?: ChatReasonCategory; reasonText?: string }
  ) =>
    api.post(`/professionals/patients/${patientId}/block`, {
      is_reported: opts?.isReported ?? false,
      reason_category: opts?.reasonCategory ?? null,
      reason_text: opts?.reasonText ?? null,
    }),

  unblock: (patientId: string) =>
    api.delete(`/professionals/patients/${patientId}/block`),
}

// Arma la URL del WebSocket del chat a partir de BASE_URL (http→ws,
// https→wss). El JWT ya NO viaja por query param: el navegador manda
// solo la cookie httpOnly en el handshake del WebSocket (es una request
// HTTP normal con Upgrade, las cookies se adjuntan igual que en
// cualquier otra request same-origin). Ver AUTH_COOKIE_NAME en el
// backend (security.py) y _authenticate_ws en chat.py.
export function buildChatWebSocketUrl(conversationId: string): string {
  const wsBase = BASE_URL.replace(/^http/, 'ws')
  return `${wsBase}/chat/ws/${conversationId}`
}