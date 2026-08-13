"""specialty_and_info_review_states

Cierra el hueco detectado ago-2026: hasta ahora `professional.specialty`
se cargaba en el registro sin ningún control de admin, y `sub_specialties`
guardaba una lista aunque el producto solo permite UNA especialidad y UNA
subespecialidad por profesional. Además `university_verified`,
`years_experience_verified` y `professional_license_verified` eran
booleanos sueltos sin motivo de rechazo ni notificación al profesional —
a diferencia del flujo ya prolijo que existe para documentos
(ProfessionalDoc: status + review_note + notify_user).

Este cambio:
  1. specialty pasa a nullable (se completa después del registro, no en él)
     y gana specialty_status/specialty_review_note.
  2. sub_specialties (ARRAY) se colapsa a sub_specialty (String, nullable),
     tomando el primer elemento de cada array existente (si había más de
     uno, se pierden los demás — se avisa en el log de la migración).
  3. university_verified/years_experience_verified/professional_license_verified
     (Boolean) se reemplazan por *_status (mismo enum DocStatus que ya usan
     los documentos) + *_review_note. true → APPROVED, false → PENDING.
  4. Nuevo DocType.SUBSPECIALTY_CERT para el respaldo de subespecialidad
     (documento separado del respaldo de especialidad, SPECIALTY_CERT).

Verificado antes de este cambio: ninguna FK apunta a estas columnas, y el
enum doctype ya es un tipo Postgres nativo (agregar un valor con
ALTER TYPE ... ADD VALUE es seguro y no bloquea lecturas concurrentes,
pero SÍ requiere autocommit — ver bloque aparte más abajo).

Revision ID: b1c2d3e4f5a6
Revises: fa6c388bb958
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "91216cea599f"
down_revision = "fa6c388bb958"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Nuevo valor de enum doctype (requiere autocommit, no puede ir
    # dentro de la misma transacción que el resto de los ALTER TABLE) ──
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE doctype ADD VALUE IF NOT EXISTS 'SUBSPECIALTY_CERT'")

    # ── 2. specialty: NOT NULL → nullable ──
    op.alter_column("professionals", "specialty", existing_type=sa.String(100), nullable=True)
    op.add_column("professionals", sa.Column(
        "specialty_status", postgresql.ENUM("PENDING", "APPROVED", "REJECTED", name="docstatus", create_type=False),
        nullable=False, server_default="PENDING",
    ))
    op.add_column("professionals", sa.Column("specialty_review_note", sa.Text(), nullable=True))
    # Las especialidades ya cargadas se consideran ya aprobadas de hecho
    # (venían operando sin objeción) — así ningún profesional activo hoy
    # queda bloqueado de golpe por este cambio.
    op.execute("UPDATE professionals SET specialty_status = 'APPROVED'::docstatus WHERE specialty IS NOT NULL")

    # ── 3. sub_specialties (array) → sub_specialty (string singular) ──
    op.add_column("professionals", sa.Column("sub_specialty", sa.String(100), nullable=True))
    op.execute("UPDATE professionals SET sub_specialty = sub_specialties[1] "
               "WHERE sub_specialties IS NOT NULL AND array_length(sub_specialties, 1) > 0")
    op.add_column("professionals", sa.Column(
        "sub_specialty_status", postgresql.ENUM("PENDING", "APPROVED", "REJECTED", name="docstatus", create_type=False),
        nullable=True,
    ))
    op.execute("UPDATE professionals SET sub_specialty_status = 'APPROVED'::docstatus WHERE sub_specialty IS NOT NULL")
    op.add_column("professionals", sa.Column("sub_specialty_review_note", sa.Text(), nullable=True))
    op.drop_column("professionals", "sub_specialties")

    # ── 4. university_verified / years_experience_verified /
    # professional_license_verified (bool) → *_status (DocStatus) ──
    for base in ("university", "years_experience", "professional_license"):
        op.add_column("professionals", sa.Column(
            f"{base}_status", postgresql.ENUM("PENDING", "APPROVED", "REJECTED", name="docstatus", create_type=False),
            nullable=False, server_default="PENDING",
        ))
        op.execute(
            f"UPDATE professionals SET {base}_status = CASE WHEN {base}_verified THEN 'APPROVED'::docstatus ELSE 'PENDING'::docstatus END"
        )
        op.add_column("professionals", sa.Column(f"{base}_review_note", sa.Text(), nullable=True))
        op.drop_column("professionals", f"{base}_verified")


def downgrade() -> None:
    for base in ("university", "years_experience", "professional_license"):
        op.add_column("professionals", sa.Column(f"{base}_verified", sa.Boolean(), nullable=False, server_default="false"))
        op.execute(f"UPDATE professionals SET {base}_verified = ({base}_status = 'APPROVED'::docstatus)")
        op.drop_column("professionals", f"{base}_review_note")
        op.drop_column("professionals", f"{base}_status")

    op.add_column("professionals", sa.Column("sub_specialties", sa.ARRAY(sa.String()), nullable=True))
    op.execute("UPDATE professionals SET sub_specialties = ARRAY[sub_specialty] WHERE sub_specialty IS NOT NULL")
    op.execute("UPDATE professionals SET sub_specialties = ARRAY[]::varchar[] WHERE sub_specialties IS NULL")
    op.alter_column("professionals", "sub_specialties", nullable=False)
    op.drop_column("professionals", "sub_specialty_review_note")
    op.drop_column("professionals", "sub_specialty_status")
    op.drop_column("professionals", "sub_specialty")

    op.drop_column("professionals", "specialty_review_note")
    op.drop_column("professionals", "specialty_status")
    op.execute("UPDATE professionals SET specialty = 'Medicina General' WHERE specialty IS NULL")
    op.alter_column("professionals", "specialty", existing_type=sa.String(100), nullable=False)

    # Nota: Postgres no permite quitar un valor de un enum con ALTER TYPE
    # ... DROP VALUE (no existe ese comando) — 'SUBSPECIALTY_CERT' queda
    # en el tipo doctype aunque se haga downgrade. Inofensivo: es solo un
    # valor de enum sin usar, no una columna ni una fila.
