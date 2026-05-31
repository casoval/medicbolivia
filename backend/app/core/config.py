"""
app/core/config.py
Configuración central de la aplicación usando Pydantic Settings.
Lee automáticamente desde el archivo .env
"""
from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List
import secrets


class Settings(BaseSettings):
    # ── App ─────────────────────────────────────────
    APP_NAME: str = "MedicBolivia"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"  # development | production

    # ── API ─────────────────────────────────────────
    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://medicbolivia.bo",
    ]

    # ── Seguridad ────────────────────────────────────
    SECRET_KEY: str = secrets.token_urlsafe(32)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 días
    ALGORITHM: str = "HS256"

    # ── Base de datos PostgreSQL ──────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/medicbolivia"
    DATABASE_URL_SYNC: str = "postgresql://user:password@localhost:5432/medicbolivia"

    # ── Redis ────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379"

    # ── IA — Anthropic ───────────────────────────────
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"
    CLAUDE_MAX_TOKENS: int = 1000

    # ── IA — ElevenLabs ──────────────────────────────
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = ""      # ID de la voz del agente "Medi"
    ELEVENLABS_MODEL_ID: str = "eleven_multilingual_v2"

    # ── Twilio (llamadas y SMS) ───────────────────────
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""      # Número boliviano o +1 para pruebas

    # ── AWS S3 (documentos médicos) ───────────────────
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_BUCKET_NAME: str = "medicbolivia-docs"
    AWS_REGION: str = "sa-east-1"      # São Paulo — más cercano a Bolivia

    # ── Pagos QR Bolivia ─────────────────────────────
    QR_EXPIRY_MINUTES: int = 5         # El QR expira en 5 minutos
    PLATFORM_FEE_PERCENT: float = 0.15 # 15% comisión de la plataforma
    PAYMENT_RELEASE_MINUTES: int = 15  # Liberar pago al profesional tras 15 min

    # ── Agente IA ────────────────────────────────────
    AGENT_WAIT_SECONDS: int = 60       # Espera antes de derivar a otro profesional
    AGENT_MAX_DERIVATIONS: int = 3     # Máximo de derivaciones por consulta

    # ── Videollamadas (Daily.co) ──────────────────────
    DAILY_API_KEY: str = ""
    DAILY_DOMAIN: str = ""             # ej: medicbolivia.daily.co

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_db_url(cls, v: str) -> str:
        if not v.startswith("postgresql"):
            raise ValueError("DATABASE_URL debe ser PostgreSQL")
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


# Instancia global — importar desde aquí en todo el proyecto
settings = Settings()
