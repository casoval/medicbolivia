// src/lib/api.ts
import axios, { AxiosError } from 'axios'
import type {
  AuthResponse, User, Professional, Consultation,
  Payment, Prescription, LabOrder, AgentResponse, Rating, FAQ,
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

export function buildLabOrderVerifyUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://medicbolivia.com'
  return `${origin}/verificar-orden-lab?code=${encodeURIComponent(code)}`
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
  // Monto cobrado por esta membresía (opcional). Si se manda, el
  // backend crea un MembershipPayment y ese ingreso aparece en
  // admin/stats → membership_revenue_month. Si se omite, la membresía
  // queda activa pero sin ingreso registrado todavía.
  fee_amount?: number
  currency?: string
  payment_reference?: string
}

export interface ProfessionalMembershipRenew {
  // Mínimo 1 mes. El backend rechaza esto si la membresía ya venció.
  months: number
  note?: string
  // Mismo criterio que en la creación: cada renovación con fee_amount
  // genera un MembershipPayment nuevo, nunca pisa el anterior.
  fee_amount?: number
  currency?: string
  payment_reference?: string
}

export interface ProfessionalMembershipUpdate {
  active?: boolean
  ends_at?: string | null
  note?: string
}

// ── Cobros de membresía (ledger) ──────────────────────────────────────
// Una fila por cada alta o renovación con monto cargado. Existe aparte
// de ProfessionalMembership porque esa tabla es el estado de VIGENCIA
// (una sola fila que se estira al renovar) — sin esto no había forma de
// saber cuánto se cobró en cada renovación individual.
export interface MembershipPayment {
  id: string
  membership_id: string
  professional_id: string
  fee_amount: number
  currency: string
  payment_reference: string | null
  months_covered: number
  paid_at: string
  recorded_by_admin_id: string | null
  created_at: string
}

export interface MembershipPaymentCreate {
  fee_amount: number
  currency?: string
  payment_reference?: string
  months_covered?: number
  paid_at?: string
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
    // Excluimos /auth/login (un 401 ahí es "contraseña incorrecta", no
    // sesión expirada) y /auth/me (un 401 ahí solo significa "visitante
    // sin sesión" — algo normal en CUALQUIER página, incluida la propia
    // /auth/login, ya que loadUser() la llama siempre al montar la app.
    // Sin esta exclusión, un visitante no logueado en /auth/login entra
    // en loop infinito: 401 en /auth/me → redirect a /auth/login →
    // recarga completa → Providers vuelve a montar → loadUser() de
    // nuevo → 401 de nuevo → redirect de nuevo. store.ts ya maneja el
    // 401 de /auth/me por su cuenta, poniendo isAuthenticated: false).
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    const isMeRequest = error.config?.url?.includes('/auth/me')
    if (error.response?.status === 401 && !isLoginRequest && !isMeRequest) {
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
    first_name: string; last_name: string; ci: string
    birth_date?: string; department?: string; gender?: string
    // specialty, sub_specialties y languages ya NO van acá — se
    // completan después desde el perfil/onboarding (ver
    // specialtiesAPI.selectFromCatalog / createProposal más abajo).
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

  // Cambio de contraseña estando logueado (perfil) — distinto del flujo
  // de arriba, que es para cuando el usuario perdió el acceso.
  change: (current_password: string, new_password: string) =>
    api.post<{ message: string }>('/auth/password/change', { current_password, new_password }),
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

  // Actualiza bio, idiomas, años de experiencia, universidad y matrícula
  // profesional.
  // - years_experience SÍ se puede volver a editar más adelante (cambia
  //   con el tiempo) — cada cambio real queda pendiente de revisión por
  //   un admin (ver PATCH /professionals/profile en el backend).
  // - university y professional_license_number son de una sola edición:
  //   el backend rechaza el cambio si ya tenían un valor guardado.
  // - years_experience_visible / university_visible: no cambian el
  //   dato, solo si se muestra o no al paciente una vez verificado.
  updateProfile: (data: {
    bio?: string
    languages?: string
    years_experience?: string
    years_experience_visible?: boolean
    university?: string
    university_visible?: boolean
    professional_license_number?: string
    appointment_duration_minutes?: number
  }) => {
    const form = new FormData()
    if (data.bio !== undefined)              form.append('bio', data.bio)
    if (data.languages !== undefined)        form.append('languages', data.languages)
    if (data.years_experience !== undefined) form.append('years_experience', data.years_experience)
    if (data.years_experience_visible !== undefined) form.append('years_experience_visible', String(data.years_experience_visible))
    if (data.university !== undefined)                  form.append('university', data.university)
    if (data.university_visible !== undefined)          form.append('university_visible', String(data.university_visible))
    if (data.professional_license_number !== undefined) form.append('professional_license_number', data.professional_license_number)
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

  // Firma dibujada en el lienzo del perfil (PNG con fondo transparente,
  // se sube tal cual). Usada para estampar la receta imprimible.
  uploadSignature: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ signature_url: string; message: string }>(
      '/professionals/signature',
      form
    )
  },

