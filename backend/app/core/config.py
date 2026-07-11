"""
app/core/config.py
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List


class Settings(BaseSettings):
    # extra="ignore": si el .env trae una variable que todavía no está
    # declarada acá abajo (por ej. alguien agregó ANTHROPIC_API_KEY o
    # PAYMENT_RELEASE_MINUTES al .env antes de sumar el campo acá), la
    # app arranca igual e ignora esa variable de más, en vez de crashear
    # por completo. Sin esto, cada variable nueva sin declarar tumbaba
    # todo el backend en un loop infinito de reinicios (72k+ restarts).
    model_config = SettingsConfigDict(
        extra="ignore",
        env_file=".env",
        case_sensitive=True,
    )

    APP_NAME: str = "MedicBolivia"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://medicbolivia.com",
    ]

    # Sin default a propósito: si falta en el .env, la app debe fallar al
    # arrancar en vez de generar un secreto al azar por proceso — eso
    # invalidaría todos los tokens JWT en cada reinicio, y con más de un
    # worker cada uno firmaría con una clave distinta (401 aleatorios).
    SECRET_KEY: str
    # 24 horas. Antes eran 7 días (60*24*7): una sesión tan larga sin forma
    # de revocarla del lado del servidor era demasiado riesgo si un token
    # se filtraba. Con logout solo del lado del cliente (ver /auth/logout),
    # bajar esto es la forma más simple de acotar la ventana de exposición.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
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

    # ── Cloudflare R2 ────────────────────────────────
    # Bucket privado: documentos de verificación (CI, títulos, etc.)
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_ACCOUNT_ID: str = ""
    R2_BUCKET_DOCS: str = "medicbolivia-docs"
    # Bucket público: fotos de perfil de los profesionales
    R2_BUCKET_PHOTOS: str = "medicbolivia-photos"
    # URL pública del bucket de fotos (la que te da Cloudflare al activar r2.dev)
    R2_PUBLIC_PHOTOS_URL: str = ""

    # ── Chat interno paciente-profesional ─────────────
    # Los adjuntos del chat van al mismo bucket privado que los documentos
    # de verificación (R2_BUCKET_DOCS) bajo el prefijo "chat/", no a un
    # bucket nuevo — son privados igual y ya tenemos ese bucket armado.
    # Días que la conversación sigue activa después de Consultation.ended_at
    # antes de pasar a solo lectura. 15 es el valor por defecto del negocio;
    # ajustable sin tocar código.
    CHAT_WINDOW_DAYS: int = 15
    CHAT_MAX_ATTACHMENT_MB: int = 10

    QR_EXPIRY_MINUTES: int = 5
    PLATFORM_FEE_PERCENT: float = 0.15
    # Protección contra fuerza bruta en login: intentos fallidos permitidos
    # por teléfono antes de bloquear temporalmente ese número (vía Redis).
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15
    # Secreto compartido para validar que las llamadas a /webhook/payment
    # vienen realmente del backend del banco (o, hoy, de nuestro propio
    # backend en pruebas) — y no de cualquiera que copie el qr_code de la
    # URL de la imagen del QR, que el paciente sí puede ver.
    # TEMPORAL: hasta integrar la pasarela bancaria real, que traerá su
    # propio esquema de firma. Mientras tanto, esto es la única barrera.
    PAYMENT_WEBHOOK_SECRET: str = ""
    # Ventana tras terminar la consulta para que el paciente reclame antes
    # de liberar el pago automáticamente al profesional.
    PAYMENT_HOLD_MINUTES: int = 60
    # Plazo máximo (referencial, para el panel admin) para resolver una disputa.
    DISPUTE_RESOLUTION_SLA_HOURS: int = 48

    AGENT_WAIT_SECONDS: int = 60
    AGENT_MAX_DERIVATIONS: int = 3

    # ── WhatsApp Cloud API (verificación de teléfono por OTP) ────────
    WHATSAPP_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_API_VERSION: str = "v20.0"
    # Debe coincidir exactamente con el nombre/idioma de la plantilla
    # categoría "Autenticación" aprobada en WhatsApp Manager.
    WHATSAPP_OTP_TEMPLATE_NAME: str = "otp_verification"
    WHATSAPP_OTP_TEMPLATE_LANG: str = "es"
    OTP_LENGTH: int = 6
    # Subido de 5 a 20: 5 minutos resultaba muy ajustado para el flujo real
    # (salir de la app, abrir WhatsApp, copiar el código, volver) y generaba
    # códigos "expirados" de forma seguida sin que la persona hiciera nada mal.
    OTP_EXPIRE_MINUTES: int = 20
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_COOLDOWN_SECONDS: int = 60

    # ── Redis dedicado a seguridad (OTP + bloqueo de login) ──────────
    # Instancia separada del Redis compartido con Celery (REDIS_URL). En
    # producción corre en el puerto 6380 con su propia password (ver
    # scripts/setup_redis_security.sh); en desarrollo, si no se define,
    # cae al mismo REDIS_URL de siempre (el namespacing de keys evita
    # colisiones con Celery).
    AUTH_REDIS_URL: str = ""

    # ── Rate limit por IP en "olvidé mi contraseña" ──────────────────
    # Ahora que ese endpoint revela explícitamente si el número está
    # registrado (ver auth.py), una IP sola no puede usarlo para escanear
    # números sin límite — a partir de este umbral se bloquea la IP,
    # independientemente del número que esté consultando.
    FORGOT_PASSWORD_IP_MAX_ATTEMPTS: int = 10
    FORGOT_PASSWORD_IP_WINDOW_MINUTES: int = 15

    DAILY_API_KEY: str = ""
    DAILY_DOMAIN: str = ""

    # ── LiveKit ──────────────────────────────────────────
    LIVEKIT_URL: str = ""
    LIVEKIT_API_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # ── Celery (recordatorios + backups programados) ────
    # Usa el mismo Redis que ya corre para OTP/rate-limiting, pero en un
    # índice de base de datos distinto (0 = uso actual, 1 = broker/backend
    # de Celery) para no mezclar keys de dominios distintos.
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # ── whatsapp-service (microservicio Node + Baileys) ─
    # URL interna (no expuesta a internet) donde corre el microservicio
    # que mantiene la sesión de WhatsApp vinculada al número real.
    WHATSAPP_SERVICE_URL: str = "http://localhost:4100"
    # Secreto compartido para que el microservicio Node y este backend se
    # autentiquen entre sí (header X-Internal-Secret en ambas direcciones).
    WHATSAPP_SERVICE_INTERNAL_SECRET: str = ""

    # ── Gmail (backups automáticos de la base de datos) ─
    # Requiere verificación en 2 pasos activada en la cuenta de Gmail y
    # una "contraseña de aplicación" generada en
    # https://myaccount.google.com/apppasswords — NO es la contraseña
    # normal de la cuenta.
    GMAIL_SENDER_ADDRESS: str = ""
    GMAIL_APP_PASSWORD: str = ""
    GMAIL_SMTP_HOST: str = "smtp.gmail.com"
    GMAIL_SMTP_PORT: int = 587
    # Límite de adjunto antes de subir el dump a R2/S3 y mandar el link en
    # vez del archivo (Gmail rechaza adjuntos de más de ~25MB).
    BACKUP_MAX_ATTACHMENT_MB: int = 20

    # ── SMTP Hostinger (formulario de contacto de la landing) ───────
    # Buzón info@medicbolivia.com alojado en Hostinger. Se usa SOLO para
    # avisar por correo cuando alguien manda el formulario público de
    # "Contáctanos" — no tiene relación con el backup de Gmail de arriba.
    CONTACT_SMTP_HOST: str = "smtp.hostinger.com"
    CONTACT_SMTP_PORT: int = 465  # 465 = SSL directo (el que usa Hostinger por default)
    CONTACT_SMTP_USER: str = ""
    CONTACT_SMTP_PASSWORD: str = ""
    # A dónde llega el aviso. Casi siempre la misma casilla que envía, pero
    # queda separado por si algún día se quiere repartir a otra bandeja.
    CONTACT_RECIPIENT_EMAIL: str = "info@medicbolivia.com"
    # Tope de envíos del formulario por IP por hora, para frenar spam/bots
    # sin necesitar CAPTCHA.
    CONTACT_FORM_MAX_PER_HOUR: int = 5
    # Freno de emergencia adicional: tope GLOBAL de consultas por día, sin
    # importar la IP. Protege contra spam distribuido desde muchas IPs
    # distintas (proxies/botnets), donde el límite por IP de arriba no
    # alcanza porque cada una arranca su propio contador.
    CONTACT_FORM_MAX_PER_DAY: int = 100

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if not v or "CAMBIA_ESTO" in v:
            raise ValueError(
                "SECRET_KEY no está configurado. Generá uno con: "
                "python -c \"import secrets; print(secrets.token_urlsafe(32))\" "
                "y ponelo en tu .env"
            )
        return v

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_db_url(cls, v: str) -> str:
        if not v.startswith("postgresql"):
            raise ValueError("DATABASE_URL debe ser PostgreSQL")
        return v

settings = Settings()