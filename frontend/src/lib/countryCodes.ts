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
  iso: string    // ISO 3166-1 alpha-2, para mostrar compacto en el selector (ej. "BO")
  flag: string
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '591', name: 'Bolivia', iso: 'BO', flag: '🇧🇴' },
  { code: '54', name: 'Argentina', iso: 'AR', flag: '🇦🇷' },
  { code: '55', name: 'Brasil', iso: 'BR', flag: '🇧🇷' },
  { code: '56', name: 'Chile', iso: 'CL', flag: '🇨🇱' },
  { code: '51', name: 'Perú', iso: 'PE', flag: '🇵🇪' },
  { code: '595', name: 'Paraguay', iso: 'PY', flag: '🇵🇾' },
  { code: '598', name: 'Uruguay', iso: 'UY', flag: '🇺🇾' },
  { code: '57', name: 'Colombia', iso: 'CO', flag: '🇨🇴' },
  { code: '58', name: 'Venezuela', iso: 'VE', flag: '🇻🇪' },
  { code: '593', name: 'Ecuador', iso: 'EC', flag: '🇪🇨' },
  { code: '507', name: 'Panamá', iso: 'PA', flag: '🇵🇦' },
  { code: '506', name: 'Costa Rica', iso: 'CR', flag: '🇨🇷' },
  { code: '502', name: 'Guatemala', iso: 'GT', flag: '🇬🇹' },
  { code: '504', name: 'Honduras', iso: 'HN', flag: '🇭🇳' },
  { code: '503', name: 'El Salvador', iso: 'SV', flag: '🇸🇻' },
  { code: '505', name: 'Nicaragua', iso: 'NI', flag: '🇳🇮' },
  { code: '1', name: 'República Dominicana', iso: 'DO', flag: '🇩🇴' },
  { code: '1', name: 'Puerto Rico', iso: 'PR', flag: '🇵🇷' },
  { code: '53', name: 'Cuba', iso: 'CU', flag: '🇨🇺' },
  { code: '52', name: 'México', iso: 'MX', flag: '🇲🇽' },
  { code: '34', name: 'España', iso: 'ES', flag: '🇪🇸' },
  { code: '351', name: 'Portugal', iso: 'PT', flag: '🇵🇹' },
  { code: '1', name: 'Estados Unidos', iso: 'US', flag: '🇺🇸' },
  { code: '1', name: 'Canadá', iso: 'CA', flag: '🇨🇦' },
  { code: '44', name: 'Reino Unido', iso: 'GB', flag: '🇬🇧' },
  { code: '33', name: 'Francia', iso: 'FR', flag: '🇫🇷' },
  { code: '49', name: 'Alemania', iso: 'DE', flag: '🇩🇪' },
  { code: '39', name: 'Italia', iso: 'IT', flag: '🇮🇹' },
  { code: '86', name: 'China', iso: 'CN', flag: '🇨🇳' },
  { code: '81', name: 'Japón', iso: 'JP', flag: '🇯🇵' },
  { code: '91', name: 'India', iso: 'IN', flag: '🇮🇳' },
]

export const DEFAULT_COUNTRY_CODE = '591' // Bolivia