  // Foto de la firma real en papel — el backend le quita el fondo
  // automáticamente. Acepta JPG/PNG/WebP.
  uploadSignatureFromPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ signature_url: string; message: string }>(
      '/professionals/signature/from-photo',
      form
    )
  },

  deleteSignature: () =>
    api.delete<{ message: string }>('/professionals/signature'),

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

  // Lista cerrada de bancos bolivianos (ASFI) para el selector del
  // formulario de cuenta bancaria — ver app.core.bank_list en el backend.
  getBankList: () =>
    api.get<{ banks: string[]; other_label: string }>('/professionals/bank-list').then(r => r.data),

  // Mi cuenta bancaria para recibir el % de cada consulta (Fase 1
  // semi-automática de pagos). Devuelve null si todavía no la registró.
  getMyBankAccount: () =>
    api.get<BankAccount | null>('/professionals/me/bank-account').then(r => r.data),

  // Alta o edición — siempre reemplaza (una sola cuenta activa por
  // profesional). Vuelve a quedar sin verificar cada vez que se guarda.
  updateMyBankAccount: (data: BankAccountUpdateRequest) =>
    api.put<{ message: string; verified: boolean }>('/professionals/me/bank-account', data).then(r => r.data),

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
  // Distinto de released_at (foto contable): cuándo se confirmó la
  // transferencia bancaria real — ver app/services/payout.py.
  paid_out_at: string | null
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

// ── Cuenta bancaria del profesional (payouts, Fase 1 semi-automática) ──
export interface BankAccount {
  bank_name: string
  account_type: 'AHORRO' | 'CORRIENTE'
  account_number_masked: string
  account_holder_name: string
  verified: boolean
  verified_at: string | null
  updated_at: string | null
}

export interface BankAccountUpdateRequest {
  bank_name: string
  account_type: 'AHORRO' | 'CORRIENTE'
  account_number: string
  account_number_confirm: string
  account_holder_name: string
  account_holder_ci: string
  responsibility_acknowledged: boolean
}

// ── Payouts (admin) ──
export interface PayoutPendingItem {
  professional_id: string
  professional_name: string
  has_bank_account: boolean
  bank_account_verified: boolean
  bank_name: string | null
  account_number_masked: string | null
  earning_count: number
  total_amount: number
}

export interface PayoutPendingResponse {
  payable: PayoutPendingItem[]
  blocked: PayoutPendingItem[]
  payable_total: number
  blocked_total: number
}

export interface PayoutBatch {
  id: string
  status: 'DRAFT' | 'EXPORTED' | 'CONFIRMED' | 'CANCELLED'
  period_end: string
  total_amount: number
  professional_count: number
  exported_at: string | null
  confirmed_at: string | null
  bank_reference_note: string | null
  created_at: string
}

export interface ProfessionalBankAccountFull {
  bank_name: string
  account_type: string
  account_number: string
  account_holder_name: string
  account_holder_ci: string
  verified: boolean
  responsibility_acknowledged_at: string
  updated_at: string | null
}

// ── Reembolsos a pacientes (Fase 1 semi-automática, cuenta PERMANENTE
// por paciente — espejo de la cuenta bancaria del profesional. Ver
// app/services/refund_payout.py) ──
export interface PatientRefundItem {
  payment_id: string
  consultation_id: string
  amount: number
  refunded_at: string | null
  refund_note: string | null
  specialty: string | null
  professional_first_name: string | null
  professional_last_name: string | null
}

export interface PatientRefundAccountRequest {
  bank_name: string
  account_type: 'AHORRO' | 'CORRIENTE'
  account_number: string
  account_number_confirm: string
  account_holder_name: string
  account_holder_ci: string
  responsibility_acknowledged: boolean
}

// Cuenta de reembolso propia del paciente (vista enmascarada — GET /patients/me/refund-account)
export interface PatientRefundAccountFull {
  bank_name: string | null
  account_type: string | null
  account_number_masked: string | null
  account_holder_name: string | null
  verified: boolean
  verified_at: string | null
  updated_at: string | null
}

