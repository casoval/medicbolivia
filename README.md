# MedicBolivia 🏥

Plataforma de telemedicina con inteligencia artificial para Bolivia.
Conecta pacientes con profesionales de salud mediante un agente IA que orienta, triaga y coordina consultas médicas en tiempo real.

---

## Para Claude — contexto de la conversación

Este proyecto fue desarrollado completamente en conversaciones con Claude (Anthropic).
Si continúas en una nueva conversación, aquí está todo lo que necesitas saber:

### Estado actual del proyecto
- ✅ Backend FastAPI completamente funcional (puerto 4000)
- ✅ Frontend Next.js completamente funcional (puerto 3000)
- ✅ Base de datos PostgreSQL con todas las tablas (14 tablas)
- ✅ Agente IA — **Gemini 2.5 Flash** con plan de pago activado (sin límite 503)
- ✅ Login, registro de pacientes y profesionales funcionando
- ✅ Panel de administración completo
- ✅ Código subido a GitHub
- ✅ **Deploy en producción: https://medicbolivia.com**
- ✅ HTTPS activo con certificado SSL (Let's Encrypt, vence sept 2026, renovación automática)
- ✅ Disponibilidad del profesional (3 modos) funcionando y sincronizada
- ✅ Precios de consulta con toggles corregidos (guarda 0 cuando desactivado)
- ✅ Agente busca profesionales reales de la BD (flujo de dos llamadas)
- ✅ **Nuevo flujo de consulta: médico acepta primero, luego paciente paga**
- ✅ Cancelación automática si médico no responde en 2 min (background task)
- ✅ Cancelación automática si paciente no paga en 5 min (background task)
- ✅ QR de pago con tiempo real de 5 minutos (sin reset al navegar)
- ✅ Timer del médico (2 min) y del QR (5 min) corregidos para Bolivia (UTC-4)
- ✅ Botón cancelar consulta en dashboard del paciente (con confirmación)
- ✅ Validación de consulta activa (no permite duplicados — error 409)
- ✅ Sala de espera auto-detecta consulta activa si no hay ID en la URL
- ✅ Endpoints nuevos: `/accept`, `/reject`, `/cancel`, `/simulate-payment`
- ✅ Enum PostgreSQL actualizado con valor `PROFESSIONAL_ACCEPTED`
- ✅ **Mensajes de voz estilo WhatsApp** en el chat del agente IA
- ✅ **Google Cloud Text-to-Speech** (Neural2-C, voz masculina español) configurado
- ✅ Gemini procesa audio directamente (REST API, no Live API)
- ✅ Reproductor de audio con onda estilo WhatsApp en burbujas de voz

### Entorno de desarrollo — Windows (usuario JACKIE)
```
Backend:  C:\proyectos\medicbolivia_v2\backend\
Frontend: C:\proyectos\medicbolivia_v2\frontend\
```

### Comandos para arrancar en local (siempre 2 terminales)
```bash
# Terminal 1 — Backend
cd C:\proyectos\medicbolivia_v2\backend
venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 4000

# Terminal 2 — Frontend
cd C:\proyectos\medicbolivia_v2\frontend
pnpm dev
```

### URLs locales
- Frontend:   http://localhost:3000
- Backend:    http://localhost:4000
- API Docs:   http://localhost:4000/docs

### URLs de producción
- Frontend:   https://medicbolivia.com
- Backend:    https://medicbolivia.com/api/v1
- API Docs:   https://medicbolivia.com/api/v1/docs
- Health:     http://localhost:4000/health (solo desde el VPS)

### Usuarios de prueba
- Admin:       teléfono `70000000`, contraseña `admin123456`
- Paciente:    teléfono `69625434` (creado durante pruebas locales)
- Profesional: teléfono `71111111`, contraseña `prof123456` (isaias castro, disponible)

### Versiones instaladas (local Windows)
- Python 3.11.9 (usar `py -3.11` en Windows)
- Node.js v20.19.0
- pnpm 10.33.2
- PostgreSQL 15.17 (puerto 5432)
- Redis via Memurai (comando: `memurai-cli ping`)

### Versiones instaladas (VPS producción)
- Python 3.12.3
- Node.js v20.x
- pnpm 10.34.1
- PostgreSQL 18.3 (puerto 5432)
- Redis (puerto 6379)

### Columnas y enums agregados manualmente a PostgreSQL
```sql
-- Ejecutar si se reinstala la BD:
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS birth_date TIMESTAMP;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS department VARCHAR(50);
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TYPE doctype ADD VALUE IF NOT EXISTS 'ACADEMIC_DIPLOMA';
ALTER TYPE doctype ADD VALUE IF NOT EXISTS 'HEALTH_MINISTRY';
ALTER TYPE consultationstatus ADD VALUE IF NOT EXISTS 'PROFESSIONAL_ACCEPTED';
```

### ⚠️ Nota importante sobre el frontend — .env.local
El archivo `frontend/.env.local` sobreescribe a `.env.production` en Next.js.
En producción debe contener:
```env
NEXT_PUBLIC_API_URL=https://medicbolivia.com/api/v1
NEXT_PUBLIC_WS_URL=wss://medicbolivia.com
```
En desarrollo local debe contener:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```
Siempre hacer `pnpm build` después de cambiar estas variables.

### ⚠️ ALLOWED_ORIGINS en el backend .env
Debe estar en formato JSON con comillas dobles:
```env
ALLOWED_ORIGINS=["http://localhost:3000","https://medicbolivia.com"]
```

---

## Flujo de consulta — versión actual

```
Paciente elige médico
        ↓
Consulta creada → estado: WAITING_PROFESSIONAL
        ↓
Médico ve solicitud con timer de 2 minutos
        ↓ (acepta)                    ↓ (rechaza o no responde en 2 min)
estado: WAITING_PAYMENT          estado: CANCELLED (sin cobro)
        ↓
QR de pago aparece (5 minutos para pagar)
        ↓ (paga)                      ↓ (no paga en 5 min)
estado: PAYMENT_CONFIRMED        estado: CANCELLED (sin cobro)
        ↓
Médico inicia la consulta → estado: IN_PROGRESS
        ↓
Médico finaliza → estado: COMPLETED
```

### Cancelaciones automáticas (background tasks)
- Si el médico no acepta en **2 minutos** → se cancela sin cobro
- Si el paciente no paga en **5 minutos** → se cancela sin cobro
- El paciente puede cancelar manualmente desde el dashboard (solo antes del pago)

### Botones de desarrollo (solo en NODE_ENV=development)
- **"🩺 Simular que el médico acepta"** — en sala de espera, paso 1
- **"⚡ Saltar pago (simular confirmado)"** — en sala de espera, paso 2
- **"🔄 Reintentar generar QR"** — si el QR falla

---

## Agente IA — Gemini 2.5 Flash + Google TTS

### Texto
El agente usa **Gemini 2.5 Flash** con SDK `google-genai`.
Plan de pago activado en Google AI Studio — sin límites 503.

### Voz (mensajes de voz estilo WhatsApp)
- **STT (voz → texto):** Gemini procesa el audio directamente (REST API multimodal)
- **TTS (texto → voz):** Google Cloud Text-to-Speech Neural2
- **Voz:** `es-US-Neural2-C` (masculina, español neutro)
- **Formato entrada:** `audio/webm` (grabado por el navegador)
- **Formato salida:** `audio/mp3` (generado por Google TTS)

### Flujo de mensaje de voz
```
Paciente mantiene presionado 🎤 → graba audio (webm)
        ↓
Backend recibe el audio
        ↓
Gemini 2.5 Flash transcribe + entiende + responde (texto)
        ↓
Google Cloud TTS convierte respuesta a audio MP3
        ↓
Frontend muestra burbuja de voz con reproductor estilo WhatsApp
```

### Variables de entorno necesarias (backend/.env)
```env
GEMINI_API_KEY=tu-clave-aqui          # https://aistudio.google.com (plan pago)
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_TTS_API_KEY=tu-clave-aqui      # https://console.cloud.google.com
GOOGLE_TTS_VOICE=es-US-Neural2-C      # voz masculina
GOOGLE_TTS_LANGUAGE=es-US
```

### Voces disponibles Google TTS Neural2 (español)
| Voz | Género | Descripción |
|-----|--------|-------------|
| `es-US-Neural2-A` | Femenina | Español neutro |
| `es-US-Neural2-B` | Masculina | Español neutro |
| `es-US-Neural2-C` | Masculina | Español neutro (actual) |
| `es-US-Neural2-F` | Femenina | Español neutro |

### Costo estimado Google TTS
- 1 millón de caracteres/mes gratis (voces Neural2)
- ~$16 por millón de caracteres adicionales
- Consulta típica de 3 oraciones ≈ 200 caracteres ≈ $0.003

### Archivos del sistema de voz
- `backend/app/api/v1/endpoints/agent.py` — endpoints `/voice-chat` y `/tts`
- `frontend/src/app/patient/agent/page.tsx` — grabación + reproductor WhatsApp
- `frontend/src/lib/api.ts` — métodos `voiceChat()` y `tts()`
- `frontend/src/lib/store.ts` — interface `AgentMessage` con `audioBase64` e `isVoice`

---

## Archivos modificados

### Backend
| Archivo | Cambios |
|---------|---------|
| `app/api/v1/endpoints/consultations.py` | Nuevo flujo: médico acepta primero. Endpoints: `/accept`, `/reject`, `/cancel`, `/simulate-payment`. Background tasks. QR reutiliza `expires_at`. |
| `app/api/v1/endpoints/agent.py` | Nuevos endpoints `/voice-chat` y `/tts`. Gemini procesa audio. Google TTS genera respuesta en voz. Reintentos automáticos en 503. |
| `app/models/models.py` | `PROFESSIONAL_ACCEPTED` en enum `ConsultationStatus` |
| `app/services/payment.py` | `expires_at` usa `datetime.utcnow()` sin timezone |
| `app/core/config.py` | `GOOGLE_TTS_API_KEY`, `GOOGLE_TTS_VOICE`, `GOOGLE_TTS_LANGUAGE` |

### Frontend
| Archivo | Cambios |
|---------|---------|
| `src/lib/api.ts` | `acceptConsultation`, `rejectConsultation`, `cancel`, `simulatePayment`, `voiceChat`, `tts` |
| `src/lib/store.ts` | Interface `AgentMessage` con `audioBase64` e `isVoice` |
| `src/app/patient/agent/page.tsx` | Grabación de voz (mantener presionado). Reproductor audio estilo WhatsApp. Si texto → respuesta texto. Si voz → respuesta voz. |
| `src/app/patient/waiting-room/page.tsx` | Flujo médico primero. Timer UTC fix. Auto-detecta consulta activa. |
| `src/app/patient/dashboard/page.tsx` | Cancelar consulta con confirmación. `staleTime: 0`. |
| `src/app/patient/search/page.tsx` | Error 409 con banner amigable. |
| `src/app/professional/dashboard/page.tsx` | Timer 2 min. Botones Aceptar/Rechazar. |

---

## VPS de producción — Hostinger

| Dato | Valor |
|------|-------|
| IP | 187.77.255.178 |
| SO | Ubuntu 24.04 LTS |
| Acceso | `ssh root@187.77.255.178` |
| Dominio | medicbolivia.com |
| Archivos | `/var/www/medicbolivia/` |
| Logs backend | `/var/log/medicbolivia/` |

### Otros servicios en el mismo VPS
| Servicio | Puerto | Dominio |
|----------|--------|---------|
| n8n | 5678 | — |
| whatsapp-bot | 3000 | — |
| whatsapp-bot-camacho | 3001 | — |
| neuromisael.com | — | Django + Gunicorn en `/var/www/centro_terapias/` |

### Puertos usados por MedicBolivia en el VPS
| Servicio | Puerto |
|----------|--------|
| Backend FastAPI | 4000 |
| Frontend Next.js | 3002 |

### Comandos PM2 en el VPS
```bash
pm2 status
pm2 logs medicbolivia-backend
pm2 logs medicbolivia-frontend
pm2 restart medicbolivia-backend
pm2 restart medicbolivia-frontend
```

### Actualizar el código en producción
```bash
cd /var/www/medicbolivia
git pull

# Backend:
cd backend
source venv/bin/activate
pip install -r requirements.txt
pm2 restart medicbolivia-backend

# Frontend:
cd ../frontend
pnpm install
rm -rf .next && pnpm build
pm2 restart medicbolivia-frontend
```

### Crear tablas en la BD (si se reinstala)
```bash
cd /var/www/medicbolivia/backend
source venv/bin/activate
python3 -c "
import asyncio
from app.db.database import Base, engine
from app.models import models
async def crear():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('✅ Tablas creadas')
asyncio.run(crear())
"
```

### Crear usuario admin (si se reinstala)
```bash
cd /var/www/medicbolivia/backend
source venv/bin/activate
python3 -c "
import asyncio
from app.db.database import AsyncSessionLocal
from app.models.models import User, Admin, UserRole, UserStatus
from app.core.security import hash_password

async def crear_admin():
    async with AsyncSessionLocal() as db:
        user = User(
            phone='70000000',
            password_hash=hash_password('admin123456'),
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
            onboarding_completed=True
        )
        db.add(user)
        await db.flush()
        admin = Admin(user_id=user.id, name='Administrador')
        db.add(admin)
        await db.commit()
        print('✅ Admin creado')

asyncio.run(crear_admin())
"
```

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python 3.12 en producción) |
| Base de datos | PostgreSQL 18 (producción) / 15 (local) |
| Cache | Redis |
| Agente IA (texto) | Gemini 2.5 Flash — SDK google-genai (plan pago) |
| Agente IA (voz entrada) | Gemini 2.5 Flash multimodal (audio/webm) |
| Agente IA (voz salida) | Google Cloud TTS Neural2-C (masculina, es-US) |
| Servidor web | Nginx + PM2 |
| SSL | Let's Encrypt (Certbot) |
| Llamadas/SMS | Twilio (pendiente) |
| Documentos | AWS S3 (pendiente) |
| Deploy | VPS Hostinger ✅ |

---

## Estructura del proyecto

```
medicbolivia/
├── backend/
│   ├── app/
│   │   ├── agents/coordinator.py       # Agente Gemini 2.5 Flash
│   │   ├── api/v1/endpoints/
│   │   │   ├── admin.py
│   │   │   ├── agent.py                # Chat texto + voz + TTS
│   │   │   ├── auth.py
│   │   │   ├── consultations.py        # Flujo completo con voz
│   │   │   ├── prescriptions.py
│   │   │   ├── professionals.py
│   │   │   └── ratings.py
│   │   ├── core/
│   │   │   ├── config.py               # + GOOGLE_TTS_*
│   │   │   ├── dependencies.py
│   │   │   └── security.py
│   │   ├── db/database.py
│   │   ├── models/models.py
│   │   ├── schemas/schemas.py
│   │   └── services/
│   │       ├── payment.py
│   │       └── storage.py
│   ├── .env
│   └── requirements.txt
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── patient/
│       │   │   ├── dashboard/
│       │   │   ├── agent/              # Chat con voz estilo WhatsApp
│       │   │   ├── search/
│       │   │   ├── waiting-room/
│       │   │   ├── history/
│       │   │   └── video/
│       │   └── professional/
│       │       ├── dashboard/
│       │       ├── consultations/
│       │       ├── schedule/
│       │       └── profile/
│       ├── lib/
│       │   ├── api.ts                  # + voiceChat, tts
│       │   └── store.ts                # + audioBase64, isVoice en AgentMessage
│       └── types/index.ts
│
└── scripts/
    ├── deploy_vps.sh
    └── medicbolivia.nginx
```

---

## Modelos de base de datos

| Tabla | Descripción |
|-------|-------------|
| `users` | Usuarios base |
| `admins` | Perfil del administrador |
| `patients` | Perfil del paciente con historial médico |
| `professionals` | Perfil del profesional con precios y disponibilidad |
| `professional_docs` | Documentos de verificación |
| `schedules` | Horarios semanales |
| `consultations` | Estados: WAITING_PROFESSIONAL → WAITING_PAYMENT → PAYMENT_CONFIRMED → IN_PROGRESS → COMPLETED |
| `payments` | Pagos QR con escrow (15% plataforma, 85% profesional) |
| `earnings` | Ganancias del profesional |
| `prescriptions` | Recetas digitales con hash SHA-256 |
| `ratings` | Calificaciones 1-5 |
| `agent_logs` | Logs de interacciones con el agente |
| `audit_logs` | Auditoría de acciones administrativas |
| `derivations` | Derivaciones entre profesionales |

---

## Pendientes / próximas mejoras

- [x] ~~Integrar ElevenLabs para voz~~ → reemplazado por Google TTS Neural2 ✅
- [ ] Integrar Twilio para SMS de notificación al médico cuando llega solicitud
- [ ] Integrar AWS S3 para subida real de documentos
- [x] ~~Deploy en VPS Hostinger~~ ✅
- [ ] Videollamadas con Daily.co
- [ ] Notificaciones push en tiempo real (WebSockets o SSE)
- [ ] Login con Google (OAuth2) para pacientes
- [ ] App móvil React Native
- [ ] Integrar Tigo Money API para pagos QR reales en Bolivia
- [ ] Integrar Banco Unión API como segunda opción de pago
- [ ] Revisar y completar páginas: prescriptions, ratings, profile del profesional
- [ ] "Otra especialidad" en profesional de prueba — actualizar specialty en BD
- [ ] Llamadas telefónicas con Vapi.ai (agente de voz en tiempo real)
