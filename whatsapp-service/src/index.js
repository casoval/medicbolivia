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
 *   POST /send-document → { to, filename, caption, base64, mimetype } →
 *        manda un archivo adjunto (ej. PDF de invitación, ver
 *        app/services/invitation_pdf.py del backend)
 *
 * Y llama hacia afuera:
 *   POST {BACKEND_URL}/api/v1/whatsapp/webhook/inbound
 *        cada vez que llega un mensaje nuevo al número vinculado.
 */
require('dotenv').config()

const express = require('express')
const qrcode = require('qrcode')
const pino = require('pino')
const crypto = require('crypto')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')

const PORT = process.env.PORT || 4100
const INTERNAL_SECRET = process.env.WHATSAPP_SERVICE_INTERNAL_SECRET || ''
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || './auth_info'
// Timeout del fetch hacia el backend. Sin esto, un backend lento/saturado
// puede dejar la promesa colgada indefinidamente — lección aprendida del
// mismo problema en whatsapp-bot (centro de terapias), julio 2026.
const BACKEND_TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS || 30000)
// Watchdog de conexión: si connectToWhatsApp() se queda en CONNECTING sin
// pasar a QR_PENDING ni CONNECTED dentro de este tiempo, se asume que
// Puppeteer/Chromium quedó colgado por dentro (ver incidente real del
// 16-jul-2026: la sesión guardada en AUTH_DIR quedó corrupta tras un
// "detached frame", y el proceso se quedaba en CONNECTING indefinidamente
// sin tirar ningún error — client.initialize() nunca resolvía ni
// rechazaba). Sin este watchdog, la única forma de notarlo era mirando el
// panel admin a mano. Un connect sano (con o sin sesión guardada) tarda
// bien por debajo de 90s en los logs reales de este proyecto.
const CONNECT_WATCHDOG_MS = Number(process.env.WHATSAPP_CONNECT_TIMEOUT_MS || 90000)

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const app = express()
// Límite subido de 100kb (default de Express) a 15mb: /send-document
// manda archivos adjuntos en base64 (ver invitation_pdf.py), que con la
// codificación base64 pesan ~33% más que el archivo original.
app.use(express.json({ limit: '15mb' }))

// ── Estado en memoria del microservicio ──────────────
let client = null
let connectionState = 'DOWN'   // DOWN | CONNECTING | QR_PENDING | CONNECTED
let latestQR = null            // string crudo del QR, se convierte a PNG on-demand
let connectWatchdogTimer = null

// Compara dos strings en tiempo constante (crypto.timingSafeEqual exige
// buffers del mismo largo, así que primero se hashean a un largo fijo con
// SHA-256 — evita tanto la fuga por tiempo de comparación como la fuga por
// largo del secreto real).
function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest()
  const hashB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

