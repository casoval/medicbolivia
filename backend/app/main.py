"""
app/main.py
Punto de entrada principal de la aplicación FastAPI MedicBolivia.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from loguru import logger
import sys

from app.core.config import settings
from app.api.v1.endpoints import auth, professionals, patients, consultations, agent, admin
from app.api.v1.endpoints import prescriptions, ratings, specialties, clinical_notes, faq
from app.api.v1.endpoints import whatsapp


# ── Configurar logging con Loguru ─────────────────────
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | <cyan>{name}</cyan> | {message}",
    level="DEBUG" if settings.DEBUG else "INFO",
    colorize=True,
)
logger.add(
    "logs/medicbolivia.log",
    rotation="10 MB",
    retention="30 days",
    level="INFO",
    format="{time} | {level} | {name} | {message}",
)


# ── Lifespan: arranque y cierre de la app ─────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar
    logger.info(f"🚀 Iniciando {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"🌍 Entorno: {settings.ENVIRONMENT}")

    # El esquema de la base ahora se gestiona con Alembic (alembic upgrade head),
    # no con create_all_tables() — así evitamos que el arranque del backend
    # cree tablas por fuera del control de las migraciones.
    logger.info("📦 Base de datos lista (esquema gestionado por Alembic)")

    yield

    # Al cerrar
    logger.info("👋 Cerrando MedicBolivia...")


# ── Crear la app ──────────────────────────────────────
app = FastAPI(
    title="MedicBolivia API",
    description="""
    ## API de Telemedicina para Bolivia

    Plataforma de consultas médicas en línea con agentes IA.

    ### Características
    - 🤖 Agente IA de orientación médica (Claude + ElevenLabs)
    - 💳 Pagos QR bolivianos
    - 🏥 Videoconsultas en tiempo real
    - 📋 Recetas digitales con firma criptográfica
    - ⭐ Sistema de calificaciones

    ### Autenticación
    Usar `Bearer <token>` en el header `Authorization`.
    """,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# ── Middlewares ───────────────────────────────────────

# CORS: permitir el frontend Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Handler de errores 500 que preserva headers CORS
from fastapi import Request
from fastapi.responses import JSONResponse
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Error no manejado: {exc}\n{traceback.format_exc()}")

    # En producción no devolvemos el mensaje ni el tipo de la excepción al
    # cliente: pueden filtrar detalles internos (consultas SQL, rutas de
    # archivos, nombres de variables, etc.). El detalle completo ya quedó
    # arriba en el log del servidor para debug. En DEBUG=True (desarrollo
    # local) sí lo mostramos, para no perder comodidad al programar.
    if settings.DEBUG:
        content = {"detail": str(exc), "type": type(exc).__name__}
    else:
        content = {"detail": "Ocurrió un error interno. Intentá de nuevo más tarde."}

    # No repetimos un "*" fijo: reflejamos el origen de la request solo si
    # está en la lista blanca, igual que hace CORSMiddleware en el resto de
    # la app. Un wildcard combinado con allow_credentials=True es inválido
    # según el spec de CORS y más permisivo de lo necesario.
    headers = {}
    origin = request.headers.get("origin")
    if origin in settings.ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"

    return JSONResponse(status_code=500, content=content, headers=headers)


# ── Routers ───────────────────────────────────────────
PREFIX = settings.API_V1_PREFIX

app.include_router(auth.router,          prefix=f"{PREFIX}/auth",          tags=["Autenticación"])
app.include_router(professionals.router, prefix=f"{PREFIX}/professionals",  tags=["Profesionales"])
app.include_router(patients.router,      prefix=f"{PREFIX}/patients",       tags=["Pacientes"])
app.include_router(consultations.router, prefix=f"{PREFIX}/consultations",  tags=["Consultas"])
app.include_router(agent.router,         prefix=f"{PREFIX}/agent",          tags=["Agente IA"])
app.include_router(admin.router,         prefix=f"{PREFIX}/admin",          tags=["Administración"])
app.include_router(prescriptions.router, prefix=f"{PREFIX}/prescriptions",  tags=["Recetas"])
app.include_router(clinical_notes.router, prefix=f"{PREFIX}/clinical-notes", tags=["Historia Clínica"])
app.include_router(ratings.router,       prefix=f"{PREFIX}/ratings",        tags=["Calificaciones"])
app.include_router(specialties.router,   prefix=f"{PREFIX}/specialties",    tags=["Especialidades"])
app.include_router(faq.router,           prefix=f"{PREFIX}/faq",            tags=["Preguntas Frecuentes"])
app.include_router(whatsapp.router,      prefix=f"{PREFIX}/whatsapp",       tags=["IA / WhatsApp"])


# ── Health check ──────────────────────────────────────
@app.get("/health", tags=["Sistema"])
async def health_check():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
    }


@app.get("/", tags=["Sistema"])
async def root():
    return {
        "message": f"Bienvenido a {settings.APP_NAME} API",
        "docs": "/docs",
    }