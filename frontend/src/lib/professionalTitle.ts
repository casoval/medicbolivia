// src/lib/professionalTitle.ts
//
// Mismo criterio que backend/app/core/professional_title.py: el
// tratamiento formal a anteponer al nombre de un profesional según su
// campo `gender` ("Masculino" / "Femenino" / "Otro" / vacío — ver
// formulario de registro en auth/register/professional).
//
// Antes cada pantalla armaba el saludo/nombre a mano, la mayoría con el
// genérico "Dr(a)." fijo (sin mirar el género cargado) y algunas otras
// con "Dr." fijo (asumiendo que todo profesional es varón). Esta función
// centraliza esa decisión una sola vez:
//   - "Masculino" → "Dr."
//   - "Femenino"  → "Dra."
//   - cualquier otro valor (undefined, "", "Otro", no reconocido) →
//     "Dr(a)." — el mismo genérico de siempre, para no inventar un
//     género que el profesional no cargó.
//
// El punto final queda incluido en el valor devuelto a propósito, así
// el llamador solo hace `${professionalTitle(gender)} ${first} ${last}`.
export function professionalTitle(gender?: string | null): string {
  const normalized = (gender || '').trim().toLowerCase()
  if (normalized === 'masculino' || normalized === 'm' || normalized === 'male') return 'Dr.'
  if (normalized === 'femenino' || normalized === 'f' || normalized === 'female') return 'Dra.'
  return 'Dr(a).'
}

export function professionalFullName(
  firstName: string,
  lastName?: string | null,
  gender?: string | null
): string {
  return `${professionalTitle(gender)} ${firstName} ${lastName || ''}`.trim()
}
