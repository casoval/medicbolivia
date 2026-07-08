// src/lib/store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'
import { authAPI, professionalsAPI, patientsAPI } from './api'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (phone: string, password: string) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
  enrichUserProfile: () => Promise<void>
  setUser: (user: User) => void
  setToken: (token: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (phone, password) => {
        set({ isLoading: true })
        try {
          const res = await authAPI.login(phone, password)
          const { access_token, user } = res.data
          localStorage.setItem('mb_token', access_token)
          set({ token: access_token, user, isAuthenticated: true, isLoading: false })
          await get().enrichUserProfile()
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      logout: () => {
        localStorage.removeItem('mb_token')
        localStorage.removeItem('mb_user')
        set({ user: null, token: null, isAuthenticated: false })
        window.location.href = '/auth/login'
      },

      loadUser: async () => {
        const token = localStorage.getItem('mb_token')
        if (!token) return
        try {
          const res = await authAPI.me()
          set({ user: res.data, token, isAuthenticated: true })
          await get().enrichUserProfile()
        } catch (err: any) {
          // Solo cerramos sesión si el token realmente es inválido.
          // Si es un 503 de modo mantenimiento (u otro error transitorio),
          // el token sigue siendo válido: no lo borramos, así el usuario
          // no tiene que volver a loguearse cuando termine el mantenimiento.
          if (err?.response?.status === 401) {
            localStorage.removeItem('mb_token')
            set({ user: null, token: null, isAuthenticated: false })
          }
        }
      },

      // Trae first_name/last_name del perfil específico (paciente o profesional)
      // y los mergea sobre el user base, que solo trae datos de auth (/auth/me).
      // No rompe el flujo si falla: el nombre simplemente no se muestra.
      enrichUserProfile: async () => {
        const currentUser = get().user
        if (!currentUser) return
        try {
          if (currentUser.role === 'PATIENT') {
            const profile = await patientsAPI.getMyProfile()
            set({ user: { ...currentUser, first_name: profile.first_name, last_name: profile.last_name } })
          } else if (currentUser.role === 'PROFESSIONAL') {
            const profile = await professionalsAPI.getMyProfile()
            set({ user: { ...currentUser, first_name: profile.first_name, last_name: profile.last_name } })
          }
        } catch (err) {
          console.error('No se pudo enriquecer el perfil del usuario:', err)
        }
      },

      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
    }),
    {
      name: 'mb-auth',
      partialize: (state) => ({ token: state.token }),
    }
  )
)

// ── Store del agente IA ──────────────────────────────
interface AgentMessage {
  role: 'user' | 'agent'
  text: string
  timestamp: Date
  audioBase64?: string   // audio de respuesta del agente (Google TTS)
  isVoice?: boolean      // true si el usuario envió un mensaje de voz
}

interface AgentState {
  sessionId: string | null
  messages: AgentMessage[]
  isTyping: boolean
  availableProfessionals: any[]

  setSessionId: (id: string) => void
  addMessage: (role: 'user' | 'agent', text: string, audioBase64?: string, isVoice?: boolean) => void
  setTyping: (v: boolean) => void
  setAvailableProfessionals: (pros: any[]) => void
  clearSession: () => void
}

export const useAgentStore = create<AgentState>((set) => ({
  sessionId: null,
  messages: [],
  isTyping: false,
  availableProfessionals: [],

  setSessionId: (id) => set({ sessionId: id }),

  addMessage: (role, text, audioBase64, isVoice) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { role, text, timestamp: new Date(), audioBase64, isVoice }
      ],
    })),

  setTyping: (v) => set({ isTyping: v }),
  setAvailableProfessionals: (pros) => set({ availableProfessionals: pros }),
  clearSession: () => set({ sessionId: null, messages: [], availableProfessionals: [] }),
}))