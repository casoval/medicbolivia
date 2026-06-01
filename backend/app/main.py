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
from app.db.database import create_all_tables
from app.api.v1.endpoints import auth, professionals, consultations, agent, admin
from app.api.v1.endpoints import prescriptions, ratings


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

    await create_all_tables()
    logger.info("📦 Base de datos lista")

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


# ── Routers ───────────────────────────────────────────
PREFIX = settings.API_V1_PREFIX

app.include_router(auth.router,          prefix=f"{PREFIX}/auth",          tags=["Autenticación"])
app.include_router(professionals.router, prefix=f"{PREFIX}/professionals",  tags=["Profesionales"])
app.include_router(consultations.router, prefix=f"{PREFIX}/consultations",  tags=["Consultas"])
app.include_router(agent.router,         prefix=f"{PREFIX}/agent",          tags=["Agente IA"])
app.include_router(admin.router,         prefix=f"{PREFIX}/admin",          tags=["Administración"])
app.include_router(prescriptions.router, prefix=f"{PREFIX}/prescriptions",  tags=["Recetas"])
app.include_router(ratings.router,       prefix=f"{PREFIX}/ratings",        tags=["Calificaciones"])


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