// Cuenta de reembolso de un paciente, vista completa por un admin
// (GET /admin/patients/{id}/refund-account, número sin enmascarar)
export interface AdminPatientRefundAccountFull {
  bank_name: string | null
  account_type: string | null
  account_number: string | null
  account_holder_name: string | null
  account_holder_ci: string | null
  verified: boolean
  responsibility_acknowledged_at: string
  updated_at: string | null
}

// ── Reembolsos pendientes de pagar (admin) ──
export interface RefundPendingItem {
  payment_id: string
  consultation_id: string
  patient_id: string
  patient_name: string
  amount: number
  refunded_at: string | null
  refund_note: string | null
  has_refund_account: boolean
  destination?: string
  account_holder_name?: string | null
}

export interface RefundPendingResponse {
  ready_to_pay: RefundPendingItem[]
  awaiting_account: RefundPendingItem[]
  ready_to_pay_total: number
  awaiting_account_total: number
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

  // Reembolsos aprobados (por un admin o automáticamente al cancelar
  // una cita) que todavía no se transfirieron de verdad — solo
  // informativo, ver getMyRefundAccount para la cuenta permanente.
  getMyRefunds: () =>
    api.get<PatientRefundItem[]>('/patients/me/refunds').then(r => r.data),

  // Cuenta PERMANENTE para recibir reembolsos (se carga una sola vez en
  // el Perfil, igual que la cuenta bancaria del profesional).
  getMyRefundAccount: () =>
    api.get<PatientRefundAccountFull | null>('/patients/me/refund-account').then(r => r.data),

