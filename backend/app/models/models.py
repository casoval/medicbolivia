"""
app/models/models.py
Modelos de base de datos con SQLAlchemy ORM.
Corresponde exactamente al esquema diseñado para MedicBolivia.
"""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from sqlalchemy import (
    String, Boolean, DateTime, Numeric, Integer,
    Text, ForeignKey, Enum as SAEnum, JSON, ARRAY
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import enum

from app.db.database import Base


# ─────────────────────────────────────────────────────
# ENUMS
# ─────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    PATIENT = "PATIENT"
    PROFESSIONAL = "PROFESSIONAL"
    ADMIN = "ADMIN"


class UserStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    SUSPENDED = "SUSPENDED"
    PENDING_VERIFICATION = "PENDING_VERIFICATION"


class ProfessionalStatus(str, enum.Enum):
    PENDING_DOCS = "PENDING_DOCS"
    UNDER_REVIEW = "UNDER_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"


class AvailabilityMode(str, enum.Enum):
    ONLINE_NOW = "ONLINE_NOW"
    SCHEDULED_ONLY = "SCHEDULED_ONLY"
    OFFLINE = "OFFLINE"


class DocType(str, enum.Enum):
    CI_FRONT = "CI_FRONT"
    CI_BACK = "CI_BACK"
    PROFESSIONAL_TITLE = "PROFESSIONAL_TITLE"
    ACADEMIC_DIPLOMA = "ACADEMIC_DIPLOMA"
    HEALTH_MINISTRY = "HEALTH_MINISTRY"
    SEDES_REGISTRATION = "SEDES_REGISTRATION"
    CMB_MATRICULA = "CMB_MATRICULA"
    SPECIALTY_CERT = "SPECIALTY_CERT"
    SELFIE_WITH_CI = "SELFIE_WITH_CI"


class DocStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class ConsultationStatus(str, enum.Enum):
    AGENT_TRIAGING = "AGENT_TRIAGING"
    PROFESSIONAL_ACCEPTED = "PROFESSIONAL_ACCEPTED"
    WAITING_PAYMENT = "WAITING_PAYMENT"
    PAYMENT_CONFIRMED = "PAYMENT_CONFIRMED"
    WAITING_PROFESSIONAL = "WAITING_PROFESSIONAL"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    REFUNDED = "REFUNDED"


class ConsultationType(str, enum.Enum):
    IMMEDIATE = "IMMEDIATE"
    SCHEDULED = "SCHEDULED"
    FOLLOW_UP = "FOLLOW_UP"


class PaymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    RELEASED_TO_PROFESSIONAL = "RELEASED_TO_PROFESSIONAL"
    REFUNDED_PARTIAL = "REFUNDED_PARTIAL"
    REFUNDED_FULL = "REFUNDED_FULL"
    DISPUTED = "DISPUTED"


class AgentType(str, enum.Enum):
    COORDINATOR = "COORDINATOR"
    TRIAGE = "TRIAGE"
    AVAILABILITY = "AVAILABILITY"
    ONBOARDING = "ONBOARDING"
    POST_CONSULTATION = "POST_CONSULTATION"


# ─────────────────────────────────────────────────────
# MODELOS
# ─────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True,
        default=lambda: str(uuid.uuid4())
    )
    phone: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    status: Mapped[UserStatus] = mapped_column(
        SAEnum(UserStatus), default=UserStatus.ACTIVE
    )
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relaciones
    patient: Mapped[Optional["Patient"]] = relationship(back_populates="user", uselist=False)
    professional: Mapped[Optional["Professional"]] = relationship(back_populates="user", uselist=False)
    admin: Mapped[Optional["Admin"]] = relationship(back_populates="user", uselist=False)
    audit_logs: Mapped[List["AuditLog"]] = relationship(back_populates="user")


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    ci: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    birth_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    department: Mapped[str] = mapped_column(String(50), nullable=False)
    gender: Mapped[Optional[str]] = mapped_column(String(20))
    allergies: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    chronic_conditions: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    current_medications: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="patient")
    consultations: Mapped[List["Consultation"]] = relationship(back_populates="patient")
    ratings: Mapped[List["Rating"]] = relationship(back_populates="patient")
    payments: Mapped[List["Payment"]] = relationship(back_populates="patient")


class Professional(Base):
    __tablename__ = "professionals"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    ci: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    birth_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    specialty: Mapped[str] = mapped_column(String(100), nullable=False)
    sub_specialties: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    bio: Mapped[Optional[str]] = mapped_column(Text)
    languages: Mapped[List[str]] = mapped_column(ARRAY(String), default=lambda: ["Español"])
    years_experience: Mapped[int] = mapped_column(Integer, default=0)
    photo_url: Mapped[Optional[str]] = mapped_column(String(500))
    status: Mapped[ProfessionalStatus] = mapped_column(SAEnum(ProfessionalStatus), default=ProfessionalStatus.PENDING_DOCS)
    availability: Mapped[AvailabilityMode] = mapped_column(SAEnum(AvailabilityMode), default=AvailabilityMode.OFFLINE)
    price_general: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=100)
    price_urgent: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=150)
    price_follow_up: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=80)
    average_rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=0)
    total_ratings: Mapped[int] = mapped_column(Integer, default=0)
    total_consultations: Mapped[int] = mapped_column(Integer, default=0)
    cmb_matricula: Mapped[Optional[str]] = mapped_column(String(50))
    sedes_number: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="professional")
    documents: Mapped[List["ProfessionalDoc"]] = relationship(back_populates="professional")
    schedules: Mapped[List["Schedule"]] = relationship(back_populates="professional")
    consultations: Mapped[List["Consultation"]] = relationship(back_populates="professional")
    ratings: Mapped[List["Rating"]] = relationship(back_populates="professional")
    prescriptions: Mapped[List["Prescription"]] = relationship(back_populates="professional")
    earnings: Mapped[List["Earning"]] = relationship(back_populates="professional")


