// src/lib/professionalLicense.ts
//
// Mismo criterio que backend/app/services/prescription_pdf.py: la
// matrícula profesional del Ministerio de Salud (professional_license_number)
// es el dato "oficial" desde que se retiró la verificación CMB de la
// plataforma. cmb_matricula queda solo como respaldo para médicos que se
// registraron antes de este cambio y todavía no cargaron su matrícula
// nueva en el perfil — nunca se mezclan bajo la misma etiqueta porque son
// registros de entidades distintas (Ministerio de Salud vs. Colegio Médico).
//
// Se devuelve { label, value } por separado (en vez de un string ya
// armado) para que cada pantalla pueda seguir pasando `label` por t()
// como texto estático traducible, y `value` aparte sin traducir.
export function getLicenseInfo(
  doc: { professional_license_number?: string | null; cmb_matricula?: string | null }
): { label: string; value: string } | null {
  if (doc.professional_license_number) return { label: 'Matrícula profesional:', value: doc.professional_license_number }
  if (doc.cmb_matricula) return { label: 'Matrícula CMB:', value: doc.cmb_matricula }
  return null
}
