#!/bin/bash
# =============================================================
# deploy_vps.sh — Script de deploy completo para VPS Hostinger
# Ubuntu 22.04 LTS
# Ejecutar como root: bash deploy_vps.sh
# =============================================================

set -e  # Detener si hay error

echo "======================================"
echo "  MedicBolivia — Deploy en VPS"
echo "======================================"

# ── 1. Actualizar sistema ─────────────────────────────
echo "[1/9] Actualizando sistema..."
apt update -y && apt upgrade -y
apt install -y curl wget git unzip software-properties-common

# ── 2. Instalar Python 3.11 ───────────────────────────
echo "[2/9] Instalando Python 3.11..."
add-apt-repository ppa:deadsnakes/ppa -y
apt install -y python3.11 python3.11-venv python3.11-dev python3-pip
update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
echo "Python: $(python3 --version)"

# ── 3. Instalar Node.js 20 (para el frontend) ─────────
echo "[3/9] Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm pm2
echo "Node: $(node --version) | pnpm: $(pnpm --version)"

# ── 4. Instalar PostgreSQL 15 ─────────────────────────
echo "[4/9] Instalando PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Crear usuario y base de datos
sudo -u postgres psql <<EOF
CREATE USER medicbolivia WITH PASSWORD 'CAMBIA_ESTA_PASSWORD_AHORA';
CREATE DATABASE medicbolivia OWNER medicbolivia;
GRANT ALL PRIVILEGES ON DATABASE medicbolivia TO medicbolivia;
EOF
echo "PostgreSQL listo"

# ── 5. Instalar Redis ─────────────────────────────────
echo "[5/9] Instalando Redis..."
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server
echo "Redis listo"

# ── 6. Instalar Nginx ─────────────────────────────────
echo "[6/9] Instalando Nginx..."
apt install -y nginx
systemctl enable nginx

# ── 7. Instalar Certbot (SSL gratis) ──────────────────
echo "[7/9] Instalando Certbot..."
apt install -y certbot python3-certbot-nginx

# ── 8. Crear carpeta del proyecto ─────────────────────
echo "[8/9] Preparando directorio del proyecto..."
mkdir -p /var/www/medicbolivia
mkdir -p /var/log/medicbolivia
chown -R $SUDO_USER:$SUDO_USER /var/www/medicbolivia 2>/dev/null || true

echo "[9/9] ¡Instalación base completada!"
echo ""
echo "Próximos pasos manuales:"
echo "  1. Clonar el repositorio: git clone TU_REPO /var/www/medicbolivia"
echo "  2. Configurar .env del backend"
echo "  3. Ejecutar: bash /var/www/medicbolivia/scripts/setup_backend.sh"
echo "  4. Ejecutar: bash /var/www/medicbolivia/scripts/setup_frontend.sh"
echo "  5. Configurar Nginx: bash /var/www/medicbolivia/scripts/setup_nginx.sh"
echo "  6. SSL: certbot --nginx -d medicbolivia.bo -d www.medicbolivia.bo"