class ProfessionalDoc(Base):
    __tablename__ = "professional_docs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id", ondelete="CASCADE"))
    doc_type: Mapped[DocType] = mapped_column(SAEnum(DocType), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[DocStatus] = mapped_column(SAEnum(DocStatus), default=DocStatus.PENDING)
    review_note: Mapped[Optional[str]] = mapped_column(Text)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    reviewed_by: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    professional: Mapped["Professional"] = relationship(back_populates="documents")


class Schedule(Base):
    __tablename__ = "schedules"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id", ondelete="CASCADE"))
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Domingo..6=Sábado
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)  # "08:00"
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)    # "18:00"
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    professional: Mapped["Professional"] = relationship(back_populates="schedules")


class Consultation(Base):
    __tablename__ = "consultations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("patients.id"))
    professional_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    consultation_type: Mapped[ConsultationType] = mapped_column(SAEnum(ConsultationType), default=ConsultationType.IMMEDIATE)
    status: Mapped[ConsultationStatus] = mapped_column(SAEnum(ConsultationStatus), default=ConsultationStatus.AGENT_TRIAGING)
    specialty: Mapped[Optional[str]] = mapped_column(String(100))
    chief_complaint: Mapped[Optional[str]] = mapped_column(Text)
    agent_summary: Mapped[Optional[str]] = mapped_column(Text)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    video_room_id: Mapped[Optional[str]] = mapped_column(String(255))
    video_room_url: Mapped[Optional[str]] = mapped_column(String(500))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    platform_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    professional_earning: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    patient: Mapped["Patient"] = relationship(back_populates="consultations")
    professional: Mapped[Optional["Professional"]] = relationship(back_populates="consultations")
    payment: Mapped[Optional["Payment"]] = relationship(back_populates="consultation", uselist=False)
    prescriptions: Mapped[List["Prescription"]] = relationship(back_populates="consultation")
    rating: Mapped[Optional["Rating"]] = relationship(back_populates="consultation", uselist=False)
    agent_logs: Mapped[List["AgentLog"]] = relationship(back_populates="consultation")
    derivations: Mapped[List["Derivation"]] = relationship(back_populates="consultation")


class Derivation(Base):
    __tablename__ = "derivations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    consultation_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("consultations.id"))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    notified_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    accepted: Mapped[Optional[bool]] = mapped_column(Boolean)
    reason: Mapped[Optional[str]] = mapped_column(String(255))

    consultation: Mapped["Consultation"] = relationship(back_populates="derivations")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    consultation_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("consultations.id"), unique=True)
    patient_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("patients.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    platform_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    professional_net: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    qr_code: Mapped[Optional[str]] = mapped_column(Text)
    qr_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    bank_tx_id: Mapped[Optional[str]] = mapped_column(String(100))
    bank_name: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[PaymentStatus] = mapped_column(SAEnum(PaymentStatus), default=PaymentStatus.PENDING)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    refunded_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    refund_note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    consultation: Mapped["Consultation"] = relationship(back_populates="payment")
    patient: Mapped["Patient"] = relationship(back_populates="payments")
    earning: Mapped[Optional["Earning"]] = relationship(back_populates="payment", uselist=False)


class Earning(Base):
    __tablename__ = "earnings"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    payment_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("payments.id"), unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    professional: Mapped["Professional"] = relationship(back_populates="earnings")
    payment: Mapped["Payment"] = relationship(back_populates="earning")


class Prescription(Base):
    __tablename__ = "prescriptions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    consultation_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("consultations.id"))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    patient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    patient_ci: Mapped[str] = mapped_column(String(20), nullable=False)
    patient_age: Mapped[int] = mapped_column(Integer, nullable=False)
    medications: Mapped[dict] = mapped_column(JSON, nullable=False)  # Lista de medicamentos
    instructions: Mapped[Optional[str]] = mapped_column(Text)
    digital_hash: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    qr_verify_code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    pdf_url: Mapped[Optional[str]] = mapped_column(String(500))
    signed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    consultation: Mapped["Consultation"] = relationship(back_populates="prescriptions")
    professional: Mapped["Professional"] = relationship(back_populates="prescriptions")


class Rating(Base):
    __tablename__ = "ratings"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    consultation_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("consultations.id"), unique=True)
    patient_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("patients.id"))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    score: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-5
    comment: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    consultation: Mapped["Consultation"] = relationship(back_populates="rating")
    patient: Mapped["Patient"] = relationship(back_populates="ratings")
    professional: Mapped["Professional"] = relationship(back_populates="ratings")


class AgentLog(Base):
    __tablename__ = "agent_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    consultation_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("consultations.id"))
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    agent_type: Mapped[AgentType] = mapped_column(SAEnum(AgentType), nullable=False)
    session_id: Mapped[str] = mapped_column(String(100), nullable=False)
    user_message: Mapped[Optional[str]] = mapped_column(Text)
    agent_response: Mapped[Optional[str]] = mapped_column(Text)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer)
    guardrail_triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    consultation: Mapped[Optional["Consultation"]] = relationship(back_populates="agent_logs")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String(50))
    entity_id: Mapped[Optional[str]] = mapped_column(String(100))
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped[Optional["User"]] = relationship(back_populates="audit_logs")


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="admin")
