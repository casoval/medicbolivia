/**
 * whatsapp-service/src/index.js
 *
 * Microservicio Node que mantiene la sesión de WhatsApp usando whatsapp-web.js
 * (biblioteca NO OFICIAL — controla un Chromium headless real, ver advertencia
 * de riesgo de baneo en el README.md de esta carpeta) y hace de puente hacia
 * el backend FastAPI:
 *
 *   WhatsApp real  <──whatsapp-web.js──>  este servicio  <──HTTP interno──>  FastAPI
 *
 * MIGRADO desde Baileys (ver whatsapp-service/src/index.js.baileys-bak) porque
 * Baileys no resuelve de forma confiable los identificadores internos @lid que
 * WhatsApp está migrando globalmente (ver README.md). whatsapp-web.js sí los
 * resuelve, porque corre un navegador real contra web.whatsapp.com en vez de
 * reimplementar el protocolo desde cero.
 *
 * Endpoints que expone (todos protegidos con el header X-Internal-Secret,
 * NUNCA deben quedar accesibles desde internet — solo localhost / red
 * interna del VPS). Contrato IDÉNTICO a la versión anterior, no cambia nada
 * del lado de FastAPI ni del frontend:
 *   GET  /status   → estado de la conexión (CONNECTED / QR_PENDING / DOWN)
 *   GET  /qr       → PNG en base64 del QR pendiente de escanear (si aplica)
 *   POST /send     → { to, message } → manda un mensaje de texto
 *
 * Y llama hacia afuera:
 *   POST {BACKEND_URL}/api/v1/whatsapp/webhook/inbound
 *        cada vez que llega un mensaje nuevo al número vinculado.
 */
require('dotenv').config()

const express = require('express')
const qrcode = require('qrcode')
const pino = require('pino')
const { Client, LocalAuth } = require('whatsapp-web.js')

const PORT = process.env.PORT || 4100
const INTERNAL_SECRET = process.env.WHATSAPP_SERVICE_INTERNAL_SECRET || ''
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || './auth_info'
// Timeout del fetch hacia el backend. Sin esto, un backend lento/saturado
// puede dejar la promesa colgada indefinidamente — lección aprendida del
// mismo problema en whatsapp-bot (centro de terapias), julio 2026.
const BACKEND_TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS || 30000)

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const app = express()
app.use(express.json())

// ── Estado en memoria del microservicio ──────────────
let client = null
let connectionState = 'DOWN'   // DOWN | CONNECTING | QR_PENDING | CONNECTED
let latestQR = null            // string crudo del QR, se convierte a PNG on-demand

