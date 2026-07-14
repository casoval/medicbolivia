"""
app/schemas/schemas.py
Esquemas Pydantic para validación de requests y serialización de responses.
"""
from pydantic import BaseModel, EmailStr, field_validator, model_validator, Field
from typing import Optional, List
from datetime import datetime, timezone
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
    # Duración (en minutos) que el profesional configuró para sus citas en
    # /professional/schedule. Se usa en el calendario para dibujar el bloque
    # de cada cita con el tamaño real, no un valor fijo asumido.
    professional_appointment_duration_minutes: Optional[int] = None
    # Datos del paciente (enriquecidos en el endpoint con JOIN, para que el
    # profesional tenga un buen registro de quién fue cada consulta)
    patient_first_name: Optional[str] = None
    patient_last_name: Optional[str] = None
    patient_photo_url: Optional[str] = None
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


# ─────────────────────────────────────────────────────
# MEMBRESÍA / AGENDAMIENTO DIRECTO DEL PROFESIONAL
# ─────────────────────────────────────────────────────

class ProfessionalScheduleRequest(BaseModel):
    """
    El profesional agenda directamente a un paciente ya vinculado (ver
    /patients/link). Requiere membresía activa. Sin límite de horario
    disponible (sí se sigue chequeando choque contra la propia agenda).
    """
    patient_id: str
    scheduled_at: datetime
    specialty: Optional[str] = None
    chief_complaint: Optional[str] = None
    payment_channel: str = Field(..., pattern="^(PLATFORM_QR|CASH)$")
    # PLATFORM_QR: si se omite, se usa professional.price_general.
    # CASH: obligatorio, pero se acepta 0 (ej. cortesía).
    amount: Optional[Decimal] = None

    @field_validator("amount")
    @classmethod
    def _amount_no_negativo(cls, v):
        if v is not None and v < 0:
            raise ValueError("El monto no puede ser negativo")
        return v


class PatientLinkCreateRequest(BaseModel):
    professional_id: str


class PatientLinkResponse(BaseModel):
    id: str
    patient_id: str
    professional_id: str
    created_at: datetime
    revoked_at: Optional[datetime] = None
    professional_first_name: Optional[str] = None
    professional_last_name: Optional[str] = None
    professional_photo_url: Optional[str] = None
    professional_specialty: Optional[str] = None
    patient_first_name: Optional[str] = None
    patient_last_name: Optional[str] = None
    patient_photo_url: Optional[str] = None

    model_config = {"from_attributes": True}


def _to_naive_utc(v: Optional[datetime]) -> Optional[datetime]:
    """Normaliza cualquier datetime entrante a naive-UTC.

    El frontend puede mandar ISO con 'Z' u offset (tz-aware) mientras que
    las columnas en DB son TIMESTAMP WITHOUT TIME ZONE (naive). Mezclar
    ambos en el mismo INSERT rompe asyncpg ("can't subtract offset-naive
    and offset-aware datetimes"), así que se normaliza aquí, en el borde
    de entrada, antes de que llegue a cualquier servicio o al ORM.
    """
    if v is None:
        return v
    if v.tzinfo is not None:
        v = v.astimezone(timezone.utc).replace(tzinfo=None)
    return v


def _to_bolivia_naive(v: Optional[datetime]) -> Optional[datetime]:
    """Igual que _to_naive_utc pero en hora de Bolivia, no UTC.

    ProfessionalMembership.starts_at/ends_at viven en el dominio
    "Bolivia-naive" (ver app.core.timezone) para que "¿sigue vigente
    ahora?" se compare correctamente contra bolivia_now_naive(). Si acá
    se normalizara a UTC en cambio, un "deshabilitar ahora" podría dejar
    la membresía viéndose activa hasta 4 horas de más.
    """
    if v is None:
        return v
    from app.core.timezone import BOLIVIA_TZ
    if v.tzinfo is not None:
        v = v.astimezone(BOLIVIA_TZ).replace(tzinfo=None)
    return v


