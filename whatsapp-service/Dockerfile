# whatsapp-service/Dockerfile
# whatsapp-web.js controla un Chromium real vía Puppeteer (ver comentario en
# src/index.js) — no es un cliente HTTP liviano, así que la imagen necesita
# Chromium instalado. Usamos la imagen que Puppeteer publica con todas las
# dependencias del sistema ya resueltas, en vez de instalarlas a mano
# (evita el clásico problema de libnss3/libatk faltantes en slim).
FROM ghcr.io/puppeteer/puppeteer:23.11.1

# La imagen de puppeteer corre como usuario no-root "pptruser" — respetamos
# eso en vez de forzar root.
USER root
WORKDIR /app
RUN chown -R pptruser:pptruser /app
USER pptruser

# Le dice a whatsapp-web.js que use el Chromium YA incluido en esta imagen
# en vez de que Puppeteer intente descargar el suyo propio en el install.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

COPY --chown=pptruser:pptruser package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=pptruser:pptruser . .

EXPOSE 4100

CMD ["node", "src/index.js"]
