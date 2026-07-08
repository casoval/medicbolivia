#!/bin/bash
# run.sh — Arrancar el servidor de desarrollo

echo "🚀 Iniciando MedicBolivia Backend..."

# Verificar que existe el .env
if [ ! -f .env ]; then
    echo "❌ No existe el archivo .env"
    echo "   Copia .env.example → .env y llena los valores"
    exit 1
fi

# Arrancar con uvicorn en modo desarrollo
# --reload: reinicia automáticamente al guardar cambios
# --host 0.0.0.0: accesible desde la red local
uvicorn app.main:app --reload --host 0.0.0.0 --port 4000 --log-level info
