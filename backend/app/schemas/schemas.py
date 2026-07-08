"""
app/schemas/schemas.py
Esquemas Pydantic para validación de requests y serialización de responses.
"""
from pydantic import BaseModel, EmailStr, field_validator, model_validator, Field
from typing import Optional, List
from datetime import datetime
from decimal import Decimal
from app.core.phone import normalize_bo_phone, normalize_intl_phone, InvalidPhoneError
from app.models.models import (
    UserRole, UserStatus, ProfessionalStatus, AvailabilityMode,
    ConsultationStatus, ConsultationType, PaymentStatus, DocType, DocStatus,
    ProposalType, ProposalStatus
)


# ─────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────

class PatientRegisterRequest(BaseModel):
    # El frontend ya concatena código de país + número (selector de país,
    # Bolivia +591 por default) antes de mandarlo — por eso se valida con
    # normalize_intl_phone en vez de normalize_bo_phone. Ver app/core/phone.py.
    phone: str = Field(..., min_length=8, max_length=17, description="Código de país + número, ej: 59172345678")
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
        try:
            return normalize_intl_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class ProfessionalRegisterRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=17, description="Código de país + número, ej: 59172345678")
    email: Optional[EmailStr] = None
    password: str = Field(..., min_length=8)
    first_name: str = Field(..., min_length=2, max_length=100)
    last_name: str = Field(..., min_length=2, max_length=100)
    ci: str = Field(..., min_length=5, max_length=20)
    birth_date: Optional[str] = Field(None, description="Formato: YYYY-MM-DD")
    department: Optional[str] = None
    gender: Optional[str] = None
    specialty: str = Field(..., min_length=3, max_length=100)
    sub_specialties: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default=["Español"])

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        try:
            return normalize_intl_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class LoginRequest(BaseModel):
    phone: str
    password: str

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        # El frontend ahora manda código de país + número (mismo selector
        # que en el registro), por eso se normaliza con
        # normalize_intl_phone en vez de asumir siempre Bolivia. Esa misma
        # función igual asume Bolivia como fallback si vienen solo 6-8
        # dígitos sueltos, así que un login viejo guardado sin código de
        # país (autocompletado del navegador, etc.) sigue andando.
        #
        # Si el string no matchea ningún formato válido, se deja pasar
        # tal cual y que el login falle por "credenciales inválidas" en
        # vez de por un 422 confuso de formato.
        try:
            return normalize_intl_phone(v)
        except InvalidPhoneError:
            return v


class OTPSendRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=15, description="Número boliviano ej: 72345678")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        try:
            return normalize_bo_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class OTPVerifyRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=15)
    code: str = Field(..., min_length=4, max_length=8)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        try:
            return normalize_bo_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class ForgotPasswordRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=15, description="Número boliviano ej: 72345678")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        try:
            return normalize_bo_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class ResetPasswordRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=15)
    code: str = Field(..., min_length=4, max_length=8)
    new_password: str = Field(..., min_length=8, description="Mínimo 8 caracteres")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        try:
            return normalize_bo_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


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
    department: Optional[str] = None
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
    appointment_duration_minutes: Optional[int] = Field(None, ge=10, le=240)


class PriceUpdateRequest(BaseModel):
    price_general: Optional[Decimal] = Field(None, gt=0)
    price_urgent: Optional[Decimal] = Field(None, gt=0)
    price_follow_up: Optional[Decimal] = Field(None, gt=0)

    @field_validator('price_general', 'price_urgent', 'price_follow_up')
    @classmethod
    def price_must_be_whole_number(cls, v):
        if v is not None and v != v.to_integral_value():
            raise ValueError('El precio debe ser un número entero, sin decimales')
        return v


class AvailabilityUpdateRequest(BaseModel):
    availability: Optional[AvailabilityMode] = None
    auto_availability: Optional[bool] = None

    @model_validator(mode="after")
    def at_least_one(self):
        if self.availability is None and self.auto_availability is None:
            raise ValueError("Debes enviar availability y/o auto_availability")
        return self


# ─────────────────────────────────────────────────────
# HORARIOS (SCHEDULE)
# ─────────────────────────────────────────────────────

