#!/bin/bash
# =============================================================
# setup_backend.sh — Configura y arranca el backend FastAPI
# Ejecutar desde /var/www/medicbolivia/
# =============================================================

set -e
PROJECT_DIR="/var/www/medicbolivia"
BACKEND_DIR="$PROJECT_DIR/backend"
LOG_DIR="/var/log/medicbolivia"

echo "=== Configurando backend FastAPI ==="

# ── Entorno virtual Python ────────────────────────────
echo "[1/5] Creando entorno virtual..."
cd "$BACKEND_DIR"
python3.11 -m venv venv
source venv/bin/activate

# ── Instalar dependencias ─────────────────────────────
echo "[2/5] Instalando dependencias Python..."
pip install --upgrade pip
pip install -r requirements.txt

# ── Verificar .env ────────────────────────────────────
echo "[3/5] Verificando configuración..."
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo "❌ ERROR: Falta el archivo .env"
    echo "   Copia .env.example → .env y llena los valores"
    exit 1
fi
echo "✅ .env encontrado"

# ── Crear tablas en la BD ─────────────────────────────
echo "[4/5] Inicializando base de datos..."
cd "$BACKEND_DIR"
source venv/bin/activate
# En producción usamos alembic, en primera vez create_all
python3 -c "
import asyncio
from app.db.database import create_all_tables
asyncio.run(create_all_tables())
print('Base de datos lista')
"

# ── Configurar PM2 ────────────────────────────────────
echo "[5/5] Configurando PM2 para el backend..."
cat > "$PROJECT_DIR/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [
    {
      name: "medicbolivia-backend",
      cwd: "/var/www/medicbolivia/backend",
      interpreter: "/var/www/medicbolivia/backend/venv/bin/python3",
      script: "/var/www/medicbolivia/backend/venv/bin/uvicorn",
      args: "app.main:app --host 0.0.0.0 --port 4000 --workers 2",
      env: {
        NODE_ENV: "production",
        ENVIRONMENT: "production"
      },
      error_file: "/var/log/medicbolivia/backend-error.log",
      out_file: "/var/log/medicbolivia/backend-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      restart_delay: 3000,
      max_restarts: 10
    }
  ]
}
EOF

pm2 start ecosystem.config.js --only medicbolivia-backend
pm2 save
pm2 startup

echo ""
echo "✅ Backend arrancado en http://localhost:4000"
echo "   Ver logs: pm2 logs medicbolivia-backend"
echo "   Reiniciar: pm2 restart medicbolivia-backend"
