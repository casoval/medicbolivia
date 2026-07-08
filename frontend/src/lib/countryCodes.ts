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
  { code: '598', name: 'Uruguay', flag: '🇺🇾' },
  { code: '57', name: 'Colombia', flag: '🇨🇴' },
  { code: '58', name: 'Venezuela', flag: '🇻🇪' },
  { code: '593', name: 'Ecuador', flag: '🇪🇨' },
  { code: '507', name: 'Panamá', flag: '🇵🇦' },
  { code: '506', name: 'Costa Rica', flag: '🇨🇷' },
  { code: '502', name: 'Guatemala', flag: '🇬🇹' },
  { code: '504', name: 'Honduras', flag: '🇭🇳' },
  { code: '503', name: 'El Salvador', flag: '🇸🇻' },
  { code: '505', name: 'Nicaragua', flag: '🇳🇮' },
  { code: '1', name: 'República Dominicana', flag: '🇩🇴' },
  { code: '1', name: 'Puerto Rico', flag: '🇵🇷' },
  { code: '53', name: 'Cuba', flag: '🇨🇺' },
  { code: '52', name: 'México', flag: '🇲🇽' },
  { code: '34', name: 'España', flag: '🇪🇸' },
  { code: '351', name: 'Portugal', flag: '🇵🇹' },
  { code: '1', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: '1', name: 'Canadá', flag: '🇨🇦' },
  { code: '44', name: 'Reino Unido', flag: '🇬🇧' },
  { code: '33', name: 'Francia', flag: '🇫🇷' },
  { code: '49', name: 'Alemania', flag: '🇩🇪' },
  { code: '39', name: 'Italia', flag: '🇮🇹' },
  { code: '86', name: 'China', flag: '🇨🇳' },
  { code: '81', name: 'Japón', flag: '🇯🇵' },
  { code: '91', name: 'India', flag: '🇮🇳' },
]

export const DEFAULT_COUNTRY_CODE = '591' // Bolivia
