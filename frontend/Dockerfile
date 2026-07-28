# frontend/Dockerfile
# Imagen de desarrollo: corre "next dev" con hot-reload, montando el código
# como volumen desde docker-compose. Next.js 16 / React 19 (ver package.json)
# necesitan Node 20+.
FROM node:20-slim

WORKDIR /app

# Habilita pnpm (el repo usa pnpm-lock.yaml / pnpm-workspace.yaml, no npm)
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["pnpm", "dev"]
