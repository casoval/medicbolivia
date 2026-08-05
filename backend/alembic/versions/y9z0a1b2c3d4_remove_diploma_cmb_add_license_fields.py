"""remove ACADEMIC_DIPLOMA/CMB_MATRICULA doc types, add license/university fields

Dos cambios pedidos para simplificar la verificación de profesionales:

1) Se retiran de la plataforma los tipos de documento ACADEMIC_DIPLOMA
   (Diploma académico universitario) y CMB_MATRICULA (Matrícula Colegio
   Médico Bolivia): el Título en Provisión Nacional ya habilita al
   profesional para ejercer, y la Matrícula Profesional del Ministerio de
   Salud (HEALTH_MINISTRY) cubre lo que antes cubría la matrícula del CMB.
   Se borran los documentos ya subidos de esos dos tipos y se recrea el
   enum de Postgres sin esos valores (Postgres no soporta DROP VALUE en
   enums, así que se recrea el tipo).

2) Se agregan a `professionals` los campos que el propio profesional
   llena en su perfil — universidad y matrícula profesional del
   Ministerio de Salud — cada uno con su bandera `_verified` que solo un
   admin puede activar (ver PATCH /admin/professionals/{id}). Mientras no
   estén verificados, o si el profesional los deja vacíos, no se muestran
   en el perfil público. `years_experience` pasa a ser opcional por el
   mismo motivo, y también se agrega `years_experience_verified`.

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'y9z0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'x8y9z0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_DOC_TYPES = (
    'CI_FRONT', 'CI_BACK', 'PROFESSIONAL_TITLE', 'ACADEMIC_DIPLOMA',
    'HEALTH_MINISTRY', 'SEDES_REGISTRATION', 'CMB_MATRICULA',
    'SPECIALTY_CERT', 'SELFIE_WITH_CI',
)
NEW_DOC_TYPES = (
    'CI_FRONT', 'CI_BACK', 'PROFESSIONAL_TITLE',
    'HEALTH_MINISTRY', 'SEDES_REGISTRATION',
    'SPECIALTY_CERT', 'SELFIE_WITH_CI',
)


def upgrade() -> None:
    # ── 1) Nuevos campos verificables en professionals ──
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS years_experience_verified BOOLEAN NOT NULL DEFAULT FALSE
    """)
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS university VARCHAR(200)
    """)
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS university_verified BOOLEAN NOT NULL DEFAULT FALSE
    """)
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS professional_license_number VARCHAR(50)
    """)
    op.execute("""
        ALTER TABLE professionals
        ADD COLUMN IF NOT EXISTS professional_license_verified BOOLEAN NOT NULL DEFAULT FALSE
    """)
    # years_experience ahora es opcional: vacío = "el profesional no lo
    # llenó", distinto de 0. Los valores existentes (incluido 0) se
    # conservan tal cual — quedan ocultos al paciente hasta que un admin
    # los verifique (years_experience_verified nace en FALSE).
    op.execute("ALTER TABLE professionals ALTER COLUMN years_experience DROP NOT NULL")

    # ── 2) Retirar ACADEMIC_DIPLOMA y CMB_MATRICULA de la plataforma ──
    op.execute(f"""
        DELETE FROM professional_docs
        WHERE doc_type IN ('ACADEMIC_DIPLOMA', 'CMB_MATRICULA')
    """)
    op.execute("ALTER TYPE doctype RENAME TO doctype_old")
    new_values = ", ".join(f"'{v}'" for v in NEW_DOC_TYPES)
    op.execute(f"CREATE TYPE doctype AS ENUM ({new_values})")
    op.execute("""
        ALTER TABLE professional_docs
        ALTER COLUMN doc_type TYPE doctype USING doc_type::text::doctype
    """)
    op.execute("DROP TYPE doctype_old")


def downgrade() -> None:
    # ── Revertir el enum ──
    op.execute("ALTER TYPE doctype RENAME TO doctype_new")
    old_values = ", ".join(f"'{v}'" for v in OLD_DOC_TYPES)
    op.execute(f"CREATE TYPE doctype AS ENUM ({old_values})")
    op.execute("""
        ALTER TABLE professional_docs
        ALTER COLUMN doc_type TYPE doctype USING doc_type::text::doctype
    """)
    op.execute("DROP TYPE doctype_new")

    # ── Revertir columnas ──
    op.execute("UPDATE professionals SET years_experience = 0 WHERE years_experience IS NULL")
    op.execute("ALTER TABLE professionals ALTER COLUMN years_experience SET NOT NULL")
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS professional_license_verified")
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS professional_license_number")
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS university_verified")
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS university")
    op.execute("ALTER TABLE professionals DROP COLUMN IF EXISTS years_experience_verified")