// ── Middleware de autenticación interna ──────────────
function requireInternalSecret(req, res, next) {
  if (!INTERNAL_SECRET) {
    logger.warn('WHATSAPP_SERVICE_INTERNAL_SECRET no está configurado — rechazando todo por seguridad')
    return res.status(500).json({ error: 'Servicio mal configurado: falta INTERNAL_SECRET' })
  }
  const provided = req.headers['x-internal-secret']
  if (typeof provided !== 'string' || !safeEqual(provided, INTERNAL_SECRET)) {
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
//
// Incidente real (16-jul-2026): 2 mensajes entrantes llegaron como
// "<15 dígitos>@c.us" — un ID interno tipo @lid, pero SIN el sufijo
// literal "@lid" (WhatsApp lo mandó bajo el dominio @c.us de todas
// formas). El chequeo original de solo `.includes('@lid')` no lo
// detectó, así que nunca se intentó resolver el número real: se
// reenvió tal cual al backend, que lo rechazó con 422 (correctamente,
// ver whatsapp.py::receive_inbound_message) — pero el mensaje real del
// paciente/profesional se perdió en el camino. Por eso ahora también
// se dispara la resolución vía getContact() cuando el ID es
// implausiblemente largo para ser un teléfono real, sin importar el
// sufijo. Ningún número boliviano supera los 11 dígitos (591 + 8); el
// límite de 13 deja margen para otros países sin colar los @lid de
// 14-15+ dígitos que se han visto en la práctica.
const MAX_PLAUSIBLE_PHONE_DIGITS = 13

async function resolvePhoneFromMessage(msg) {
  const rawDigits = msg.from.replace('@c.us', '').replace('@lid', '')
  const looksLikeInternalId = msg.from.includes('@lid') || rawDigits.length > MAX_PLAUSIBLE_PHONE_DIGITS

  if (!looksLikeInternalId) {
    return rawDigits
  }
  try {
    const contact = await msg.getContact()
    if (contact?.number) return contact.number
    logger.warn(`No se pudo resolver un número real para el ID interno: ${msg.from}`)
    return null
  } catch (err) {
    logger.warn(`Error resolviendo ID interno ${msg.from}: ${err.message}`)
    return null
  }
}

// ── Conexión a WhatsApp ───────────────────────────────
function clearConnectWatchdog() {
  if (connectWatchdogTimer) {
    clearTimeout(connectWatchdogTimer)
    connectWatchdogTimer = null
  }
}

function connectToWhatsApp() {
  connectionState = 'CONNECTING'

  // Si en CONNECT_WATCHDOG_MS no llegamos a QR_PENDING ni CONNECTED,
  // Chromium quedó colgado por dentro (sesión corrupta, recurso agotado,
  // etc.) sin que client.initialize() nunca resuelva ni rechace — por
  // eso ningún otro manejador de error de acá abajo se dispara solo.
  // Forzamos destroy + reconexión igual que en los otros casos de falla.
  clearConnectWatchdog()
  connectWatchdogTimer = setTimeout(() => {
    if (connectionState === 'CONNECTING') {
      logger.warn(
        `Watchdog: sigue en CONNECTING después de ${CONNECT_WATCHDOG_MS / 1000}s ` +
        `sin llegar a QR_PENDING ni CONNECTED — Chromium probablemente colgado por ` +
        `dentro. Forzando destroy + reconexión.`
      )
      connectionState = 'DOWN'
      try { client?.destroy() } catch (_) { /* noop */ }
      setTimeout(connectToWhatsApp, 2000)
    }
  }, CONNECT_WATCHDOG_MS)

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
    clearConnectWatchdog()
    latestQR = qr
    connectionState = 'QR_PENDING'
    logger.info('Nuevo QR generado — escanealo desde /admin (pestaña Bot de WhatsApp)')
  })

  client.on('ready', () => {
    clearConnectWatchdog()
    connectionState = 'CONNECTED'
    latestQR = null
    logger.info('WhatsApp conectado correctamente')
  })

  client.on('disconnected', (reason) => {
    clearConnectWatchdog()
    connectionState = 'DOWN'
    logger.warn(`Conexión cerrada (motivo: ${reason}). Reintentando...`)
    // whatsapp-web.js no reconecta solo tras un 'disconnected' real (a
    // diferencia de cortes de red transitorios, que maneja internamente) —
    // hay que recrear el cliente.
    try { client.destroy() } catch (_) { /* noop */ }
    setTimeout(connectToWhatsApp, 5000)
  })

  client.on('auth_failure', (msg) => {
    clearConnectWatchdog()
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
          `(from=${msg.from}). WhatsApp asigna IDs internos (@lid, o IDs largos bajo @c.us) ` +
          `que a veces no traen el número real vinculado — ver whatsapp-service/README.md.`
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
    clearConnectWatchdog()
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

// Manejo de errores compartido entre /send y /send-document: ambos usan
// el mismo client.sendMessage() por debajo, así que fallan de la misma
// forma (frame de Puppeteer muerto, etc.) — ver comentario detallado
// más abajo, se conserva íntegro para no perder el contexto del fix.
function _handleSendError(err, to, res) {
  logger.error(`Error enviando mensaje a ${to}: ${err.message}`)

  // whatsapp-web.js a veces deja el cliente "CONNECTED" en el estado
  // interno aunque la página de Puppeteer ya haya muerto (frame
  // detached / target closed) — el evento 'disconnected' no siempre
  // se dispara en ese caso, así que el servicio queda "zombie": acepta
  // pedidos, responde 503... no, en realidad ni eso: pasa el chequeo
  // de connectionState !== 'CONNECTED' porque el estado sigue diciendo
  // CONNECTED, y el intento de mandar explota siempre igual. Si
  // detectamos ese patrón de error puntual, forzamos la reconexión acá
  // mismo en vez de esperar a que alguien reinicie el proceso a mano.
  const isDeadFrame = /detached frame/i.test(err.message) || /target closed/i.test(err.message)
  if (isDeadFrame && connectionState === 'CONNECTED') {
    logger.warn('Frame de Puppeteer muerto — forzando reconexión del cliente de WhatsApp')
    connectionState = 'DOWN'
    try { client.destroy().catch(() => {}) } catch (_) { /* noop */ }
    setTimeout(connectToWhatsApp, 2000)
  }

  res.status(502).json({ error: err.message })
}

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
    _handleSendError(err, to, res)
  }
})

// POST /send-document → { to, filename, caption, base64, mimetype }
// Manda un archivo adjunto (usado hoy para el PDF de invitación formal
// de app/services/invitation_pdf.py, ver
// app/api/v1/endpoints/admin.py::invite_doctor_lead). `caption` es el
// texto que acompaña al archivo, igual que cuando un humano adjunta un
// PDF en WhatsApp y le escribe un mensaje encima.
app.post('/send-document', requireInternalSecret, async (req, res) => {
  const { to, filename, caption, base64, mimetype } = req.body || {}
  if (!to || !filename || !base64) {
    return res.status(400).json({ error: 'Faltan campos "to", "filename" y/o "base64"' })
  }
  if (connectionState !== 'CONNECTED' || !client) {
    return res.status(503).json({ error: 'WhatsApp no está conectado en este momento' })
  }

  try {
    const media = new MessageMedia(mimetype || 'application/pdf', base64, filename)
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 600))
    await client.sendMessage(toWhatsAppChatId(to), media, { caption: caption || undefined })
    res.json({ status: 'sent' })
  } catch (err) {
    _handleSendError(err, to, res)
  }
})

app.listen(PORT, () => {
  logger.info(`whatsapp-service escuchando en el puerto ${PORT}`)
  connectToWhatsApp()
})
