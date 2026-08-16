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
// Si `phone` ya viene como un JID completo (caso @lid — el backend lo
// guarda tal cual en WhatsAppConversation.phone cuando no hay número real
// resoluble, ver app/models/models.py), se manda directo: WhatsApp permite
// enviar a ese JID sin necesitar el número humano detrás. Si es un número
// normal, se arma el chat id como siempre.
function toWhatsAppChatId(phone) {
  if (/@(c\.us|lid|g\.us)$/.test(phone)) {
    return phone
  }
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

// Incidente real (ago-2026): además del caso de arriba, hay contactos con
// la privacidad de número activada en WhatsApp para los que NI SIQUIERA
// getContact() devuelve un número real — la propia librería entrega de
// vuelta el mismo ID interno largo (contact.number === rawDigits). Antes
// esto se trataba igual que "no se pudo resolver" y se descartaba el
// mensaje sin más: en producción se confirmaron decenas de mensajes de
// pacientes/profesionales/público perdidos así a lo largo de más de una
// semana, sin ningún error visible más que el 422 en los logs de este
// servicio. Ahora resolvePhoneFromMessage() ya NO decide si el mensaje se
// descarta — siempre devuelve el mejor teléfono que pudo resolver (o null
// si no hay ninguno), y quien llama (client.on('message')) manda ADEMÁS
// el JID crudo (msg.from) como respaldo, para que el backend pueda seguir
// la conversación aunque no exista un número real detrás.
async function resolvePhoneFromMessage(msg) {
  const rawDigits = msg.from.replace('@c.us', '').replace('@lid', '')
  const looksLikeInternalId = msg.from.includes('@lid') || rawDigits.length > MAX_PLAUSIBLE_PHONE_DIGITS

  if (!looksLikeInternalId) {
    return rawDigits
  }
  try {
    const contact = await msg.getContact()
    // contact.number a veces es el mismo ID interno reenviado tal cual
    // (contacto con privacidad de número activada) — eso NO es un
    // teléfono real, así que no lo devolvemos como si lo fuera.
    if (contact?.number && contact.number.length <= MAX_PLAUSIBLE_PHONE_DIGITS) {
      return contact.number
    }
    logger.warn(
      `No se pudo resolver un número real para el ID interno: ${msg.from} ` +
      `(contacto con privacidad de número activada probablemente) — se usará el JID crudo como respaldo`
    )
    return null
  } catch (err) {
    logger.warn(`Error resolviendo ID interno ${msg.from}: ${err.message} — se usará el JID crudo como respaldo`)
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

      // `phone` puede venir null (contacto con privacidad de número
      // activada, o error resolviendo) — ya NO se descarta el mensaje por
      // eso: se manda igual el JID crudo (msg.from) como respaldo, y el
      // backend decide qué hacer (ver receive_inbound_message en
      // whatsapp.py). Antes esto se perdía en silencio — ver comentario
      // en resolvePhoneFromMessage.
      const phone = await resolvePhoneFromMessage(msg)
      if (!phone) {
        logger.info(
          `Mensaje entrante sin número real resoluble (from=${msg.from}) — se reenvía con el ` +
          `JID crudo como respaldo, el backend lo maneja como contacto @lid.`
        )
      }

      const contact = await msg.getContact().catch(() => null)
      const contactName = contact?.pushname || null

      await forwardInboundToBackend(phone, msg.from, text, contactName)
    } catch (err) {
      logger.error(`Error procesando mensaje entrante: ${err.message}`)
    }
  })

  client.initialize().catch((err) => {
    clearConnectWatchdog()
    connectionState = 'DOWN'
    logger.error(`Error al inicializar WhatsApp: ${err.message}`)
    try { client?.destroy() } catch (_) { /* noop */ }
    setTimeout(connectToWhatsApp, 5000)
  })

}
// `phone` puede ser null (ver resolvePhoneFromMessage) — `whatsappId` es
// el JID crudo (msg.from) y SIEMPRE viene presente, es el respaldo que
// usa el backend cuando no hay un número real resoluble (caso @lid).
async function forwardInboundToBackend(phone, whatsappId, message, contactName) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS)
  try {
    const resp = await fetch(`${BACKEND_URL}/api/v1/whatsapp/webhook/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
      body: JSON.stringify({ phone, whatsapp_id: whatsappId, message, contact_name: contactName }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      logger.error(`Backend respondió ${resp.status} al reenviar mensaje entrante de ${phone || whatsappId}`)
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

// Sin autenticación a propósito — es solo para que Docker (healthcheck)
// y quien sea pueda confirmar que el proceso Node/Express está vivo y
// respondiendo. NO depende de si WhatsApp está conectado en este
// instante: una desconexión temporal ya la maneja la reconexión propia
// de más abajo (disconnected/auth_failure/watchdog), y si este endpoint
// dependiera de connectionState==='connected', Docker podría reiniciar
// el contenedor en medio de una reconexión legítima en curso — pisando
// el trabajo que la app ya está haciendo sola, en vez de ayudar.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

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
