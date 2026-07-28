#!/bin/bash
# backend/docker-entrypoint.sh
# Corre antes de CUALQUIER comando de este contenedor (uvicorn, celery
# worker, celery beat) — todos comparten esta misma imagen. Se encarga de:
#   1. Esperar a que Postgres acepte conexiones (docker-compose "depends_on"
#      solo espera a que el contenedor arranque, no a que la BD ya esté
#      lista para recibir queries).
#   2. Correr "alembic upgrade head" — SOLO si este proceso es el backend
#      (uvicorn). Los workers de Celery no deben pelear por aplicar
#      migraciones al mismo tiempo que el backend arranca.
set -e

host="${POSTGRES_HOST:-postgres}"
port="${POSTGRES_PORT:-5432}"

echo "⏳ Esperando a Postgres en ${host}:${port}..."
until python -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1)
try:
    s.connect(('${host}', ${port}))
except Exception:
    sys.exit(1)
"; do
  sleep 1
done
echo "✅ Postgres disponible."

# Solo el proceso de uvicorn corre las migraciones al arrancar — evita que
# el worker y el beat de Celery, que arrancan casi al mismo tiempo, intenten
# aplicar "alembic upgrade head" en paralelo.
if [[ "$1" == "uvicorn" ]]; then
  echo "📦 Aplicando migraciones (alembic upgrade head)..."
  alembic upgrade head
fi

exec "$@"
