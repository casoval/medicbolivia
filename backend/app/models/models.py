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


class PrescriptionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    VOIDED = "VOIDED"


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
    # Se cancela una consulta cuyo pago seguía en PENDING (el paciente nunca
    # llegó a pagar el QR). No hubo cobro, así que NUNCA es un "reembolso"
    # — usar REFUNDED_FULL aquí es lo que causaba el bug de mostrar
    # "Reembolso total" en el panel de admin sin que se haya cobrado nada.
    CANCELLED_NO_CHARGE = "CANCELLED_NO_CHARGE"


class AgentType(str, enum.Enum):
    COORDINATOR = "COORDINATOR"
    TRIAGE = "TRIAGE"
    AVAILABILITY = "AVAILABILITY"
    ONBOARDING = "ONBOARDING"
    POST_CONSULTATION = "POST_CONSULTATION"


class ProposalType(str, enum.Enum):
    SPECIALTY = "SPECIALTY"
    SUB_SPECIALTY = "SUB_SPECIALTY"


class ProposalStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


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
    notifications: Mapped[List["Notification"]] = relationship(back_populates="user")


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
    # Si está activo, "availability" se calcula automáticamente comparando la
    # hora actual contra los bloques de Schedule, en vez de depender del
    # botón manual ONLINE_NOW/OFFLINE.
    auto_availability: Mapped[bool] = mapped_column(Boolean, default=False)
    # Duración por defecto de una cita agendada, usada para detectar choques
    # de horario entre citas (el profesional la configura en su plataforma).
    appointment_duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
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
    specialty_proposals: Mapped[List["SpecialtyProposal"]] = relationship(back_populates="professional")


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


class Specialty(Base):
    """
    Catálogo maestro de especialidades médicas.
    Se puebla inicialmente con un seed y crece cuando el admin aprueba
    propuestas nuevas hechas por profesionales (ver SpecialtyProposal).
    """
    __tablename__ = "specialties"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sub_specialties: Mapped[List["SubSpecialty"]] = relationship(back_populates="specialty")