// ── Middleware de autenticación interna ──────────────
function requireInternalSecret(req, res, next) {
  if (!INTERNAL_SECRET) {
    logger.warn('WHATSAPP_SERVICE_INTERNAL_SECRET no está configurado — rechazando todo por seguridad')
    return res.status(500).json({ error: 'Servicio mal configurado: falta INTERNAL_SECRET' })
  }
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

// ── Normalización de números (igual criterio que el backend Python) ──
function toWhatsAppChatId(phone) {
  let clean = phone.trim().replace(/[^\d]/g, '')
  if (clean.length === 8) clean = `591${clean}`   // números bolivianos sin código de país
  return `${clean}@c.us`
}

// whatsapp-web.js entrega msg.from como "<numero>@c.us" en el caso normal.
// Cuando WhatsApp asignó @lid a un contacto, msg.from viene como
// "<idInterno>@lid" — en ese caso hay que resolver el número real vía
// msg.getContact(), que consulta el store completo de contactos que
// whatsapp-web.js sincroniza (a diferencia de Baileys, este SÍ lo resuelve
// de forma confiable en la práctica — validado en producción en el bot de
// centro_terapias desde julio 2026).
async function resolvePhoneFromMessage(msg) {
  if (!msg.from.includes('@lid')) {
    return msg.from.replace('@c.us', '')
  }
  try {
    const contact = await msg.getContact()
    if (contact?.number) return contact.number
    logger.warn(`No se pudo resolver @lid sin número real: ${msg.from}`)
    return null
  } catch (err) {
    logger.warn(`Error resolviendo @lid ${msg.from}: ${err.message}`)
    return null
  }
}

// ── Conexión a WhatsApp ───────────────────────────────
function connectToWhatsApp() {
  connectionState = 'CONNECTING'

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--js-flags=--max-old-space-size=512',
      ],
    },
  })

  client.on('qr', async (qr) => {
    latestQR = qr
    connectionState = 'QR_PENDING'
    logger.info('Nuevo QR generado — escanealo desde /admin (pestaña Bot de WhatsApp)')
  })

  client.on('ready', () => {
    connectionState = 'CONNECTED'
    latestQR = null
    logger.info('WhatsApp conectado correctamente')
  })

  client.on('disconnected', (reason) => {
    connectionState = 'DOWN'
    logger.warn(`Conexión cerrada (motivo: ${reason}). Reintentando...`)
    // whatsapp-web.js no reconecta solo tras un 'disconnected' real (a
    // diferencia de cortes de red transitorios, que maneja internamente) —
    // hay que recrear el cliente.
    try { client.destroy() } catch (_) { /* noop */ }
    setTimeout(connectToWhatsApp, 5000)
  })

  client.on('auth_failure', (msg) => {
    connectionState = 'DOWN'
    logger.error(`Fallo de autenticación: ${msg}. Puede requerir borrar ${AUTH_DIR} y re-escanear.`)
  })

  client.on('message', async (msg) => {
    try {
      if (msg.from.endsWith('@g.us')) return   // ignorar grupos por ahora
      if (msg.type !== 'chat') return          // por ahora solo texto; audio/imagen queda para fase 2

      const text = (msg.body || '').trim()
      if (!text) return

      const phone = await resolvePhoneFromMessage(msg)
      if (!phone) {
        logger.warn(
          `Mensaje entrante descartado: no se pudo resolver un número de teléfono real ` +
          `(from=${msg.from}). WhatsApp está migrando a IDs internos (@lid) — ver whatsapp-service/README.md.`
        )
        return
      }

      const contact = await msg.getContact().catch(() => null)
      const contactName = contact?.pushname || contact?.name || null

      await forwardInboundToBackend(phone, text, contactName)
    } catch (err) {
      logger.error(`Error procesando mensaje entrante: ${err.message}`)
    }
  })

  client.initialize().catch((err) => {
    connectionState = 'DOWN'
    logger.error(`Error al inicializar WhatsApp: ${err.message}`)
    setTimeout(connectToWhatsApp, 5000)
  })
}

async function forwardInboundToBackend(phone, message, contactName) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS)
  try {
    const resp = await fetch(`${BACKEND_URL}/api/v1/whatsapp/webhook/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, contact_name: contactName }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      logger.error(`Backend respondió ${resp.status} al reenviar mensaje entrante de ${phone}`)
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error(`Timeout (${BACKEND_TIMEOUT_MS}ms) esperando respuesta del backend para ${phone}`)
    } else {
      logger.error(`Error de red reenviando mensaje entrante al backend: ${err.message}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Endpoints HTTP ─────────────────────────────────────

app.get('/status', requireInternalSecret, (req, res) => {
  res.json({ connection_state: connectionState })
})

app.get('/qr', requireInternalSecret, async (req, res) => {
  if (!latestQR) {
    return res.json({ qr_available: false })
  }
  const qrPngBase64 = await qrcode.toDataURL(latestQR)
  res.json({ qr_available: true, qr_data_url: qrPngBase64 })
})

app.post('/send', requireInternalSecret, async (req, res) => {
  const { to, message } = req.body || {}
  if (!to || !message) {
    return res.status(400).json({ error: 'Faltan campos "to" y/o "message"' })
  }
  if (connectionState !== 'CONNECTED' || !client) {
    return res.status(503).json({ error: 'WhatsApp no está conectado en este momento' })
  }

  try {
    // Jitter pequeño (300–900ms) antes de mandar: ayuda a que las
    // respuestas no se vean instantáneas/uniformes en todos los casos.
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 600))
    await client.sendMessage(toWhatsAppChatId(to), message)
    res.json({ status: 'sent' })
  } catch (err) {
    logger.error(`Error enviando mensaje a ${to}: ${err.message}`)
    res.status(502).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  logger.info(`whatsapp-service escuchando en el puerto ${PORT}`)
  connectToWhatsApp()
})