class ProfessionalMembershipCreateRequest(BaseModel):
    professional_id: str
    period_label: Optional[str] = None
    # Si no se manda, arranca "hoy" en hora de Bolivia. OJO: a propósito
    # NO se normaliza tzinfo acá — el endpoint (as_bolivia_calendar_day)
    # necesita el tzinfo original intacto para convertir bien el día
    # calendario elegido; si se le quita acá, se pierde el offset y el
    # cálculo del día queda mal.
    starts_at: Optional[datetime] = None
    # Meses pagados de una vez (1 = un mes, 3 = trimestre, etc).
    # ends_at YA NO se manda a mano: siempre se calcula como
    # starts_at + months meses calendario (15 jul + 1 mes = 15 ago).
    months: int = Field(default=1, ge=1)
    note: Optional[str] = None


class ProfessionalMembershipRenewRequest(BaseModel):
    # Mínimo 1 mes. Solo aplica si la membresía sigue vigente al momento
    # de renovar (ver regla de negocio en el endpoint); si ya venció, no
    # se renueva — hay que crear una membresía nueva desde cero.
    months: int = Field(default=1, ge=1)
    note: Optional[str] = None


class ProfessionalMembershipUpdateRequest(BaseModel):
    active: Optional[bool] = None
    ends_at: Optional[datetime] = None
    note: Optional[str] = None

    @field_validator("ends_at")
    @classmethod
    def _normalize_tz2(cls, v: Optional[datetime]) -> Optional[datetime]:
        return _to_bolivia_naive(v)


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
    patient_photo_url: Optional[str] = None
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
    patient_photo_url: Optional[str] = None
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


# ─────────────────────────────────────────────────────
# CONTACTO (formulario público "Contáctanos" — landing)
# ─────────────────────────────────────────────────────

CONTACT_INQUIRY_TYPES = ("PACIENTE", "PROFESIONAL", "SOPORTE", "FACTURACION", "OTRO")


class ContactInquiryCreateRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=200)
    # Ciudad boliviana elegida de la lista del frontend. Requerida solo
    # cuando country es "Bolivia" (ver validador abajo) — si la persona
    # tildó "otro país", este campo queda vacío y lo que importa es country.
    city: Optional[str] = Field(None, max_length=100)
    country: str = Field(default="Bolivia", max_length=100)
    # El frontend ya concatena código de país + número (mismo PhoneInput
    # que registro/login), por eso se valida igual que ahí.
    phone: str = Field(..., min_length=8, max_length=17, description="Código de país + número, ej: 59172345678")
    email: Optional[EmailStr] = None
    inquiry_type: str = Field(..., description="PACIENTE | PROFESIONAL | SOPORTE | FACTURACION | OTRO")
    message: str = Field(..., min_length=5, max_length=3000)
    # Honeypot anti-spam: campo oculto en el frontend que una persona real
    # nunca completa (no lo ve). Los bots que autorellenan formularios sí
    # suelen llenarlo. Si llega con algo, el endpoint corta silenciosamente
    # (ver contact.py) sin guardar ni avisar por correo.
    website: str = Field(default="", max_length=200)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        try:
            return normalize_intl_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))

    @field_validator("full_name", "message")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return v.strip()

    @field_validator("inquiry_type")
    @classmethod
    def validate_inquiry_type(cls, v: str) -> str:
        if v not in CONTACT_INQUIRY_TYPES:
            raise ValueError(f"Tipo de consulta inválido. Debe ser uno de: {', '.join(CONTACT_INQUIRY_TYPES)}")
        return v

    @model_validator(mode="after")
    def require_city_when_bolivia(self) -> "ContactInquiryCreateRequest":
        country_clean = (self.country or "Bolivia").strip() or "Bolivia"
        self.country = country_clean
        if country_clean == "Bolivia" and not (self.city and self.city.strip()):
            raise ValueError("Seleccioná una ciudad de la lista, o elegí 'Otro país' para escribirlo.")
        if self.city:
            self.city = self.city.strip()
        return self


