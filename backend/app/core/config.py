"""
app/core/config.py
"""
from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List
import secrets


class Settings(BaseSettings):
    APP_NAME: str = "MedicBolivia"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://medicbolivia.com",
    ]

    SECRET_KEY: str = secrets.token_urlsafe(32)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    ALGORITHM: str = "HS256"

    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/medicbolivia"
    DATABASE_URL_SYNC: str = "postgresql://user:password@localhost:5432/medicbolivia"

    REDIS_URL: str = "redis://localhost:6379"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # ── Google Cloud TTS ─────────────────────────────
    GOOGLE_TTS_API_KEY: str = ""
    GOOGLE_TTS_VOICE: str = "es-US-Neural2-C"
    GOOGLE_TTS_LANGUAGE: str = "es-US"

    # ── ElevenLabs (reemplazado por Google TTS) ──────
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = ""
    ELEVENLABS_MODEL_ID: str = "eleven_multilingual_v2"

    # ── Twilio ───────────────────────────────────────
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""

    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_BUCKET_NAME: str = "medicbolivia-docs"
    AWS_REGION: str = "sa-east-1"

    QR_EXPIRY_MINUTES: int = 5
    PLATFORM_FEE_PERCENT: float = 0.15
    PAYMENT_RELEASE_MINUTES: int = 15

    AGENT_WAIT_SECONDS: int = 60
    AGENT_MAX_DERIVATIONS: int = 3

    DAILY_API_KEY: str = ""
    DAILY_DOMAIN: str = ""

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_db_url(cls, v: str) -> str:
        if not v.startswith("postgresql"):
            raise ValueError("DATABASE_URL debe ser PostgreSQL")
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()