class ScheduleBlockInput(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6, description="0=Domingo..6=Sábado")
    start_time: str = Field(..., pattern=r"^([01]\d|2[0-3]):([0-5]\d)$", description="Formato HH:MM")
    end_time: str = Field(..., pattern=r"^([01]\d|2[0-3]):([0-5]\d)$", description="Formato HH:MM")
    is_blocked: bool = False

    @model_validator(mode="after")
    def end_after_start(self):
        if self.end_time <= self.start_time:
            raise ValueError(f"end_time ({self.end_time}) debe ser posterior a start_time ({self.start_time})")
        return self


class ScheduleSetRequest(BaseModel):
    """Reemplaza todos los bloques semanales del profesional logueado."""
    blocks: List[ScheduleBlockInput]


class ScheduleResponse(BaseModel):
    id: str
    day_of_week: int
    start_time: str
    end_time: str
    is_blocked: bool

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# CONSULTAS
# ─────────────────────────────────────────────────────

class ConsultationCreateRequest(BaseModel):
    professional_id: str
    consultation_type: ConsultationType = ConsultationType.IMMEDIATE
    specialty: Optional[str] = None
    chief_complaint: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class RescheduleProposeRequest(BaseModel):
    new_scheduled_at: datetime


class RescheduleRespondRequest(BaseModel):
    decision: str = Field(..., pattern="^(ACCEPT|REJECT)$")


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
    scheduled_at: Optional[datetime] = None
    reschedule_proposed_at: Optional[datetime] = None
    reschedule_proposed_by: Optional[str] = None
    reschedule_used: bool = False
    outcome_note: Optional[str] = None
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    duration_minutes: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Datos del profesional (enriquecidos en el endpoint con JOIN, para mostrar
    # nombre y foto en "Consultas recientes" / historial del paciente)
    professional_first_name: Optional[str] = None
    professional_last_name: Optional[str] = None
    professional_photo_url: Optional[str] = None
    professional_department: Optional[str] = None
    professional_sub_specialties: Optional[List[str]] = None
    # Datos del paciente (enriquecidos en el endpoint con JOIN, para que el
    # profesional tenga un buen registro de quién fue cada consulta)
    patient_first_name: Optional[str] = None
    patient_last_name: Optional[str] = None
    # Datos del pago (enriquecidos en el endpoint con JOIN), para que el
    # historial muestre cuándo se pagó/reembolsó y por qué.
    payment_status: Optional[str] = None
    payment_paid_at: Optional[datetime] = None
    payment_refunded_at: Optional[datetime] = None
    payment_refund_note: Optional[str] = None

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
    # Nota: la verificación real de origen se hace con el header
    # X-Webhook-Secret (ver auth por HMAC en el endpoint), no por body.


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
    # Si esta receta corrige una anulada, se enlaza aquí para dejar
    # rastro de auditoría entre la original y la reemisión.
    replaces_prescription_id: Optional[str] = None


class PrescriptionVoidRequest(BaseModel):
    reason: Optional[str] = None


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
    status: str = "ACTIVE"
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    replaces_prescription_id: Optional[str] = None
    # Datos del médico (enriquecidos en el endpoint)
    professional_name: Optional[str] = None
    professional_specialty: Optional[str] = None
    professional_sub_specialties: Optional[List[str]] = None
    professional_department: Optional[str] = None
    cmb_matricula: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}


# ─────────────────────────────────────────────────────
# HISTORIA CLÍNICA (Gap 4)
# ─────────────────────────────────────────────────────

class ClinicalNoteCreateRequest(BaseModel):
    consultation_id: str
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    is_visible_to_patient: bool = True


class ClinicalNoteUpdateRequest(BaseModel):
    """Todos los campos opcionales: permite guardar parcial mientras el
    médico sigue escribiendo durante la videollamada (autosave)."""
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    is_visible_to_patient: Optional[bool] = None


class ClinicalNoteShareRequest(BaseModel):
    shared_with_professionals: bool


class ClinicalNoteAddendumCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