class ContactInquiryResponse(BaseModel):
    id: str
    full_name: str
    city: Optional[str]
    country: str
    phone: str
    email: Optional[str]
    inquiry_type: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────────────
# CHAT INTERNO (paciente ↔ profesional)
# ─────────────────────────────────────────────────────

class ChatParticipantResponse(BaseModel):
    user_id: str
    full_name: str
    photo_url: Optional[str] = None

    model_config = {"from_attributes": True}


class ChatConversationResponse(BaseModel):
    id: str
    consultation_id: str
    status: str
    expires_at: Optional[datetime]
    last_message_at: Optional[datetime]
    last_message_preview: Optional[str]
    other_participant: ChatParticipantResponse
    created_at: datetime
    # True si YO (el usuario autenticado que pide esto) tengo activo un
    # bloqueo de ese scope contra el otro participante. Le permite al
    # frontend mostrar "Desbloquear" en vez de "Bloquear" sin tener que
    # hacer una llamada aparte.
    my_active_block_contact: bool = False
    my_active_block_global: bool = False

    model_config = {"from_attributes": True}


class ChatMessageResponse(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    content: Optional[str]
    attachment_url: Optional[str] = None  # URL firmada, se resuelve al armar la respuesta
    attachment_content_type: Optional[str] = None
    read_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


class ChatAttachmentUploadResponse(BaseModel):
    message: ChatMessageResponse


REASON_CATEGORIES = (
    "HARASSMENT", "INAPPROPRIATE_CONTENT", "SPAM",
    "PROFESSIONAL_MISCONDUCT", "NO_SHOW_OR_ABUSE", "OTHER",
)


class ChatGlobalBlockRequest(BaseModel):
    """Body de POST /chat/block-all — bloqueo GLOBAL, no depende de
    ninguna conversación puntual, se activa desde el listado general
    de Mensajes."""
    is_reported: bool = False
    reason_category: Optional[str] = Field(None, description="Solo si is_reported=True")
    reason_text: Optional[str] = Field(None, max_length=1000)

    @field_validator("reason_category")
    @classmethod
    def validate_reason_category(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in REASON_CATEGORIES:
            raise ValueError(f"reason_category debe ser uno de {REASON_CATEGORIES}")
        return v


class ChatGlobalBlockStatusResponse(BaseModel):
    blocked: bool


class ChatBlockRequest(BaseModel):
    scope: str = Field(..., description='"CONTACT" o "GLOBAL"')
    # Bloquear y reportar son independientes: is_reported=False solo
    # corta el chat, sin avisar al admin.
    is_reported: bool = False
    reason_category: Optional[str] = Field(None, description="Solo si is_reported=True")
    reason_text: Optional[str] = Field(None, max_length=1000)

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, v: str) -> str:
        if v not in ("CONTACT", "GLOBAL"):
            raise ValueError('scope debe ser "CONTACT" o "GLOBAL"')
        return v

    @field_validator("reason_category")
    @classmethod
    def validate_reason_category(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in REASON_CATEGORIES:
            raise ValueError(f"reason_category debe ser uno de {REASON_CATEGORIES}")
        return v


class ChatBlockResponse(BaseModel):
    id: str
    scope: str
    blocked_id: Optional[str]
    is_reported: bool
    reason_category: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class PatientBlockRequest(BaseModel):
    """Bloqueo INTEGRAL desde 'Mis Pacientes' (solo profesional -> paciente)."""
    is_reported: bool = False
    reason_category: Optional[str] = Field(None, description="Solo si is_reported=True")
    reason_text: Optional[str] = Field(None, max_length=1000)

    @field_validator("reason_category")
    @classmethod
    def validate_reason_category(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in REASON_CATEGORIES:
            raise ValueError(f"reason_category debe ser uno de {REASON_CATEGORIES}")
        return v


class PatientBlockResponse(BaseModel):
    id: str
    patient_id: str
    hidden: bool
    is_reported: bool
    reason_category: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# Actualizar referencias forward
TokenResponse.model_rebuild()