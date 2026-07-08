// src/lib/nav.ts
// Fuente única de verdad para los menús laterales de paciente y profesional.
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

import {
  IconHome, IconSearch, IconBot, IconClock, IconFile, IconRx, IconNote,
  IconStetho, IconPlus, IconGrid, IconUsers, IconCal, IconStar, IconUser,
  IconPatients, IconCard, IconLog, IconCog, IconTag,
} from '@/components/nav-icons'

export interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
}

export const PATIENT_NAV: NavItem[] = [
  { label: 'Inicio',           href: '/patient/dashboard',        icon: <IconHome /> },
  { label: 'Buscar médico',    href: '/patient/search',           icon: <IconSearch /> },
  { label: 'Agente IA',        href: '/patient/agent',            icon: <IconBot /> },
  { label: 'Sala de espera',   href: '/patient/waiting-room',     icon: <IconClock /> },
  { label: 'Mis consultas',    href: '/patient/history',          icon: <IconFile /> },
  { label: 'Mis pagos',        href: '/patient/payments',         icon: <IconCard /> },
  { label: 'Mis recetas',      href: '/patient/prescriptions',    icon: <IconRx /> },
  { label: 'Historia clínica', href: '/patient/clinical-history', icon: <IconNote /> },
  { label: 'Datos médicos',    href: '/patient/medical-profile',  icon: <IconPlus /> },
  { label: 'Mis profesionales',href: '/patient/professionals',    icon: <IconStetho /> },
]

export const PROFESSIONAL_NAV: NavItem[] = [
  { label: 'Resumen',            href: '/professional/dashboard',      icon: <IconGrid /> },
  { label: 'Consultas inmediatas',href: '/professional/consultations', icon: <IconUsers /> },
  { label: 'Mis pacientes',      href: '/professional/patients',       icon: <IconPatients /> },
  { label: 'Citas agendadas',    href: '/professional/appointments',   icon: <IconCal /> },
  { label: 'Horarios',           href: '/professional/schedule',       icon: <IconCal /> },
  { label: 'Mis pagos',          href: '/professional/earnings',       icon: <IconCard /> },
  { label: 'Recetario',          href: '/professional/prescriptions',  icon: <IconFile /> },
  { label: 'Notas clínicas',     href: '/professional/clinical-notes', icon: <IconNote /> },
  { label: 'Calificaciones',     href: '/professional/ratings',        icon: <IconStar /> },
  { label: 'Mi perfil',          href: '/professional/profile',        icon: <IconUser /> },
]

// Nota sobre "Pacientes": las 8 páginas de admin usaban IconUsers tanto para
// "Profesionales" como para "Pacientes" — el mismo ícono para dos secciones
// distintas. admin/patients ya tenía definido (sin usar) un ícono de una sola
// persona para este fin; lo retomamos aquí como IconUser para diferenciarlos.
export const ADMIN_NAV: NavItem[] = [
  { label: 'Resumen',        href: '/admin/dashboard',     icon: <IconGrid /> },
  { label: 'Profesionales',  href: '/admin/professionals', icon: <IconUsers /> },
  { label: 'Pacientes',      href: '/admin/patients',      icon: <IconUser /> },
  { label: 'Especialidades', href: '/admin/specialties',   icon: <IconTag /> },
  { label: 'FAQ',            href: '/admin/faq',           icon: <IconNote /> },
  { label: 'Pagos',          href: '/admin/payments',      icon: <IconCard /> },
  { label: 'IA / WhatsApp',  href: '/admin/ia',            icon: <IconBot /> },
  { label: 'Auditoría',      href: '/admin/logs',          icon: <IconLog /> },
  { label: 'Configuración',  href: '/admin/settings',      icon: <IconCog /> },
]
