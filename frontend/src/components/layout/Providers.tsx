'use client'
// src/components/layout/Providers.tsx
// Envuelve la app con QueryClient (React Query) e inicializa el auth

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/store'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,  // 5 minutos
      retry: 1,
    },
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((s) => s.loadUser)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadUser().finally(() => setReady(true))
  }, [loadUser])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow" />
          <p className="text-sm text-[#6B738A]">Cargando MedicBolivia...</p>
        </div>
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
