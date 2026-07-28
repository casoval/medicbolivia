FROM ghcr.io/puppeteer/puppeteer:23.11.1

USER root
WORKDIR /app
RUN chown -R pptruser:pptruser /app
USER pptruser

COPY --chown=pptruser:pptruser package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=pptruser:pptruser . .

EXPOSE 4100

CMD ["node", "src/index.js"]