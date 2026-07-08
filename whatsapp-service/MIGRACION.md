# Migración whatsapp-service: Baileys → whatsapp-web.js

## Por qué
Baileys no resuelve de forma confiable los identificadores `@lid` que
WhatsApp está migrando globalmente — confirmado con logs reales donde
`signalRepository.lidMapping` seguía sin poblarse. `whatsapp-web.js` sí lo
resuelve (vía `msg.getContact()`), validado en producción en
`whatsapp-bot` de centro_terapias con decenas de resoluciones exitosas.

## Antes de empezar

1. **Backup completo de la sesión actual de Baileys** — no se puede migrar
   la sesión entre librerías, así que vas a tener que volver a escanear
   el QR con el número real. Avisá al equipo antes de hacerlo (el bot
   quedará sin recibir mensajes durante el escaneo, unos minutos).

2. Confirmá cuánta RAM libre hay antes de sumar un tercer Chromium:
   ```bash
   free -h
   ```
   Con terapias corriendo 2 instancias, debería haber margen — pero
   confirmalo con el número real del momento.

## Pasos

```bash
# 1. Ir a la carpeta del servicio actual
cd /var/www/medicbolivia/whatsapp-service

# 2. Backup completo (código + sesión vieja, por si hay que revertir)
cp -r . ../whatsapp-service-baileys-bak-$(date +%Y%m%d-%H%M%S)

# 3. Detener el proceso actual
pm2 stop medicbolivia-whatsapp   # o el nombre que tenga en tu pm2 list

# 4. Reemplazar src/index.js y package.json con los archivos nuevos
#    (subir index.js, package.json, .env.example de este entregable)

# 5. Instalar las nuevas dependencias (Puppeteer va a descargar Chromium,
#    puede tardar un par de minutos)
npm install

# 6. Verificar sintaxis antes de arrancar
node --check src/index.js

# 7. Copiar el .env viejo (mismo WHATSAPP_SERVICE_INTERNAL_SECRET,
#    BACKEND_URL, etc. — no cambian) y agregar BACKEND_TIMEOUT_MS si querés
#    ajustarlo del default de 30000ms

# 8. Actualizar ecosystem.config.js agregando cron_restart
#    (ver ecosystem.config.snippet.js de este entregable)

# 9. Arrancar con PM2
pm2 reload ecosystem.config.js
pm2 save

# 10. Ver logs y escanear el QR nuevo desde el panel admin
pm2 logs medicbolivia-whatsapp --lines 30
```

## Verificación post-migración

- [ ] `pm2 describe medicbolivia-whatsapp` muestra `cron restart: 0 7 * * *`
- [ ] `GET /status` (con el header `X-Internal-Secret`) devuelve `CONNECTED`
      después de escanear el QR
- [ ] Mandar un mensaje de prueba desde un número con `@lid` conocido (el
      mismo que usaste para diagnosticar el problema original) y confirmar
      en los logs: `ok @lid resuelto: ... a <numero>` en vez de
      `Mensaje entrante descartado`
- [ ] `POST /send` sigue funcionando igual (probar un envío de prueba)
- [ ] Monitorear RAM las primeras 24-48h (`free -h`, `ps aux --sort=-%mem`)
      por si el mismo leak que vimos en terapias aparece acá también —
      el `cron_restart` ya está puesto de entrada como mitigación, pero
      vale la pena confirmar que no se dispara antes de las 3am.

## Rollback si algo sale mal

```bash
pm2 stop medicbolivia-whatsapp
cd /var/www/medicbolivia
rm -rf whatsapp-service
mv whatsapp-service-baileys-bak-<fecha> whatsapp-service
cd whatsapp-service
pm2 reload ecosystem.config.js
```
La sesión vieja de Baileys en el backup debería reconectar sin pedir QR de
nuevo (asumiendo que no pasó tanto tiempo que WhatsApp la invalidó).