class SubSpecialty(Base):
    """
    Catálogo de subespecialidades, ligadas a una especialidad padre.
    Ej: "Electrofisiología cardíaca" pertenece a "Cardiología".
    """
    __tablename__ = "sub_specialties"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    specialty_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("specialties.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    specialty: Mapped["Specialty"] = relationship(back_populates="sub_specialties")


class SpecialtyProposal(Base):
    """
    Propuesta de especialidad o subespecialidad nueva, hecha por un profesional
    cuando no encuentra la suya en el catálogo. Queda PENDING hasta que un admin
    la apruebe (pasa a formar parte del catálogo) o la rechace/corrija.

    Si type == SUB_SPECIALTY y la especialidad padre también es una propuesta
    nueva (no existe aún en el catálogo), parent_specialty_id queda en null y
    parent_proposal_id apunta a esa otra propuesta — así el admin ve la relación
    aunque ninguna de las dos esté aprobada todavía.
    """
    __tablename__ = "specialty_proposals"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id", ondelete="CASCADE"))
    type: Mapped[ProposalType] = mapped_column(SAEnum(ProposalType), nullable=False)
    proposed_name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Solo aplica si type == SUB_SPECIALTY
    parent_specialty_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("specialties.id"))
    parent_proposal_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("specialty_proposals.id"))

    status: Mapped[ProposalStatus] = mapped_column(SAEnum(ProposalStatus), default=ProposalStatus.PENDING)
    admin_note: Mapped[Optional[str]] = mapped_column(Text)
    reviewed_by: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    professional: Mapped["Professional"] = relationship(back_populates="specialty_proposals")
    parent_specialty: Mapped[Optional["Specialty"]] = relationship(foreign_keys=[parent_specialty_id])


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
    # Propuesta de reprogramación pendiente: cualquiera de las dos partes
    # (paciente o profesional) puede proponer un horario nuevo si la cita
    # original ya no le funciona; la otra parte debe aceptar o rechazar.
    reschedule_proposed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    reschedule_proposed_by: Mapped[Optional[str]] = mapped_column(String(20))  # "PATIENT" | "PROFESSIONAL"
    # Solo se permite UNA reprogramación aceptada por cita (sin importar
    # quién la propuso). Una vez usada, ya no se puede pedir cancelación
    # con devolución por aviso de 24h — solo aplican las reglas de
    # inasistencia (no-show).
    reschedule_used: Mapped[bool] = mapped_column(Boolean, default=False)
    # Cuenta cuántas propuestas de reprogramación se han hecho en total
    # para esta cita (sin importar quién propuso ni si fueron aceptadas
    # o rechazadas). Tope: RESCHEDULE_MAX_ATTEMPTS (3). Evita ciclos
    # indefinidos de propuesta-rechazo entre paciente y profesional.
    reschedule_attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Registro informativo de por qué terminó así (no afecta lógica, solo
    # para que admin/soporte entienda el caso): "PATIENT_NO_SHOW",
    # "PROFESSIONAL_NO_SHOW", "CANCELLED_24H_NOTICE", etc.
    outcome_note: Mapped[Optional[str]] = mapped_column(String(50))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    video_room_id: Mapped[Optional[str]] = mapped_column(String(255))
    video_room_url: Mapped[Optional[str]] = mapped_column(String(500))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    platform_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    professional_earning: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # % de comisión efectivamente aplicado a esta consulta, guardado como foto
    # fija en el momento del cobro. Si más adelante cambia la comisión global
    # o la del profesional, esta consulta NO se recalcula — queda con el %
    # que estaba vigente cuando se generó. Sirve también para que admin y
    # profesional vean con transparencia qué % se cobró en cada caso.
    commission_percent_applied: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
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
    # Copia del % aplicado en la Consultation asociada, para no tener que
    # hacer join solo para mostrar transparencia en reportes de pagos.
    commission_percent_applied: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    qr_code: Mapped[Optional[str]] = mapped_column(Text)
    qr_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    bank_tx_id: Mapped[Optional[str]] = mapped_column(String(100))
    bank_name: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[PaymentStatus] = mapped_column(SAEnum(PaymentStatus), default=PaymentStatus.PENDING)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    refunded_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    refund_note: Mapped[Optional[str]] = mapped_column(Text)
    # Cuánto se devolvió realmente. Para REFUNDED_FULL siempre es == amount;
    # para REFUNDED_PARTIAL es el monto parcial que decidió el admin — antes
    # de este campo, ese dato solo quedaba en el AuditLog y no en el pago.
    refunded_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2))
    # ── Disputas del paciente sobre una consulta ya pagada ──────────────
    dispute_category: Mapped[Optional[str]] = mapped_column(String(50))
    dispute_reason: Mapped[Optional[str]] = mapped_column(Text)
    disputed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    resolution_note: Mapped[Optional[str]] = mapped_column(Text)
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

    # Anulación / reemisión: una receta firmada NUNCA se edita (rompería el
    # hash SHA-256 y el QR que las farmacias verifican). En su lugar se anula
    # y se emite una nueva que la reemplaza, quedando ambas en el historial.
    status: Mapped[str] = mapped_column(String(20), default=PrescriptionStatus.ACTIVE.value)
    voided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    void_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    replaces_prescription_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), ForeignKey("prescriptions.id"), nullable=True
    )

    consultation: Mapped["Consultation"] = relationship(back_populates="prescriptions")
    professional: Mapped["Professional"] = relationship(back_populates="prescriptions")


