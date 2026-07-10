// src/lib/nav.ts
// Fuente única de verdad para los menús laterales de paciente, profesional y admin.
//
// Antes cada page.tsx definía su propio array NAV (con sus propios íconos
// duplicados). Eso causó dos bugs reales encontrados al centralizar esto:
//   - patient/medical-profile tenía "Datos médicos" y "Mis profesionales"
//     en orden invertido respecto a las otras 8 páginas.
//   - professional/schedule no tenía el ítem "Notas clínicas" en absoluto,
//     dejando esa sección inalcanzable desde el menú en esa página.
//
// Con un solo array por rol, un cambio (renombrar, reordenar, agregar ítem)
// se hace una sola vez y no puede volver a desincronizarse entre páginas.
//
// El orden de PATIENT_NAV y PROFESSIONAL_NAV sigue el flujo natural de uso
// (de arriba hacia abajo, en el orden en que normalmente se necesitan), no
// un orden alfabético ni el orden en que las páginas fueron creadas.
// Cada ítem incluye además "description": una frase corta en lenguaje llano
// que explica qué hace la sección, visible debajo del label en el sidebar.

import {
  IconHome, IconSearch, IconBot, IconClock, IconFile, IconRx, IconNote,
  IconStetho, IconGrid, IconUsers, IconCal, IconStar, IconUser,
  IconPatients, IconCard, IconLog, IconCog, IconTag,
} from '@/components/nav-icons'

export interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
  /** Frase corta y clara: qué hace esta sección. Se muestra bajo el label. */
  description: string
}

// Flujo del paciente: llega al inicio, si no sabe qué especialista necesita
// usa el agente IA para triage, busca médico, revisa los profesionales que
// ya siguió/consultó, entra a la sala de espera cuando tiene una consulta
// agendada o inmediata, revisa el historial de consultas pasadas, consulta
// su historia clínica y recetas emitidas, revisa sus pagos y por último
// gestiona su perfil.
export const PATIENT_NAV: NavItem[] = [
  {
    label: 'Inicio',
    href: '/patient/dashboard',
    icon: <IconHome />,
    description: 'Resumen general de tu actividad y próximas consultas',
  },
  {
    label: 'Agente IA',
    href: '/patient/agent',
    icon: <IconBot />,
    description: 'Cuéntale tus síntomas y te orienta a la especialidad correcta',
  },
  {
    label: 'Buscar médico',
    href: '/patient/search',
    icon: <IconSearch />,
    description: 'Encuentra y filtra profesionales por especialidad y disponibilidad',
  },
  {
    label: 'Mis profesionales',
    href: '/patient/professionals',
    icon: <IconStetho />,
    description: 'Médicos que ya has consultado o guardado como favoritos',
  },
  {
    label: 'Sala de espera',
    href: '/patient/waiting-room',
    icon: <IconClock />,
    description: 'Espera en línea a que tu profesional te atienda',
  },
  {
    label: 'Mis consultas',
    href: '/patient/history',
    icon: <IconFile />,
    description: 'Historial de todas tus consultas, pasadas y en curso',
  },
  {
    label: 'Historia clínica',
    href: '/patient/clinical-history',
    icon: <IconNote />,
    description: 'Diagnósticos y notas médicas que registraron tus profesionales',
  },
  {
    label: 'Mis recetas',
    href: '/patient/prescriptions',
    icon: <IconRx />,
    description: 'Medicamentos recetados en tus consultas',
  },
  {
    label: 'Mis pagos',
    href: '/patient/payments',
    icon: <IconCard />,
    description: 'Cobros e historial de pagos de tus consultas',
  },
  {
    label: 'Perfil',
    href: '/patient/profile',
    icon: <IconUser />,
    description: 'Tus datos personales y de contacto',
  },
]

