module.exports = {
  apps: [
    {
      name: "medicbolivia-backend",
      cwd: "/var/www/medicbolivia/backend",
      interpreter: "/var/www/medicbolivia/backend/venv/bin/python3",
      script: "/var/www/medicbolivia/backend/venv/bin/uvicorn",
      args: "app.main:app --host 0.0.0.0 --port 4000 --workers 2",
      env: { ENVIRONMENT: "production" },
      error_file: "/var/log/medicbolivia/backend-error.log",
      out_file: "/var/log/medicbolivia/backend-out.log",
    },
    {
      // Ejecuta las tareas encoladas: envío de WhatsApp, recordatorios,
      // backups. Sin este proceso, notify_user() y los CRUD del panel IA
      // encolan tareas que nunca se ejecutan.
      name: "medicbolivia-celery-worker",
      cwd: "/var/www/medicbolivia/backend",
      interpreter: "/var/www/medicbolivia/backend/venv/bin/python3",
      script: "/var/www/medicbolivia/backend/venv/bin/celery",
      args: "-A app.core.celery_app worker --loglevel=info --concurrency=4",
      env: { ENVIRONMENT: "production" },
      error_file: "/var/log/medicbolivia/celery-worker-error.log",
      out_file: "/var/log/medicbolivia/celery-worker-out.log",
    },
    {
      // Dispara las tareas programadas: chequeo de recordatorios de citas
      // cada 60s y de backups de BD cada hora (ver beat_schedule en
      // app/core/celery_app.py). Un solo beat, nunca más de uno corriendo
      // a la vez o se duplican los envíos.
      name: "medicbolivia-celery-beat",
      cwd: "/var/www/medicbolivia/backend",
      interpreter: "/var/www/medicbolivia/backend/venv/bin/python3",
      script: "/var/www/medicbolivia/backend/venv/bin/celery",
      args: "-A app.core.celery_app beat --loglevel=info",
      env: { ENVIRONMENT: "production" },
      error_file: "/var/log/medicbolivia/celery-beat-error.log",
      out_file: "/var/log/medicbolivia/celery-beat-out.log",
    },
    {
      // Microservicio Node/whatsapp-web.js que mantiene la sesión de
      // WhatsApp. Migrado desde Baileys en julio 2026 — ver
      // whatsapp-service/MIGRACION.md. Ver whatsapp-service/README.md para
      // la advertencia sobre el riesgo de baneo por ser una biblioteca no
      // oficial.
      // cron_restart: mitigación contra el leak de memoria de Chromium
      // observado en el mismo patrón de bot en centro_terapias — reinicia
      // solo a las 3am hora Bolivia (7am UTC, servidor en UTC).
      name: "medicbolivia-whatsapp-service",
      cwd: "/var/www/medicbolivia/whatsapp-service",
      script: "src/index.js",
      interpreter: "node",
      cron_restart: "0 7 * * *",
      env: { NODE_ENV: "production" },
      error_file: "/var/log/medicbolivia/whatsapp-service-error.log",
      out_file: "/var/log/medicbolivia/whatsapp-service-out.log",
    }
  ]
}
