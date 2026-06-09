// src/lib/api.ts
import axios, { AxiosError } from 'axios'
import type {
  AuthResponse, User, Professional, Consultation,
  Payment, Prescription, AgentResponse, Rating
} from '@/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'

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
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('mb_token')
      localStorage.removeItem('mb_user')
      window.location.href = '/auth/login'
    }
    return Promise.reject(error)
  }
)

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail || 'Error de conexión. Intenta de nuevo.'
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
    phone: string; email: string; password: string
    first_name: string; last_name: string; ci: string; specialty: string
    languages?: string[]; birth_date?: string; department?: string; gender?: string
  }) => api.post<AuthResponse>('/auth/register/professional', data),

  login: (phone: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { phone, password }),

  me: () => api.get<User>('/auth/me'),
  logout: () => api.post('/auth/logout'),
}

export const professionalsAPI = {
  list: (params?: { specialty?: string; available_now?: boolean; search?: string }) =>
    api.get<Professional[]>('/professionals', { params }),

  getById: (id: string) =>
    api.get<Professional>(`/professionals/${id}`),

  updateAvailability: (availability: string) =>
    api.patch('/professionals/availability', { availability }),

  updatePrices: (prices: { price_general?: number; price_urgent?: number; price_follow_up?: number }) =>
    api.patch('/professionals/prices', prices),

  uploadDocument: (docType: string, file: File) => {
    const form = new FormData()
    form.append('doc_type', docType)
    form.append('file', file)
    return api.post('/professionals/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getMyProfile: () =>
    api.get("/professionals/me").then(r => r.data),

  verify: (id: string, status: string, note?: string) =>
    api.patch(`/professionals/${id}/verify`, null, { params: { new_status: status, review_note: note } }),
}

export const consultationsAPI = {
  create: (data: {
    professional_id: string
    consultation_type?: string
    specialty?: string
    chief_complaint?: string
  }) => api.post<Consultation>('/consultations', data),

  getMyConsultations: () =>
    api.get<Consultation[]>('/consultations/my'),

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
}

export const agentAPI = {
  chat: (message: string, sessionId?: string) =>
    api.post<AgentResponse>('/agent/chat', { message, session_id: sessionId }),

  onboarding: (message: string, sessionId?: string) =>
    api.post<AgentResponse>('/agent/onboarding', { message, session_id: sessionId }),

  getHistory: (sessionId: string) =>
    api.get(`/agent/history/${sessionId}`),

  // ── Nuevos: voz ──────────────────────────────────
  tts: (text: string) =>
    api.post('/agent/tts', null, { params: { text } }),

  voiceChat: (formData: FormData) =>
    api.post('/agent/voice-chat', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    }),
}

export const prescriptionsAPI = {
  create: (data: {
    consultation_id: string
    medications: any[]
    instructions?: string
  }) => api.post<Prescription>('/prescriptions', data),

  getByConsultation: (consultationId: string) =>
    api.get<Prescription[]>(`/prescriptions/consultation/${consultationId}`),

  verify: (code: string) =>
    api.get(`/prescriptions/verify/${code}`),
}

export const ratingsAPI = {
  create: (consultationId: string, score: number, comment?: string) =>
    api.post<Rating>('/ratings', { consultation_id: consultationId, score, comment }),
}