// Flujo del profesional: ve su resumen del día, configura su disponibilidad
// (paso previo indispensable para poder recibir citas), revisa las citas ya
// agendadas y las consultas inmediatas entrantes, gestiona a sus pacientes,
// registra notas clínicas y recetas durante/después de la consulta, revisa
// sus calificaciones, sus pagos y por último su perfil profesional.
export const PROFESSIONAL_NAV: NavItem[] = [
  {
    label: 'Resumen',
    href: '/professional/dashboard',
    icon: <IconGrid />,
    description: 'Vista general de tu actividad, citas y consultas del día',
  },
  {
    label: 'Horarios',
    href: '/professional/schedule',
    icon: <IconCal />,
    description: 'Configura los horarios en que estás disponible para atender',
  },
  {
    label: 'Citas agendadas',
    href: '/professional/appointments',
    icon: <IconCal />,
    description: 'Consultas programadas por tus pacientes',
  },
  {
    label: 'Consultas inmediatas',
    href: '/professional/consultations',
    icon: <IconUsers />,
    description: 'Pacientes esperando ser atendidos ahora mismo',
  },
  {
    label: 'Mis pacientes',
    href: '/professional/patients',
    icon: <IconPatients />,
    description: 'Listado de pacientes que has atendido',
  },
  {
    label: 'Notas clínicas',
    href: '/professional/clinical-notes',
    icon: <IconNote />,
    description: 'Diagnósticos y observaciones que registras por consulta',
  },
  {
    label: 'Recetario',
    href: '/professional/prescriptions',
    icon: <IconFile />,
    description: 'Medicamentos que has recetado a tus pacientes',
  },
  {
    label: 'Calificaciones',
    href: '/professional/ratings',
    icon: <IconStar />,
    description: 'Reseñas y puntaje que te dejan tus pacientes',
  },
  {
    label: 'Mis pagos',
    href: '/professional/earnings',
    icon: <IconCard />,
    description: 'Tus ingresos y el historial de cobros por consulta',
  },
  {
    label: 'Mi perfil',
    href: '/professional/profile',
    icon: <IconUser />,
    description: 'Tus datos, especialidad y credenciales profesionales',
  },
]

// Flujo del admin: resumen general primero, luego la gestión de las dos
// entidades base de la plataforma (profesionales y pacientes), después el
// catálogo de especialidades y el FAQ que dependen de esas entidades,
// seguido de pagos (que dependen de que existan consultas), la IA/WhatsApp
// como canal de soporte, y por último las secciones de sistema: auditoría
// y configuración.
export const ADMIN_NAV: NavItem[] = [
  {
    label: 'Resumen',
    href: '/admin/dashboard',
    icon: <IconGrid />,
    description: 'Métricas generales de la plataforma',
  },
  {
    label: 'Profesionales',
    href: '/admin/professionals',
    icon: <IconUsers />,
    description: 'Aprueba, edita y gestiona a los profesionales de salud',
  },
  {
    label: 'Pacientes',
    href: '/admin/patients',
    icon: <IconUser />,
    description: 'Listado y gestión de las cuentas de pacientes',
  },
  {
    label: 'Especialidades',
    href: '/admin/specialties',
    icon: <IconTag />,
    description: 'Catálogo de especialidades médicas disponibles',
  },
  {
    label: 'FAQ',
    href: '/admin/faq',
    icon: <IconNote />,
    description: 'Preguntas frecuentes que ve el agente IA y los usuarios',
  },
  {
    label: 'Pagos',
    href: '/admin/payments',
    icon: <IconCard />,
    description: 'Transacciones y cobros de toda la plataforma',
  },
  {
    label: 'IA / WhatsApp',
    href: '/admin/ia',
    icon: <IconBot />,
    description: 'Configura el agente de IA y el canal de WhatsApp',
  },
  {
    label: 'Auditoría',
    href: '/admin/logs',
    icon: <IconLog />,
    description: 'Registro de acciones realizadas en el sistema',
  },
  {
    label: 'Configuración',
    href: '/admin/settings',
    icon: <IconCog />,
    description: 'Ajustes generales de la plataforma',
  },
]
