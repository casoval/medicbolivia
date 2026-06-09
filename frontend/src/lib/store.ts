// src/lib/store.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'
import { authAPI } from './api'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (phone: string, password: string) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
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
        } catch {
          localStorage.removeItem('mb_token')
          set({ user: null, token: null, isAuthenticated: false })
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