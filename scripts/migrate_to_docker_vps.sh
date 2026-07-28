#!/bin/bash
# =============================================================
# scripts/migrate_to_docker_vps.sh
# Migra los procesos de PM2 (backend, celery-worker, celery-beat,
# whatsapp-service, frontend) a Docker, EN EL VPS.
#
# NO toca Postgres ni Redis — siguen corriendo nativos, con los mismos
# datos de siempre. Este script solo reemplaza cómo se ejecutan los
# procesos de la app, no dónde vive la base de datos.
#
# Ejecutar como root, parado en la raíz del repo (/var/www/medicbolivia):
#   bash scripts/migrate_to_docker_vps.sh
# =============================================================
set -e

PROJECT_DIR="/var/www/medicbolivia"
BACKUP_DIR="/root/medicbolivia_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "======================================"
echo "  MedicBolivia — Migración a Docker"
echo "======================================"
echo ""
echo "Este script va a:"
echo "  1. Hacer un backup de Postgres (por las dudas, no debería hacer falta)."
echo "  2. Instalar Docker si no está instalado."
echo "  3. Detener los procesos de PM2 (backend, celery, whatsapp, frontend)."
echo "  4. Construir y levantar los mismos procesos como contenedores Docker."
echo ""
echo "Postgres y Redis NO se tocan — siguen nativos, con los mismos datos."
echo "Si algo sale mal, PM2 sigue instalado: 'pm2 resurrect' revierte todo."
echo ""
read -p "¿Continuar? (s/N): " CONFIRM
if [[ "$CONFIRM" != "s" && "$CONFIRM" != "S" ]]; then
    echo "Cancelado."
    exit 0
fi

cd "$PROJECT_DIR"

# ── 1. Backup de seguridad de Postgres ────────────────
echo ""
echo "[1/5] Backup de seguridad de Postgres..."
mkdir -p "$BACKUP_DIR"
source backend/.env 2>/dev/null || true
# Extrae usuario/base del DATABASE_URL_SYNC del .env sin exponerlo en el
# historial de bash (evita loguear la password en texto plano).
sudo -u postgres pg_dump medicbolivia > "$BACKUP_DIR/medicbolivia_pre_docker_${TIMESTAMP}.sql"
echo "✅ Backup guardado en $BACKUP_DIR/medicbolivia_pre_docker_${TIMESTAMP}.sql"

# ── 2. Instalar Docker si falta ───────────────────────
echo ""
echo "[2/5] Verificando Docker..."
if ! command -v docker &> /dev/null; then
    echo "Docker no está instalado — instalando (script oficial de Docker)..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
else
    echo "✅ Docker ya está instalado ($(docker --version))"
fi

if ! docker compose version &> /dev/null; then
    echo "❌ 'docker compose' (plugin v2) no está disponible. Instalá docker-compose-plugin y volvé a correr este script."
    exit 1
fi

# ── 3. Detener PM2 (sin borrar la config, para poder revertir) ───
echo ""
echo "[3/5] Deteniendo procesos de PM2..."
pm2 stop medicbolivia-backend medicbolivia-celery-worker medicbolivia-celery-beat medicbolivia-whatsapp-service medicbolivia-frontend 2>/dev/null || true
echo "✅ PM2 detenido (la config queda guardada — 'pm2 resurrect' para volver atrás)"

# ── 4. Levantar los contenedores ──────────────────────
echo ""
echo "[4/5] Construyendo y levantando contenedores Docker..."
docker compose -f docker-compose.prod.yml up -d --build

# ── 5. Verificación básica ────────────────────────────
echo ""
echo "[5/5] Esperando a que el backend responda..."
sleep 8
if curl -sf http://localhost:4000/health > /dev/null; then
    echo "✅ Backend responde en :4000"
else
    echo "⚠️  El backend todavía no responde en :4000 — revisá los logs:"
    echo "    docker compose -f docker-compose.prod.yml logs backend"
fi

echo ""
echo "======================================"
echo "  Migración completada"
echo "======================================"
echo "Ver logs:      docker compose -f docker-compose.prod.yml logs -f"
echo "Estado:        docker compose -f docker-compose.prod.yml ps"
echo ""
echo "Si algo falló y querés volver a PM2 de inmediato:"
echo "  docker compose -f docker-compose.prod.yml down"
echo "  pm2 resurrect"
