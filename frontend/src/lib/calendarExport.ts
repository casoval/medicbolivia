// src/lib/calendarExport.ts
// Genera un archivo .ics (estándar iCalendar, lo abre cualquier app de
// calendario: Google Calendar, Apple Calendar, Outlook, etc.) para que el
// paciente o el profesional no se olviden de una cita agendada. También
// arma el enlace directo de "Agregar a Google Calendar" para no depender
// de que el navegador abra bien el .ics en celulares.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Formato requerido por iCalendar: YYYYMMDDTHHmmssZ (en UTC)
function toICSDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  )
}

function escapeICSText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export interface CalendarEventInput {
  title: string
  description?: string
  location?: string
  startsAt: Date
  durationMinutes?: number // default 30
  uid: string // idealmente el id de la consulta, para que sea estable
}

function buildICS(ev: CalendarEventInput): string {
  const start = ev.startsAt
  const end = new Date(start.getTime() + (ev.durationMinutes ?? 30) * 60 * 1000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MedicBolivia//Consultas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@medicbolivia`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICSText(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeICSText(ev.description)}` : '',
    ev.location ? `LOCATION:${escapeICSText(ev.location)}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M', // recordatorio 30 min antes, además del que ya manda la plataforma
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICSText(ev.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.join('\r\n')
}

// Descarga el .ics — funciona en computadora y en la mayoría de celulares
// (Android/iOS abren el archivo directo con la app de calendario elegida).
export function downloadICS(ev: CalendarEventInput) {
  const ics = buildICS(ev)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cita-medicbolivia-${ev.uid}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Enlace directo a Google Calendar (más cómodo en celulares con Gmail/Google
// Calendar ya instalado — no depende de que el navegador sepa abrir el .ics).
export function googleCalendarUrl(ev: CalendarEventInput): string {
  const start = ev.startsAt
  const end = new Date(start.getTime() + (ev.durationMinutes ?? 30) * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${toICSDate(start)}/${toICSDate(end)}`,
    details: ev.description ?? '',
    location: ev.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
