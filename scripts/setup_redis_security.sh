#!/bin/bash
# =============================================================
# setup_redis_security.sh — Segunda instancia de Redis, dedicada
# solo a OTP de WhatsApp y bloqueo de login (AUTH_REDIS_URL).
#
# Corre en el puerto 6380, con su propia password, su propio
# systemd unit y sus propios dir/logfile/pidfile — separada del
# Redis compartido (puerto 6379, que hoy usa Celery como
# broker/backend). NO toca /etc/redis/redis.conf ni reinicia el
# servicio redis-server original.
#
# Se puede correr sola en un VPS ya desplegado, o queda llamada
# automáticamente al final de deploy_vps.sh para instalaciones
# nuevas desde cero.
#
# Ejecutar como root: bash setup_redis_security.sh
# =============================================================

set -e

echo "======================================"
echo "  MedicBolivia — Redis de seguridad (OTP/login)"
echo "======================================"

if [ ! -f /etc/redis/redis.conf ]; then
    echo "No se encontró /etc/redis/redis.conf — instalá Redis primero (deploy_vps.sh, paso 5)."
    exit 1
fi

CONF_PATH=/etc/redis/redis-security.conf
DATA_DIR=/var/lib/redis-security
LOG_FILE=/var/log/redis/redis-security.log
PID_FILE=/var/run/redis/redis-security.pid
PORT=6380

mkdir -p "$DATA_DIR"
chown redis:redis "$DATA_DIR"
mkdir -p /var/log/redis /var/run/redis
chown redis:redis /var/log/redis /var/run/redis

# Copia una conf nueva cada vez que corre el script (idempotente-ish):
# parte siempre de la conf base actual para heredar su tuning, y luego
# pisa encima solo los campos que necesitan ser distintos.
cp /etc/redis/redis.conf "$CONF_PATH"

REDIS_SECURITY_PASSWORD=$(openssl rand -base64 32)

sed -i "s/^# requirepass foobared/requirepass ${REDIS_SECURITY_PASSWORD}/" "$CONF_PATH"
sed -i "s/^requirepass .*/requirepass ${REDIS_SECURITY_PASSWORD}/" "$CONF_PATH"
sed -i "s/^bind .*/bind 127.0.0.1 -::1/" "$CONF_PATH"
sed -i "s/^port .*/port ${PORT}/" "$CONF_PATH"
sed -i "s|^dir .*|dir ${DATA_DIR}|" "$CONF_PATH"
sed -i "s|^logfile .*|logfile ${LOG_FILE}|" "$CONF_PATH"
sed -i "s|^pidfile .*|pidfile ${PID_FILE}|" "$CONF_PATH"

# Unit de systemd propio, clonado del de redis-server pero apuntando a
# la conf/puerto nuevos — así "systemctl restart redis-server" (el
# Redis compartido) nunca afecta a este.
cat > /etc/systemd/system/redis-security.service <<EOF
[Unit]
Description=Redis security instance (OTP WhatsApp / login lockout) — MedicBolivia
After=network.target

[Service]
Type=notify
ExecStart=/usr/bin/redis-server ${CONF_PATH}
ExecStop=/usr/bin/redis-cli -p ${PORT} -a ${REDIS_SECURITY_PASSWORD} shutdown
Restart=always
User=redis
Group=redis
RuntimeDirectory=redis
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable redis-security
systemctl restart redis-security

echo "Redis de seguridad listo en 127.0.0.1:${PORT} (systemd: redis-security)"
echo ""
echo "⚠️  GUARDÁ ESTA LÍNEA — la vas a necesitar para backend/.env:"
echo "AUTH_REDIS_URL=redis://:${REDIS_SECURITY_PASSWORD}@localhost:${PORT}"
echo "" >> /root/.medicbolivia_redis_url.txt
echo "AUTH_REDIS_URL=redis://:${REDIS_SECURITY_PASSWORD}@localhost:${PORT}" >> /root/.medicbolivia_redis_url.txt
echo "(También quedó guardada en /root/.medicbolivia_redis_url.txt por si la perdés de la pantalla)"
