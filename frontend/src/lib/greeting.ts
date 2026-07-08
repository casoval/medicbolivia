/**
 * Saludo dinámico según la hora del día, usado en los dashboards de
 * paciente, profesional y administrador.
 *
 *  - 05:00 a 11:59  → "Buenos días"
 *  - 12:00 a 17:59  → "Buenas tardes"
 *  - 18:00 a 04:59  → "Buenas noches"
 */
export function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'Buenos días'
  if (hour >= 12 && hour < 18) return 'Buenas tardes'
  return 'Buenas noches'
}