class ClinicalNote(Base):
    """
    Historia clínica por consulta. El médico la puede crear/editar DURANTE
    la videollamada (status IN_PROGRESS) o justo después (COMPLETED), igual
    que la receta — no depende de acordarse más tarde.

    Control de privacidad (decisión explícita del paciente, no del médico):
      - is_visible_to_patient: si el paciente puede ver esta nota en su
        historial. El médico puede dejar notas internas no visibles.
      - shared_with_professionals: el paciente decide si esta nota puede
        ser vista por OTROS médicos de la plataforma (no solo el que la
        escribió) cuando lo atiendan en el futuro. Por defecto, privada.
      - El médico que escribió la nota siempre puede verla, sin importar
        la configuración de privacidad del paciente.
    """
    __tablename__ = "clinical_notes"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    consultation_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("consultations.id"))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    patient_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("patients.id"))

    # Formato SOAP, estándar en historias clínicas
    subjective: Mapped[Optional[str]] = mapped_column(Text)   # lo que reporta/relata el paciente
    objective: Mapped[Optional[str]] = mapped_column(Text)    # hallazgos, signos observados por el médico
    assessment: Mapped[Optional[str]] = mapped_column(Text)   # impresión clínica (no es diagnóstico formal)
    plan: Mapped[Optional[str]] = mapped_column(Text)         # indicaciones, seguimiento, próximos pasos

    is_visible_to_patient: Mapped[bool] = mapped_column(Boolean, default=True)
    shared_with_professionals: Mapped[bool] = mapped_column(Boolean, default=False)

    # Contador simple de ediciones (no reemplaza al histórico real, que
    # vive en updated_at + los addenda de abajo; sirve para que el
    # frontend pueda mostrar "editado" sin otra consulta).
    edit_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    consultation: Mapped["Consultation"] = relationship()
    professional: Mapped["Professional"] = relationship()
    patient: Mapped["Patient"] = relationship()
    addenda: Mapped[List["ClinicalNoteAddendum"]] = relationship(
        order_by="ClinicalNoteAddendum.created_at", cascade="all, delete-orphan",
        lazy="selectin",
    )


class ClinicalNoteAddendum(Base):
    """
    Corrección o agregado posterior a una historia clínica ya cerrada
    (fuera de la ventana de edición de 24h). Nunca sobreescribe la nota
    original: queda como una entrada nueva, con su propia fecha, visible
    para quien pueda ver la nota original (paciente / médicos con acceso).
    """
    __tablename__ = "clinical_note_addenda"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    clinical_note_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("clinical_notes.id"))
    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    professional: Mapped["Professional"] = relationship()


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

class ProfessionalPenaltyReset(Base):
    """
    Registra cuándo un admin usó "Limpiar penalizaciones" para un
    profesional. El puntaje de penalización solo cuenta consultas
    posteriores a reset_at (si nunca se limpió, cuenta desde siempre).

    Es una tabla aparte —en vez de una columna en Professional— para no
    requerir una migración de esquema sobre una tabla ya existente: al
    ser una tabla nueva, se crea sola con Base.metadata.create_all().
    """
    __tablename__ = "professional_penalty_resets"

    professional_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("professionals.id"), primary_key=True)
    reset_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reset_by_admin_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id"))

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


class Notification(Base):
    """
    Notificación in-app simple. El profesional las ve como campanita en el dashboard.
    Pensada como base: si más adelante se conecta SMS/push real (Twilio, FCM, etc.),
    se dispara desde el mismo punto donde se crea esta fila, sin tocar el resto del flujo.
    """
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # DOC_APPROVED, DOC_REJECTED, etc.
    entity_type: Mapped[Optional[str]] = mapped_column(String(50))
    entity_id: Mapped[Optional[str]] = mapped_column(String(100))
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="notifications")


class CommissionScope(str, enum.Enum):
    GLOBAL = "GLOBAL"              # aplica a todos los profesionales
    PROFESSIONAL = "PROFESSIONAL"  # aplica solo a un profesional puntual


class CommissionPeriod(Base):
    """
    Vigencia de un porcentaje de comisión, con fecha de inicio y (opcional)
    fecha de fin. Permite promociones temporales ("10% este mes, 15% el
    próximo") y comisiones individuales por profesional (por ejemplo, una
    tarifa reducida para nuevos profesionales).

    Resolución de "¿qué % aplica ahora para este profesional?" (ver
    app/services/commission.py):
      1. Período PROFESSIONAL activo y vigente para ese profesional.
      2. Período GLOBAL activo y vigente (el más reciente que cubra "ahora").
      3. PlatformSettings.commission_percent (valor simple de respaldo).

    Las consultas ya creadas NUNCA se recalculan: el % resuelto se guarda
    como foto fija en Consultation/Payment en el momento del cobro.
    """
    __tablename__ = "commission_periods"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    scope: Mapped[CommissionScope] = mapped_column(SAEnum(CommissionScope), nullable=False)
    professional_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), ForeignKey("professionals.id", ondelete="CASCADE"), nullable=True
    )
    percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)  # 10.00 = 10%
    label: Mapped[Optional[str]] = mapped_column(String(150))  # ej. "Promo lanzamiento julio"
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # Si es NULL, el período queda vigente indefinidamente hasta que se
    # desactive o se cree otro período más reciente que lo reemplace.
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, onupdate=datetime.utcnow, default=datetime.utcnow)

    professional: Mapped[Optional["Professional"]] = relationship()


