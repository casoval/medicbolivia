// src/types/index.ts
// Tipos TypeScript que reflejan exactamente los schemas del backend FastAPI

// ─────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────

export type UserRole = 'PATIENT' | 'PROFESSIONAL' | 'ADMIN'
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION'
export type ProfessionalStatus = 'PENDING_DOCS' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
export type AvailabilityMode = 'ONLINE_NOW' | 'SCHEDULED_ONLY' | 'OFFLINE'
export type ConsultationStatus =
  | 'AGENT_TRIAGING'
  | 'WAITING_PAYMENT'
  | 'PAYMENT_CONFIRMED'
  | 'WAITING_PROFESSIONAL'
  | 'PROFESSIONAL_ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
export type ConsultationType = 'IMMEDIATE' | 'SCHEDULED' | 'FOLLOW_UP'
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'RELEASED_TO_PROFESSIONAL' | 'REFUNDED_PARTIAL' | 'REFUNDED_FULL' | 'DISPUTED'

// ─────────────────────────────────────────────────────
// MODELOS
// ─────────────────────────────────────────────────────

export interface User {
  id: string
  phone: string
  email?: string
  role: UserRole
  status: UserStatus
  onboarding_completed: boolean
  created_at: string
  // No vienen de /auth/me — se completan después en el store (enrichUserProfile)
  // a partir de /patients/me o /professionals/me. Por eso son opcionales.
  first_name?: string
  last_name?: string
}

export interface Patient {
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
}

export interface Professional {
  id: string
  first_name: string
  last_name: string
  specialty: string
  sub_specialties: string[]
  department?: string
  bio?: string
  languages: string[]
  years_experience: number
  photo_url?: string
  availability: AvailabilityMode
  auto_availability?: boolean
  appointment_duration_minutes?: number
  price_general: string
  price_urgent: string
  price_follow_up: string
  average_rating: string
  total_ratings: number
  total_consultations: number
}

export interface Consultation {
  id: string
  patient_id: string
  professional_id?: string
  consultation_type: ConsultationType
  status: ConsultationStatus
  specialty?: string
  chief_complaint?: string
  amount: string
  platform_fee: string
  professional_earning: string
  video_room_url?: string
  scheduled_at?: string
  reschedule_proposed_at?: string
  reschedule_proposed_by?: 'PATIENT' | 'PROFESSIONAL'
  reschedule_used?: boolean
  reschedule_attempts?: number
  outcome_note?: string
  started_at?: string
  ended_at?: string
  duration_minutes?: number
  created_at: string
  updated_at?: string
  professional_first_name?: string
  professional_last_name?: string
  professional_photo_url?: string
  professional_department?: string
  professional_sub_specialties?: string[]
  // Duración (minutos) que el profesional configuró en /professional/schedule
  // para sus citas — usada por el calendario para dibujar bloques a tamaño real.
  professional_appointment_duration_minutes?: number
  patient_first_name?: string
  patient_last_name?: string
  payment_status?: 'PENDING' | 'CONFIRMED' | 'RELEASED_TO_PROFESSIONAL' | 'REFUNDED_PARTIAL' | 'REFUNDED_FULL' | 'DISPUTED' | 'CANCELLED_NO_CHARGE'
  payment_paid_at?: string
  payment_refunded_at?: string
  payment_refund_note?: string
}

export interface Payment {
  id: string
  consultation_id: string
  amount: string
  qr_image_url: string
  expires_at: string
  professional_name: string
  status: PaymentStatus
}

// ── FAQ (landing pública) ────────────────────────────
export type FAQAudience = 'GENERAL' | 'PATIENT' | 'PROFESSIONAL'

export interface FAQ {
  id: string
  question: string
  answer: string
  audience: FAQAudience
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Prescription {
  id: string
  consultation_id: string
  patient_name: string
  patient_ci: string
  patient_age: number
  medications: Medication[]
  instructions?: string
  digital_hash: string
  qr_verify_code: string
  pdf_url?: string
  signed_at: string
  // Anulación / reemisión (una receta firmada nunca se edita)
  status: 'ACTIVE' | 'VOIDED'
  voided_at?: string | null
  void_reason?: string | null
  replaces_prescription_id?: string | null
  // Datos del profesional enriquecidos por el backend
  professional_name?: string
  professional_specialty?: string
  professional_sub_specialties?: string[]
  professional_department?: string
  cmb_matricula?: string
}

export interface Medication {
  name: string
  presentation: string
  dosage: string
  frequency: string
  duration: string
  notes?: string
}

export interface Rating {
  id: string
  score: number
  comment?: string
  created_at: string
}

// ─────────────────────────────────────────────────────
// RESPUESTAS DE API
// ─────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

export interface AgentResponse {
  session_id: string
  message: string
  action?: {
    type: string
    param?: string
  }
  available_professionals?: Professional[]
  onboarding_completed?: boolean
}

export interface ApiError {
  detail: string
}

// ─────────────────────────────────────────────────────
// ESTADO DE SALA DE ESPERA (WebSocket)
// ─────────────────────────────────────────────────────

export interface WaitingRoomUpdate {
  event: 'STATUS_CHANGE' | 'PROFESSIONAL_CONNECTED' | 'PAYMENT_CONFIRMED' | 'AGENT_MESSAGE'
  consultation_id: string
  status?: ConsultationStatus
  message?: string
  video_url?: string
}