class ClinicalNoteAddendumResponse(BaseModel):
    id: str
    clinical_note_id: str
    professional_id: str
    content: str
    created_at: datetime
    # Enriquecido en el endpoint
    professional_name: Optional[str] = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ClinicalNoteResponse(BaseModel):
    id: str
    consultation_id: str
    professional_id: str
    patient_id: str
    subjective: Optional[str]
    objective: Optional[str]
    assessment: Optional[str]
    plan: Optional[str]
    is_visible_to_patient: bool
    shared_with_professionals: bool
    edit_count: int = 0
    created_at: datetime
    updated_at: datetime
    # Enriquecido en el endpoint
    professional_name: Optional[str] = None
    professional_specialty: Optional[str] = None
    patient_name: Optional[str] = None
    is_editable: Optional[bool] = None
    edit_window_expires_at: Optional[datetime] = None
    addenda: list[ClinicalNoteAddendumResponse] = []

    model_config = {"from_attributes": True, "populate_by_name": True}


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
# ESPECIALIDADES Y SUBESPECIALIDADES
# ─────────────────────────────────────────────────────

class SpecialtyResponse(BaseModel):
    id: str
    name: str

    model_config = {"from_attributes": True}


class SubSpecialtyResponse(BaseModel):
    id: str
    name: str

    model_config = {"from_attributes": True}


class ProposalCreateRequest(BaseModel):
    type: ProposalType
    proposed_name: str = Field(..., min_length=3, max_length=100)
    # Solo aplica si type == SUB_SPECIALTY: exactamente uno de los dos
    # debe venir informado (la especialidad padre ya existe en el catálogo,
    # o también está pendiente como otra propuesta del mismo profesional).
    parent_specialty_id: Optional[str] = None
    parent_proposal_id: Optional[str] = None

    @field_validator("proposed_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def validate_parent_for_sub_specialty(self):
        if self.type == ProposalType.SUB_SPECIALTY:
            has_specialty = self.parent_specialty_id is not None
            has_proposal = self.parent_proposal_id is not None
            if has_specialty == has_proposal:  # ambos True o ambos False
                raise ValueError(
                    "Una subespecialidad necesita exactamente uno: "
                    "parent_specialty_id o parent_proposal_id"
                )
        return self


class ProposalReviewRequest(BaseModel):
    decision: str = Field(..., pattern="^(APPROVE|REJECT)$")
    final_name: Optional[str] = Field(None, min_length=3, max_length=100)
    admin_note: Optional[str] = None


class ProposalResponse(BaseModel):
    id: str
    professional_id: str
    type: ProposalType
    proposed_name: str
    parent_specialty_id: Optional[str]
    parent_proposal_id: Optional[str]
    status: ProposalStatus
    admin_note: Optional[str]
    created_at: datetime
    reviewed_at: Optional[datetime]

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# ADMIN
# ─────────────────────────────────────────────────────

class DocReviewRequest(BaseModel):
    status: DocStatus
    review_note: Optional[str] = None


class RefundRequest(BaseModel):
    refund_type: str = Field(..., pattern="^(FULL|PARTIAL)$")
    reason: str = Field(..., min_length=10)
    amount: Optional[Decimal] = None  # requerido si refund_type == PARTIAL


class DisputeCreateRequest(BaseModel):
    """El paciente reporta un problema con una consulta ya terminada."""
    category: str = Field(..., pattern="^(NO_SHOW|MALA_CALIDAD|TECNICO|OTRO)$")
    reason: str = Field(..., min_length=10, max_length=1000)


class DisputeResolveRequest(BaseModel):
    """Un admin resuelve una disputa: libera el pago o reembolsa."""
    resolution: str = Field(..., pattern="^(RELEASE|REFUND_FULL|REFUND_PARTIAL)$")
    amount: Optional[Decimal] = None  # requerido si resolution == REFUND_PARTIAL
    note: str = Field(..., min_length=10)


# ─────────────────────────────────────────────────────
# FAQ (preguntas frecuentes — landing pública)
# ─────────────────────────────────────────────────────

class FAQResponse(BaseModel):
    id: str
    question: str
    answer: str
    audience: str
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FAQCreateRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=300)
    answer: str = Field(..., min_length=1)
    audience: str = Field(default="GENERAL", pattern="^(GENERAL|PATIENT|PROFESSIONAL)$")
    display_order: int = 0
    is_active: bool = True


class FAQUpdateRequest(BaseModel):
    """Todos los campos opcionales: PATCH parcial desde el panel admin."""
    question: Optional[str] = Field(None, min_length=3, max_length=300)
    answer: Optional[str] = Field(None, min_length=1)
    audience: Optional[str] = Field(None, pattern="^(GENERAL|PATIENT|PROFESSIONAL)$")
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


# Actualizar referencias forward
TokenResponse.model_rebuild()