#!/bin/bash
# =============================================================
# scripts/deploy_pull.sh
# Deploy rápido: trae las imágenes YA construidas por GitHub Actions
# (.github/workflows/build-push.yml) desde GHCR, en vez de compilarlas
# en el VPS. Reemplaza al viejo:
#   docker compose -f docker-compose.prod.yml up -d --build backend frontend
#
# Requisito: que el push a main ya haya terminado de correr en GitHub
# Actions (ver pestaña Actions del repo) antes de correr esto — si no,
# vas a traer la imagen del commit anterior, no la última.
#
# Uso (en el VPS, parado en /var/www/medicbolivia):
#   bash scripts/deploy_pull.sh
# =============================================================
set -e

cd "$(dirname "$0")/.."

echo "[1/3] Trayendo el código más reciente..."
git pull origin main

echo "[2/3] Descargando imágenes ya compiladas desde GHCR..."
docker compose -f docker-compose.prod.yml pull backend frontend

echo "[3/3] Recreando contenedores con las imágenes nuevas..."
docker compose -f docker-compose.prod.yml up -d backend celery-worker celery-beat frontend

echo ""
echo "✅ Listo. Verificá el estado con:"
echo "   docker compose -f docker-compose.prod.yml ps"
