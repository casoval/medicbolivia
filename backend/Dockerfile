# backend/Dockerfile
# Imagen para desarrollo local con docker-compose. Usa Python 3.12 (misma
# versión detectada en el venv actual de producción) sobre slim para
# mantener la imagen liviana.
FROM python:3.12-slim

WORKDIR /app

# Dependencias de sistema mínimas:
#   - build-essential: por si algún paquete de requirements.txt no trae
#     wheel precompilado para esta arquitectura (ej. en Apple Silicon/ARM).
#   - libpq-dev: headers de Postgres para psycopg2-binary en esos casos.
#   - postgresql-client-18: pg_dump para el backup automático a Gmail
#     (pestaña IA → Automatización). Versión 18 vía repo PGDG porque el
#     paquete "postgresql-client" de Debian trae una versión más vieja que
#     la del servidor de producción (18.3), y pg_dump no puede volcar un
#     servidor más nuevo que su propia versión.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    ca-certificates \
    gnupg \
    lsb-release \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list' \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

# Instala dependencias primero (capa cacheada aparte del código, así un
# cambio en app/ no invalida el pip install de nuevo)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["docker-entrypoint.sh"]
# --reload: para desarrollo. En producción real esto se reemplaza por
# --workers N sin --reload (ver docker-compose.prod.yml más adelante).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4000", "--reload"]
