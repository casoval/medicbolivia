// src/lib/store.ts
import { create } from 'zustand'
import type { User } from '@/types'
import { authAPI, professionalsAPI, patientsAPI } from './api'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (phone: string, password: string) => Promise<void>
  logout: () => Promise<void>
  loadUser: () => Promise<void>
  enrichUserProfile: () => Promise<void>
  setUser: (user: User) => void
  // Reemplaza al viejo setToken: el JWT ya no es visible para el
  // frontend (vive en una cookie httpOnly), así que después de un
  // login/registro exitoso lo único que hay que guardar en el store es
  // el usuario, marcando la sesión como autenticada.
  setAuthenticated: (user: User) => void
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (phone, password) => {
    set({ isLoading: true })
    try {
      const res = await authAPI.login(phone, password)
      set({ user: res.data.user, isAuthenticated: true, isLoading: false })
      await get().enrichUserProfile()
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  logout: async () => {
    // Con la cookie httpOnly, JS no puede borrarla por su cuenta — hay
    // que esperar la respuesta del backend (que sí manda el
    // Set-Cookie de borrado). Si esto fuera "fire and forget" (sin
    // await), la navegación a /auth/login corta la request a mitad de
    // camino y la cookie NUNCA se borra, aunque la pantalla ya
    // muestre el login — es exactamente el bug que encontramos en
    // pruebas. Igual navegamos aunque la llamada falle (red caída,
    // etc.): peor caso, la cookie expira sola a las 24h.
    try {
      await authAPI.logout()
    } catch {
      // no bloqueamos el logout del lado cliente por esto
    }
    set({ user: null, isAuthenticated: false })
    window.location.href = '/auth/login'
  },

  loadUser: async () => {
    // Ya no podemos "ver" si hay sesión desde JS (la cookie es
    // httpOnly) — así que siempre intentamos /auth/me al arrancar la
    // app, y dejamos que el 401 (si no hay cookie o expiró) nos diga
    // que no hay sesión. Providers.tsx ya muestra un spinner de carga
    // mientras esto resuelve, así que no hay parpadeo de contenido.
    set({ isLoading: true })
    try {
      const res = await authAPI.me()
      set({ user: res.data, isAuthenticated: true, isLoading: false })
      await get().enrichUserProfile()
    } catch (err: any) {
      set({ isLoading: false })
      // Solo cerramos sesión si el token realmente es inválido/no existe.
      // Si es un 503 de modo mantenimiento (u otro error transitorio),
      // no tocamos el estado: la sesión sigue siendo válida del lado
      // del servidor, no hace falta volver a loguearse.
      if (err?.response?.status === 401) {
        set({ user: null, isAuthenticated: false })
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
  setAuthenticated: (user) => set({ user, isAuthenticated: true }),
}))

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