class PlatformSettings(Base):
    """
    Configuración global de la plataforma. Fila única con id fijo "global".
    Se crea automáticamente con valores por defecto la primera vez que se consulta
    (ver _get_or_create_settings en admin.py).
    """
    __tablename__ = "platform_settings"

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default="global")
    app_name: Mapped[str] = mapped_column(String(100), nullable=False, default="MedicBolivia")
    commission_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    open_registration_patients: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    open_registration_professionals: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    maintenance_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    alert_no_response: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alert_daily_report: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alert_pending_payment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alert_low_rating: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    alert_new_professional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, onupdate=datetime.utcnow, default=datetime.utcnow)


class FAQAudience(str, enum.Enum):
    GENERAL = "GENERAL"
    PATIENT = "PATIENT"
    PROFESSIONAL = "PROFESSIONAL"


class FAQ(Base):
    """
    Pregunta frecuente mostrada en la página pública (landing). El admin las
    gestiona desde el panel; se agrupan por audience para mostrar pestañas
    "General / Paciente / Profesional" en la sección de FAQ del sitio.

    Usamos String en vez de SAEnum para audience — igual que
    Prescription.status — para no depender de un tipo ENUM nativo de
    Postgres en la migración.
    """
    __tablename__ = "faqs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    question: Mapped[str] = mapped_column(String(300), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(String(20), nullable=False, default=FAQAudience.GENERAL.value)
    # Orden de aparición dentro de su audience (menor = primero). El admin lo
    # edita a mano desde el panel; no hay drag-and-drop, solo un número.
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────────────
# MÓDULO IA / WHATSAPP — panel admin de 4 pestañas:
# (1) monitor del bot, (2) recordatorios automáticos,
# (3) conversaciones + on/off del agente, (4) backups a Gmail.
#
# audience/direction/status usan String en vez de SAEnum, siguiendo el
# mismo criterio que FAQ.audience y Prescription.status: evita depender
# de un tipo ENUM nativo de Postgres y sumar valores nuevos sin migración
# de tipo (solo ALTER de check constraint si se agrega validación).
# ─────────────────────────────────────────────────────

class WhatsAppAudience(str, enum.Enum):
    PATIENT = "PATIENT"
    PROFESSIONAL = "PROFESSIONAL"
    ADMIN = "ADMIN"
    PUBLIC = "PUBLIC"          # número que escribe y no está registrado en la plataforma


class WhatsAppConversation(Base):
    """
    Una fila por número de contacto (WhatsApp no tiene "hilos", el contacto
    ES el hilo). Si el número coincide con un User existente, se linkea;
    si no, queda como PUBLIC con user_id nulo (lead / consulta general).
    """
    __tablename__ = "whatsapp_conversations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    audience: Mapped[str] = mapped_column(String(20), nullable=False, default=WhatsAppAudience.PUBLIC.value)
    contact_name: Mapped[Optional[str]] = mapped_column(String(150))
    # El agente IA responde automáticamente en esta conversación puntual.
    # Además del switch global (AgentConfig.is_active), permite que un
    # admin tome el control manual de un chat específico sin apagar el
    # bot para todos los demás contactos.
    agent_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    last_message_preview: Mapped[Optional[str]] = mapped_column(String(300))
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped[Optional["User"]] = relationship()
    messages: Mapped[List["WhatsAppMessage"]] = relationship(back_populates="conversation", order_by="WhatsAppMessage.created_at")


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("whatsapp_conversations.id", ondelete="CASCADE"), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)   # "IN" | "OUT"
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # "BOT" = lo mandó el agente IA, "ADMIN" = lo mandó un humano desde el
    # panel, "SYSTEM" = recordatorio/notificación automática, null en "IN".
    sent_by: Mapped[Optional[str]] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SENT")  # SENT|DELIVERED|READ|FAILED
    error_detail: Mapped[Optional[str]] = mapped_column(String(300))
    # Referencia opcional a qué disparó el mensaje (ej. Consultation, ReminderRule)
    related_entity_type: Mapped[Optional[str]] = mapped_column(String(50))
    related_entity_id: Mapped[Optional[str]] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    conversation: Mapped["WhatsAppConversation"] = relationship(back_populates="messages")


