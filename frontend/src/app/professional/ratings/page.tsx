'use client'
// src/app/professional/ratings/page.tsx

import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PROFESSIONAL_NAV as NAV } from '@/lib/nav'
import { Stars, SectionTitle, EmptyState, LoadingScreen } from '@/components/ui'
import { ratingsAPI } from '@/lib/api'
import { useLanguage } from '@/lib/i18n/LanguageContext'

export default function RatingsPage() {
  const { t } = useLanguage()
  const { data, isLoading, error } = useQuery({
    queryKey: ['ratings', 'my'],
    queryFn: () => ratingsAPI.getMy().then(r => r.data),
    refetchInterval: 10000,     // recarga cada 10 segundos
    refetchOnWindowFocus: true, // recarga al volver a la pestaña
  })

  const ratings: any[] = data?.ratings ?? []
  const average: number = data?.average ?? 0
  const total: number = data?.total ?? 0

  const distribution = [5, 4, 3, 2, 1].map(n => ({
    star: n,
    count: ratings.filter(r => Math.round(r.score) === n).length,
  }))

  const positiveCount = ratings.filter(r => r.score >= 4).length
  const recommendPct = total > 0 ? Math.round((positiveCount / total) * 100) : 0

  return (
    <DashboardLayout navItems={NAV} activeHref="/professional/ratings" role="PROFESSIONAL">
      <div className="max-w-3xl">
        <div className="mb-4">
          <h1 className="text-base font-semibold">{t('Mis calificaciones')}</h1>
          <p className="text-xs text-[#6B738A] mt-0.5">{t('Lo que los pacientes piensan de tu atención')}</p>
        </div>

        {isLoading ? (
          <LoadingScreen text="Cargando calificaciones..." />
        ) : error ? (
          <div className="card text-center py-8">
            <p className="text-2xl mb-2">⚠️</p>
            <p className="text-sm text-[#E24B4A]">{t('Error al cargar calificaciones')}</p>
            <p className="text-xs text-[#6B738A] mt-1">{t('Intenta recargar la página')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Resumen */}
            <div className="card">
              <SectionTitle>{t('Resumen')}</SectionTitle>
              {total === 0 ? (
                <EmptyState
                  title="Aún no tienes calificaciones"
                  description="Aparecerán aquí después de tu primera consulta completada"
                />
              ) : (
                <>
                  <div className="flex items-center gap-5 mb-4">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-[#141820]">{average.toFixed(1)}</p>
                      <Stars score={Math.round(average)} size="lg" />
                      <p className="text-xs text-[#6B738A] mt-1">
                        {total} {total === 1 ? 'calificación' : 'calificaciones'}
                      </p>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {distribution.map(({ star, count }) => {
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0
                        return (
                          <div key={star} className="flex items-center gap-2">
                            <span className="text-xs text-[#6B738A] w-4">{star}</span>
                            <div className="flex-1 h-1.5 bg-[#F5F6FA] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#EF9F27] rounded-full transition-all"
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
                      <p className="text-sm font-bold text-[#0F6E56]">{recommendPct}%</p>
                      <p className="text-xs text-[#6B738A]">{t('recomendarían')}</p>
                    </div>
                    <div className="bg-[#F5F6FA] rounded-lg p-2.5 text-center">
                      <p className="text-sm font-bold text-[#185FA5]">{average.toFixed(1)}</p>
                      <p className="text-xs text-[#6B738A]">{t('promedio general')}</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Comentarios recientes */}
            <div className="card">
              <SectionTitle>{t('Comentarios recientes')}</SectionTitle>
              {ratings.length === 0 ? (
                <EmptyState
                  title="Sin comentarios aún"
                  description="Los comentarios de tus pacientes aparecerán aquí"
                />
              ) : (
                <div className="space-y-3">
                  {ratings.slice(0, 8).map((r: any) => (
                    <div key={r.id} className="bg-[#F5F6FA] rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-semibold">
                          {r.patient_name || 'Paciente'}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Stars score={Math.round(r.score)} size="sm" />
                          <span className="text-xs text-[#A0A8BF]">
                            {new Date(r.created_at).toLocaleDateString('es-BO', {
                              day: 'numeric', month: 'short', year: 'numeric'
                            })}
                          </span>
                        </div>
                      </div>
                      {r.comment && (
                        <p className="text-xs text-[#6B738A] leading-relaxed">"{r.comment}"</p>
                      )}
                    </div>
                  ))}
                  {ratings.length > 8 && (
                    <p className="text-xs text-center text-[#6B738A] pt-1">
                      +{ratings.length - 8} calificaciones más
                    </p>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </DashboardLayout>
  )
}