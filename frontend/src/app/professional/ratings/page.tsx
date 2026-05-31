'use client'
// src/app/professional/ratings/page.tsx
// Calificaciones recibidas por el profesional

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Stars, SectionTitle, EmptyState } from '@/components/ui'

const IconGrid  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
const IconUsers = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
const IconCal   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
const IconFile  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
const IconStar  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>
const IconUser  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>

const NAV = [
  { label: 'Resumen',        href: '/professional/dashboard',     icon: <IconGrid /> },
  { label: 'Consultas',      href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Horarios',       href: '/professional/schedule',      icon: <IconCal /> },
  { label: 'Recetario',      href: '/professional/prescriptions', icon: <IconFile /> },
  { label: 'Calificaciones', href: '/professional/ratings',       icon: <IconStar /> },
  { label: 'Mi perfil',      href: '/professional/profile',       icon: <IconUser /> },
]

// Datos de ejemplo — en producción vendrían de la API
const MOCK_RATINGS = [
  { id: '1', patient: 'Juan P.',  score: 5, comment: 'Excelente atención, muy profesional y clara.', date: '18 abr 2026' },
  { id: '2', patient: 'María L.', score: 5, comment: 'Muy puntual y atenta. Totalmente recomendada.', date: '16 abr 2026' },
  { id: '3', patient: 'Carlos M.',score: 4, comment: 'Buena consulta, me resolvió mis dudas.', date: '14 abr 2026' },
  { id: '4', patient: 'Ana F.',   score: 5, comment: 'Me explicó todo con mucha paciencia.', date: '10 abr 2026' },
  { id: '5', patient: 'Luis Q.',  score: 3, comment: 'Bien, aunque la espera fue un poco larga.', date: '08 abr 2026' },
]

const AVERAGE = 4.8
const TOTAL = 94
const DISTRIBUTION = [74, 14, 5, 1, 0] // 5★ a 1★

export default function RatingsPage() {
  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/ratings" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">Mis calificaciones</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">Lo que los pacientes piensan de tu atención</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* Resumen */}
          <div className="card">
            <SectionTitle>Resumen</SectionTitle>
            <div className="flex items-center gap-5 mb-4">
              <div className="text-center">
                <p className="text-4xl font-bold text-[#141820]">{AVERAGE}</p>
                <Stars score={Math.round(AVERAGE)} size="lg" />
                <p className="text-xs text-[#6B738A] mt-1">{TOTAL} calificaciones</p>
              </div>
              <div className="flex-1 space-y-1.5">
                {DISTRIBUTION.map((count, i) => {
                  const star = 5 - i
                  const pct = TOTAL > 0 ? Math.round((count / TOTAL) * 100) : 0
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="text-xs text-[#6B738A] w-4">{star}</span>
                      <div className="flex-1 h-1.5 bg-[#F5F6FA] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#EF9F27] rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-[#A0A8BF] w-5 text-right">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#DDE1EE]">
              <div className="bg-[#F5F6FA] rounded-lg p-2.5 text-center">
                <p className="text-sm font-bold text-[#0F6E56]">96%</p>
                <p className="text-xs text-[#6B738A]">recomendarían</p>
              </div>
              <div className="bg-[#F5F6FA] rounded-lg p-2.5 text-center">
                <p className="text-sm font-bold text-[#185FA5]">4.8</p>
                <p className="text-xs text-[#6B738A]">promedio general</p>
              </div>
            </div>
          </div>

          {/* Comentarios */}
          <div className="card">
            <SectionTitle>Comentarios recientes</SectionTitle>
            {MOCK_RATINGS.length === 0 ? (
              <EmptyState title="Aún no tienes calificaciones" description="Aparecerán aquí después de tu primera consulta" />
            ) : (
              <div className="space-y-3">
                {MOCK_RATINGS.map((r) => (
                  <div key={r.id} className="bg-[#F5F6FA] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold">{r.patient}</p>
                      <div className="flex items-center gap-1.5">
                        <Stars score={r.score} size="sm" />
                        <span className="text-xs text-[#A0A8BF]">{r.date}</span>
                      </div>
                    </div>
                    {r.comment && (
                      <p className="text-xs text-[#6B738A] leading-relaxed">{r.comment}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