class AgentConfig(Base):
    """
    Configuración persistida del agente IA de WhatsApp. Fila única
    id="global" (mismo patrón que PlatformSettings). Reemplaza los
    switches decorativos que hoy son solo UI estática en /admin/agent.
    """
    __tablename__ = "agent_config"

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default="global")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Guardrail anti-diagnóstico: intencionalmente no editable desde la UI,
    # pero se guarda igual para que quede auditado si alguna vez se cambia
    # directo en BD.
    guardrail_diagnosis_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_reply_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)   # responde a números no registrados
    auto_reply_patients: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_reply_professionals: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    business_hours_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReminderTriggerType(str, enum.Enum):
    IMMEDIATE_CONSULTATION_WAITING = "IMMEDIATE_CONSULTATION_WAITING"   # evento: paciente esperando (no usa offset)
    SCHEDULED_APPOINTMENT_REMINDER = "SCHEDULED_APPOINTMENT_REMINDER"   # cron: X min antes de scheduled_at
    PAYMENT_PENDING = "PAYMENT_PENDING"
    PRESCRIPTION_ISSUED = "PRESCRIPTION_ISSUED"
    RATING_REQUEST = "RATING_REQUEST"
    CUSTOM = "CUSTOM"


class ReminderRule(Base):
    """
    Regla de recordatorio/aviso automático. Dos modos según trigger_type:
      - Basado en evento (ej. IMMEDIATE_CONSULTATION_WAITING): se dispara
        al instante desde el mismo punto del código donde ocurre el evento
        (ver app/services/notify.py), offset_minutes se ignora.
      - Basado en cron (ej. SCHEDULED_APPOINTMENT_REMINDER): un beat de
        Celery revisa periódicamente citas próximas y dispara cuando faltan
        offset_minutes para scheduled_at.
    """
    __tablename__ = "reminder_rules"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(50), nullable=False)
    audience: Mapped[str] = mapped_column(String(20), nullable=False)   # PATIENT|PROFESSIONAL|ADMIN
    channel: Mapped[str] = mapped_column(String(20), nullable=False, default="WHATSAPP")  # WHATSAPP|EMAIL|BOTH
    offset_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    message_template: Mapped[str] = mapped_column(Text, nullable=False)  # admite {paciente}, {profesional}, {fecha}, {hora}
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    logs: Mapped[List["ReminderLog"]] = relationship(back_populates="rule")


class ReminderLog(Base):
    __tablename__ = "reminder_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    rule_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("reminder_rules.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    related_entity_type: Mapped[Optional[str]] = mapped_column(String(50))
    related_entity_id: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SENT")  # SENT|FAILED|SKIPPED
    error_detail: Mapped[Optional[str]] = mapped_column(String(300))
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rule: Mapped["ReminderRule"] = relationship(back_populates="logs")


class DBBackupConfig(Base):
    """Configuración única (id="global") de los backups automáticos por Gmail."""
    __tablename__ = "db_backup_config"

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default="global")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="DAILY")  # DAILY|WEEKLY
    hour_utc: Mapped[int] = mapped_column(Integer, nullable=False, default=8)  # hora UTC de ejecución
    recipient_emails: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    include_full_dump: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DBBackupLog(Base):
    __tablename__ = "db_backup_logs"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SUCCESS")  # SUCCESS|FAILED
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer)
    recipients: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    error_detail: Mapped[Optional[str]] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)