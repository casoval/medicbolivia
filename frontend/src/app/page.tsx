// src/app/page.tsx
// Página de inicio — redirige según el rol del usuario
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/store'

export default function HomePage() {
  const router = useRouter()
  const { user, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login')
      return
    }
    if (user?.role === 'PATIENT') router.push('/patient/dashboard')
    else if (user?.role === 'PROFESSIONAL') router.push('/professional/dashboard')
    else if (user?.role === 'ADMIN') router.push('/admin/dashboard')
  }, [isAuthenticated, user, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[#185FA5] border-t-transparent rounded-full animate-spin-slow" />
        <p className="text-sm text-[#6B738A]">Redirigiendo...</p>
      </div>
    </div>
  )
}