  updateMyRefundAccount: (data: PatientRefundAccountRequest) =>
    api.put<{ message: string; verified: boolean }>('/patients/me/refund-account', data).then(r => r.data),
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

function notifBase(role: 'PATIENT' | 'PROFESSIONAL' | 'ADMIN') {
  if (role === 'PATIENT') return '/patients'
  if (role === 'PROFESSIONAL') return '/professionals'
  return '/admin'
}

export const notificationsAPI = {
  getMine: (role: 'PATIENT' | 'PROFESSIONAL' | 'ADMIN') =>
    api.get<NotificationItem[]>(`${notifBase(role)}/me/notifications`).then(r => r.data),
  markAllRead: (role: 'PATIENT' | 'PROFESSIONAL' | 'ADMIN') =>
    api.patch(`${notifBase(role)}/me/notifications/read-all`),
  markRead: (role: 'PATIENT' | 'PROFESSIONAL' | 'ADMIN', notificationId: string) =>
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

  // Token efímero de un solo uso para que el navegador conecte directo a
  // Gemini Live por WebSocket, sin exponer nunca la API key real.
  getLiveToken: () =>
    api.post<{ token: string }>('/agent/live-token'),
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

// ── Órdenes de laboratorio (documento separado de la receta, mismo
// patrón de firma/QR — ver LabOrder en el backend) ──
export const labOrdersAPI = {
  getCatalog: async (): Promise<{ catalog: Record<string, string[]> }> => {
    const res = await api.get<{ catalog: Record<string, string[]> }>('/lab-orders/test-catalog')
    return res.data
  },

  create: (data: {
    consultation_id: string
    tests: { name: string; notes?: string }[]
    clinical_indication?: string
    fasting_required?: boolean
    urgency?: 'ROUTINE' | 'URGENT'
    instructions?: string
    replaces_lab_order_id?: string
  }) => api.post<LabOrder>('/lab-orders', data),

  void: (labOrderId: string, reason?: string) =>
    api.post<LabOrder>(`/lab-orders/${labOrderId}/void`, { reason }),

  getMy: async (): Promise<LabOrder[]> => {
    const res = await api.get<LabOrder[]>('/lab-orders/my')
    return res.data
  },

  getMyPatient: async (): Promise<LabOrder[]> => {
    const res = await api.get<LabOrder[]>('/lab-orders/patient/my')
    return res.data
  },

  getByConsultation: (consultationId: string) =>
    api.get<LabOrder[]>(`/lab-orders/consultation/${consultationId}`),

  getMineForPatient: async (patientId: string): Promise<LabOrder[]> => {
    const res = await api.get<LabOrder[]>(`/lab-orders/patient/${patientId}/mine`)
    return res.data
  },

  verify: (code: string) =>
    api.get(`/lab-orders/verify/${code}`),
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

  // ── Elegir directo del catálogo (sin propuesta) ──
  // A diferencia de createProposal (para lo que NO está en el catálogo),
  // esto es para cuando el profesional SÍ encuentra su especialidad en la
  // lista. Igual queda pendiente de confirmación de un admin.
  selectFromCatalog: async (data: { type: 'SPECIALTY' | 'SUB_SPECIALTY'; catalog_id: string }) => {
    const res = await api.post('/specialties/select', data)
    return res.data
  },

  // [Admin] Confirma o rechaza una especialidad/subespecialidad que el
  // profesional eligió directo del catálogo (sin pasar por propuesta).
  confirmCatalogPick: async (
    professionalId: string,
    data: { type: 'SPECIALTY' | 'SUB_SPECIALTY'; decision: 'APPROVE' | 'REJECT'; review_note?: string }
  ) => {
    const res = await api.patch(`/specialties/professionals/${professionalId}/confirm-catalog-pick`, data)
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

  // Historial de cobros de una membresía (una fila por alta/renovación
  // con monto cargado). Útil para ver, por ejemplo, cuánto pagó el
  // profesional en total a lo largo del tiempo, no solo el último monto.
  listMembershipPayments: (membershipId: string) =>
    api.get<MembershipPayment[]>(`/admin/memberships/${membershipId}/payments`).then(r => r.data),

  // Para cargar el cobro DESPUÉS de dar de alta o renovar (ej. el admin
  // activó la membresía primero y coordinó el pago un par de días
  // después). No mueve starts_at/ends_at, solo registra el monto.
  createMembershipPayment: (membershipId: string, data: MembershipPaymentCreate) =>
    api.post<MembershipPayment>(`/admin/memberships/${membershipId}/payments`, data).then(r => r.data),

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

  // Aprobar/rechazar universidad, años de experiencia o matrícula
  // profesional (texto), con motivo obligatorio si se rechaza — mismo
  // patrón que un documento. Especialidad/subespecialidad NO van acá,
  // tienen su propio flujo en specialtiesAPI (createProposal/reviewProposal
  // o selectFromCatalog/confirmCatalogPick según el caso).
  reviewProfessionalItem: (
    professionalId: string,
    data: {
      item: 'UNIVERSITY' | 'YEARS_EXPERIENCE' | 'PROFESSIONAL_LICENSE'
      status: 'APPROVED' | 'REJECTED'
      review_note?: string
    }
  ) =>
    api.patch<{ message: string; professional_approved_now: boolean }>(
      `/admin/professionals/${professionalId}/review-item`, data
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

  // ── Pagos a profesionales (payouts, Fase 1 semi-automática) ──
  // Ver documento de diseño y app/services/payout.py en el backend.
  getPendingPayouts: () =>
    api.get<PayoutPendingResponse>('/admin/payouts/pending').then(r => r.data),

  createPayoutBatch: (professionalIds?: string[]) =>
    api.post<{ id: string; status: string; total_amount: number; professional_count: number; blocked_count: number }>(
      '/admin/payouts/batches', { professional_ids: professionalIds ?? null }
    ).then(r => r.data),

  listPayoutBatches: () =>
    api.get<PayoutBatch[]>('/admin/payouts/batches').then(r => r.data),

  // Descarga el CSV del lote — responseType 'blob' porque es un archivo,
  // no JSON. El caller arma el <a download> con el blob devuelto.
  exportPayoutBatch: (batchId: string) =>
    api.get(`/admin/payouts/batches/${batchId}/export`, { responseType: 'blob' }).then(r => r.data as Blob),

  confirmPayoutBatch: (batchId: string, bankReferenceNote?: string) =>
    api.post<{ message: string; id: string }>(
      `/admin/payouts/batches/${batchId}/confirm`, { bank_reference_note: bankReferenceNote ?? null }
    ).then(r => r.data),

  cancelPayoutBatch: (batchId: string) =>
    api.post<{ message: string; id: string }>(`/admin/payouts/batches/${batchId}/cancel`).then(r => r.data),

  getProfessionalBankAccount: (professionalId: string) =>
    api.get<ProfessionalBankAccountFull>(`/admin/professionals/${professionalId}/bank-account`).then(r => r.data),

  verifyProfessionalBankAccount: (professionalId: string) =>
    api.post<{ message: string }>(`/admin/professionals/${professionalId}/bank-account/verify`).then(r => r.data),

  // ── Reembolsos a pacientes (Fase 1 semi-automática) ──
  // Ver app/services/refund_payout.py en el backend.
  getPendingRefunds: () =>
    api.get<RefundPendingResponse>('/admin/refunds/pending').then(r => r.data),

  confirmRefundPayout: (paymentId: string, referenceNote?: string) =>
    api.post<{ message: string; payment_id: string }>(
      `/admin/refunds/${paymentId}/confirm`, { reference_note: referenceNote ?? null }
    ).then(r => r.data),

  getPatientRefundAccount: (patientId: string) =>
    api.get<AdminPatientRefundAccountFull>(`/admin/patients/${patientId}/refund-account`).then(r => r.data),

  verifyPatientRefundAccount: (patientId: string) =>
    api.post<{ message: string }>(`/admin/patients/${patientId}/refund-account/verify`).then(r => r.data),
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

  // Marca como leídos todos los mensajes que el otro participante me
  // mandó. El backend avisa por WebSocket al otro participante para que
  // sus burbujas pasen a "✓✓ Visto" en vivo.
  markRead: (conversationId: string) =>
    api.post<{ marked: number }>(`/chat/conversations/${conversationId}/read`).then(r => r.data),

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

// ── Reportes de negocio (/admin/reports/*) ─────────────────────────
// Separado de adminAPI a propósito, igual que en el backend (ver
// admin_reports.py): admin/stats es "¿cómo estamos AHORA?" (un
// snapshot), esto es tendencia y desglose por rango de fechas.
export interface RevenueTrendPoint {
  month: string  // "YYYY-MM"
  gmv: number
  platform_fee: number
  membership_revenue: number
  total_platform_revenue: number
  consultations_count: number
  avg_ticket: number
  effective_commission_pct: number
}

export interface RevenueBySpecialty {
  specialty: string
  gmv: number
  platform_fee: number
  consultations_count: number
  avg_ticket: number
  pct_of_total_gmv: number
}

export interface ConversionFunnel {
  date_from: string
  date_to: string
  total_created: number
  reached_payment: number
  completed: number
  cancelled: number
  pct_reached_payment: number
  pct_completed: number
  pct_cancelled: number
  by_status: Record<string, number>
  outcome_note_breakdown: { outcome_note: string; count: number }[]
}

export interface RetentionReport {
  patients: {
    total_with_completed_consultation: number
    recurring_2plus: number
    pct_recurring: number
    avg_days_between_first_and_last_for_recurring: number
  }
  professionals: {
    total_active: number
    with_at_least_one_completed_patient: number
    with_repeat_patient: number
    pct_with_repeat_patient: number
  }
}

export interface ProfessionalRankingItem {
  professional_id: string
  name: string
  specialty: string
  total_consultations: number
  completed_consultations: number
  revenue_generated: number
  no_show_rate: number
  average_rating: number | null
  total_ratings: number
}

export interface AgentConversionReport {
  date_from: string
  date_to: string
  users_with_agent_session: number
  of_those_who_paid: number
  pct_conversion_approx: number
  note: string
}

export const adminReportsAPI = {
  revenueTrend: (months = 6) =>
    api.get<RevenueTrendPoint[]>('/admin/reports/revenue-trend', { params: { months } }).then(r => r.data),

  revenueBySpecialty: (dateFrom?: string, dateTo?: string) =>
    api.get<RevenueBySpecialty[]>('/admin/reports/revenue-by-specialty', {
      params: { date_from: dateFrom, date_to: dateTo },
    }).then(r => r.data),

  funnel: (dateFrom?: string, dateTo?: string) =>
    api.get<ConversionFunnel>('/admin/reports/funnel', {
      params: { date_from: dateFrom, date_to: dateTo },
    }).then(r => r.data),

  retention: () =>
    api.get<RetentionReport>('/admin/reports/retention').then(r => r.data),

  professionalsRanking: (dateFrom?: string, dateTo?: string, orderBy: 'revenue' | 'consultations' | 'rating' | 'no_show_rate' = 'revenue', limit = 20) =>
    api.get<ProfessionalRankingItem[]>('/admin/reports/professionals-ranking', {
      params: { date_from: dateFrom, date_to: dateTo, order_by: orderBy, limit },
    }).then(r => r.data),

  agentConversion: (dateFrom?: string, dateTo?: string) =>
    api.get<AgentConversionReport>('/admin/reports/agent-conversion', {
      params: { date_from: dateFrom, date_to: dateTo },
    }).then(r => r.data),
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

export function buildNotificationWebSocketUrl(): string {
  const wsBase = BASE_URL.replace(/^http/, 'ws')
  return `${wsBase}/ws/notifications`
}