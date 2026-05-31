"""
app/schemas/schemas.py
Esquemas Pydantic para validación de requests y serialización de responses.
"""
from pydantic import BaseModel, EmailStr, field_validator, Field
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
from app.models.models import (
    UserRole, UserStatus, ProfessionalStatus, AvailabilityMode,
    ConsultationStatus, ConsultationType, PaymentStatus, DocType, DocStatus
)


# ─────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────

class PatientRegisterRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=15, description="Número boliviano ej: 72345678")
    email: Optional[EmailStr] = None
    password: str = Field(..., min_length=8, description="Mínimo 8 caracteres")
    first_name: str = Field(..., min_length=2, max_length=100)
    last_name: str = Field(..., min_length=2, max_length=100)
    ci: str = Field(..., min_length=5, max_length=20, description="Cédula de identidad")
    birth_date: str = Field(..., description="Formato: YYYY-MM-DD")
    department: str = Field(..., description="Departamento boliviano")
    gender: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        # Acepta números bolivianos (7-8 dígitos) o con código de país
        v = v.strip().replace(" ", "").replace("-", "")
        if not v.lstrip("+").isdigit():
            raise ValueError("Número de teléfono inválido")
        return v


class ProfessionalRegisterRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=15)
    email: EmailStr
    password: str = Field(..., min_length=8)
    first_name: str = Field(..., min_length=2, max_length=100)
    last_name: str = Field(..., min_length=2, max_length=100)
    ci: str = Field(..., min_length=5, max_length=20)
    birth_date: Optional[str] = Field(None, description="Formato: YYYY-MM-DD")
    department: Optional[str] = None
    gender: Optional[str] = None
    specialty: str = Field(..., min_length=3, max_length=100)
    languages: List[str] = Field(default=["Español"])


class LoginRequest(BaseModel):
    phone: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


# ─────────────────────────────────────────────────────
# USUARIOS
# ─────────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: str
    phone: str
    email: Optional[str]
    role: UserRole
    status: UserStatus
    onboarding_completed: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# PACIENTES
# ─────────────────────────────────────────────────────

class PatientResponse(BaseModel):
    id: str
    user_id: str
    first_name: str
    last_name: str
    ci: str
    birth_date: datetime
    department: str
    gender: Optional[str]
    allergies: List[str]
    chronic_conditions: List[str]
    current_medications: List[str]

    model_config = {"from_attributes": True}


class PatientUpdateRequest(BaseModel):
    allergies: Optional[List[str]] = None
    chronic_conditions: Optional[List[str]] = None
    current_medications: Optional[List[str]] = None
    department: Optional[str] = None


# ─────────────────────────────────────────────────────
# PROFESIONALES
# ─────────────────────────────────────────────────────

class ProfessionalPublicResponse(BaseModel):
    """Lo que ve el paciente en el directorio."""
    id: str
    first_name: str
    last_name: str
    specialty: str
    sub_specialties: List[str]
    bio: Optional[str]
    languages: List[str]
    years_experience: int
    photo_url: Optional[str]
    availability: AvailabilityMode
    price_general: Decimal
    price_urgent: Decimal
    price_follow_up: Decimal
    average_rating: Decimal
    total_ratings: int
    total_consultations: int

    model_config = {"from_attributes": True}


class ProfessionalUpdateRequest(BaseModel):
    bio: Optional[str] = None
    languages: Optional[List[str]] = None
    years_experience: Optional[int] = None
    sub_specialties: Optional[List[str]] = None


class PriceUpdateRequest(BaseModel):
    price_general: Optional[Decimal] = Field(None, ge=0)
    price_urgent: Optional[Decimal] = Field(None, ge=0)
    price_follow_up: Optional[Decimal] = Field(None, ge=0)


class AvailabilityUpdateRequest(BaseModel):
    availability: AvailabilityMode


# ─────────────────────────────────────────────────────
# CONSULTAS
# ─────────────────────────────────────────────────────

class ConsultationCreateRequest(BaseModel):
    professional_id: str
    consultation_type: ConsultationType = ConsultationType.IMMEDIATE
    specialty: Optional[str] = None
    chief_complaint: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class ConsultationResponse(BaseModel):
    id: str
    patient_id: str
    professional_id: Optional[str]
    consultation_type: ConsultationType
    status: ConsultationStatus
    specialty: Optional[str]
    chief_complaint: Optional[str]
    amount: Decimal
    platform_fee: Decimal
    professional_earning: Decimal
    video_room_url: Optional[str]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_minutes: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# PAGOS QR
# ─────────────────────────────────────────────────────

class QRPaymentResponse(BaseModel):
    payment_id: str
    qr_image_url: str
    amount: Decimal
    expires_at: datetime
    consultation_id: str
    professional_name: str


class PaymentWebhookRequest(BaseModel):
    """Webhook del banco cuando confirma el pago QR."""
    bank_tx_id: str
    qr_code: str
    bank_name: str
    amount: Decimal
    timestamp: str
    # En producción el banco incluye firma/token de verificación
    webhook_token: Optional[str] = None


# ─────────────────────────────────────────────────────
# RECETAS
# ─────────────────────────────────────────────────────

class MedicationItem(BaseModel):
    name: str
    presentation: str        # "comprimidos 20mg"
    dosage: str              # "1 comprimido"
    frequency: str           # "cada 24 horas"
    duration: str            # "30 días"
    notes: Optional[str] = None


class PrescriptionCreateRequest(BaseModel):
    consultation_id: str
    medications: List[MedicationItem]
    instructions: Optional[str] = None


class PrescriptionResponse(BaseModel):
    id: str
    consultation_id: str
    patient_name: str
    patient_ci: str
    patient_age: int
    medications: List[dict]
    instructions: Optional[str]
    digital_hash: str
    qr_verify_code: str
    pdf_url: Optional[str]
    signed_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# CALIFICACIONES
# ─────────────────────────────────────────────────────

class RatingCreateRequest(BaseModel):
    consultation_id: str
    score: int = Field(..., ge=1, le=5, description="Calificación del 1 al 5")
    comment: Optional[str] = Field(None, max_length=500)


class RatingResponse(BaseModel):
    id: str
    score: int
    comment: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# AGENTE IA
# ─────────────────────────────────────────────────────

class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: Optional[str] = None


class AgentChatResponse(BaseModel):
    session_id: str
    message: str
    action: Optional[dict] = None
    available_professionals: Optional[List[ProfessionalPublicResponse]] = None
    onboarding_completed: Optional[bool] = None


# ─────────────────────────────────────────────────────
# ADMIN
# ─────────────────────────────────────────────────────

class DocReviewRequest(BaseModel):
    status: DocStatus
    review_note: Optional[str] = None


class RefundRequest(BaseModel):
    refund_type: str = Field(..., pattern="^(FULL|PARTIAL)$")
    reason: str = Field(..., min_length=10)


# Actualizar referencias forward
TokenResponse.model_rebuild()