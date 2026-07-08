// src/lib/countryCodes.ts
//
// Lista curada de códigos de país para el selector de teléfono en los
// formularios de registro. Espejo intencional de
// backend/app/core/phone.py::COUNTRY_CALLING_CODES — si se agrega un país
// acá, agregarlo también del lado del backend (o el backend lo va a
// rechazar como "número inválido" aunque el frontend lo deje elegir).
//
// Bolivia va primero porque es el país de origen del producto y el
// default preseleccionado en el selector.

export interface CountryCode {
  code: string   // código de marcado, sin '+' (ej. "591")
  name: string
  flag: string
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '591', name: 'Bolivia', flag: '🇧🇴' },
  { code: '54', name: 'Argentina', flag: '🇦🇷' },
  { code: '55', name: 'Brasil', flag: '🇧🇷' },
  { code: '56', name: 'Chile', flag: '🇨🇱' },
  { code: '51', name: 'Perú', flag: '🇵🇪' },
  { code: '595', name: 'Paraguay', flag: '🇵🇾' },
  { code: '57', name: 'Colombia', flag: '🇨🇴' },
  { code: '34', name: 'España', flag: '🇪🇸' },
  { code: '1', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: '52', name: 'México', flag: '🇲🇽' },
]

export const DEFAULT_COUNTRY_CODE = '591' // Bolivia
