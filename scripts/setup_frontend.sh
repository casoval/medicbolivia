#!/bin/bash
# =============================================================
# setup_frontend.sh — Build y deploy del frontend Next.js
# =============================================================

set -e
PROJECT_DIR="/var/www/medicbolivia"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "=== Configurando frontend Next.js ==="

cd "$FRONTEND_DIR"

# ── Variables de entorno de producción ───────────────
echo "[1/4] Configurando variables de entorno..."
cat > "$FRONTEND_DIR/.env.production" << EOF
NEXT_PUBLIC_API_URL=https://medicbolivia.bo/api/v1
NEXT_PUBLIC_WS_URL=wss://medicbolivia.bo
EOF

# ── Instalar dependencias ─────────────────────────────
echo "[2/4] Instalando dependencias Node..."
pnpm install --frozen-lockfile

# ── Build de producción ───────────────────────────────
echo "[3/4] Construyendo Next.js para producción..."
pnpm build

# ── PM2 para el frontend ──────────────────────────────
echo "[4/4] Arrancando frontend con PM2..."
cat >> "$PROJECT_DIR/ecosystem.config.js" << 'EOF'
// Agregar al array apps:
// {
//   name: "medicbolivia-frontend",
//   cwd: "/var/www/medicbolivia/frontend",
//   script: "node_modules/.bin/next",
//   args: "start -p 3000",
//   env: { NODE_ENV: "production" },
//   error_file: "/var/log/medicbolivia/frontend-error.log",
//   out_file: "/var/log/medicbolivia/frontend-out.log",
// }
EOF

# Arrancar directamente
cd "$FRONTEND_DIR"
pm2 start npm --name "medicbolivia-frontend" -- start -- -p 3000
pm2 save

echo ""
echo "✅ Frontend arrancado en http://localhost:3000"
