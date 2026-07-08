# whatsapp-service

Microservicio Node que mantiene la sesión de WhatsApp usando **Baileys**
(biblioteca **no oficial**) y conecta ese número real con el backend
FastAPI de MedicBolivia.

## ⚠️ Advertencia importante

Baileys automatiza WhatsApp por fuera de la API oficial de Meta. Esto significa:

- **Riesgo de baneo del número** si Meta detecta patrones automatizados
  (respuestas instantáneas y uniformes, volumen alto en poco tiempo,
  mensajes idénticos a muchos contactos, etc.).
- **Recomendación fuerte**: vincular primero un número secundario de
  pruebas (una SIM barata o un número virtual) y solo pasar al número
  real de producción cuando el flujo esté validado por unos días.
- Evitar mandar el mismo mensaje exacto a muchos contactos en poco
  tiempo — el código ya agrega un pequeño *jitter* (300–900ms) antes de
  cada envío para no verse 100% mecánico, pero no es una garantía.
- Esta biblioteca no tiene el respaldo ni el SLA de la Cloud API oficial:
  puede requerir volver a escanear el QR si WhatsApp fuerza un cierre de
  sesión.

## Instalación

```bash
cd whatsapp-service
npm install
cp .env.example .env
# editar .env: WHATSAPP_SERVICE_INTERNAL_SECRET debe ser el MISMO valor
# que WHATSAPP_SERVICE_INTERNAL_SECRET en backend/.env
npm start
```

## Vincular el número

1. Al arrancar por primera vez, el servicio genera un QR (se ve en los
   logs como "Nuevo QR generado").
2. Desde el panel admin → IA → pestaña "Bot de WhatsApp", el botón
   "Ver QR" llama a `GET /qr` de este servicio (a través del backend) y
   lo muestra como imagen.
3. Escanear con WhatsApp → Dispositivos vinculados → Vincular dispositivo,
   desde el número que se quiere usar.
4. La sesión queda guardada en la carpeta `auth_info/` (definida por
   `WHATSAPP_AUTH_DIR`) — **no se debe subir a git ni compartir**, quien
   tenga esos archivos puede operar el WhatsApp vinculado sin volver a
   escanear nada.

## Producción (PM2)

Ver la entrada agregada en `../ecosystem.config.js`. Corre como un
proceso separado del backend Python, en la misma máquina (se comunican
por `localhost`, nunca se expone este puerto a internet).

## Endpoints internos

Todos requieren el header `X-Internal-Secret` con el valor de
`WHATSAPP_SERVICE_INTERNAL_SECRET`.

| Método | Ruta      | Uso                                          |
|--------|-----------|-----------------------------------------------|
| GET    | `/status` | Estado de conexión (`CONNECTED`/`QR_PENDING`/`DOWN`) |
| GET    | `/qr`     | QR pendiente en base64 (si hay uno)          |
| POST   | `/send`   | `{ "to": "59169625434", "message": "..." }`  |

Los mensajes entrantes se reenvían automáticamente a
`POST {BACKEND_URL}/api/v1/whatsapp/webhook/inbound`.
