"""add SIGNATURE doc type — firma verificable por admin

La firma que el profesional dibuja o sube en su perfil (Professional.
signature_url) se guardaba hasta ahora sin ninguna revisión: cualquiera
podía subir cualquier imagen y quedaba lista para estamparse en el PDF
imprimible de recetas y órdenes de laboratorio.

Se agrega SIGNATURE al enum `doctype` para que la firma entre al mismo
circuito de verificación que la cédula, el título, etc.: cada vez que el
profesional la sube (POST /professionals/signature o /signature/from-photo)
se crea/reemplaza un ProfessionalDoc de tipo SIGNATURE en estado PENDING,
y un admin debe aprobarlo — igual que cualquier otro documento — antes de
que:
  a) la firma cuente para la aprobación automática del profesional
     (ver required set en PATCH /admin/professionals/documents/{id}), y
  b) el profesional pueda emitir recetas u órdenes de laboratorio (ver
     POST /prescriptions y POST /lab-orders).

Postgres no soporta agregar un valor a un enum dentro de una transacción
junto con otros DDL en la misma migración de forma segura en todas las
versiones, así que se sigue el mismo patrón ya usado en
y9z0a1b2c3d4 (recrear el tipo) para mantener consistencia, en vez de
`ALTER TYPE ... ADD VALUE`.

Revision ID: b3c4d5e6f7a8
Revises: z1a2b3c4d5e6
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'z1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_DOC_TYPES = (
    'CI_FRONT', 'CI_BACK', 'PROFESSIONAL_TITLE',
    'HEALTH_MINISTRY', 'SEDES_REGISTRATION',
    'SPECIALTY_CERT', 'SELFIE_WITH_CI',
)
NEW_DOC_TYPES = OLD_DOC_TYPES + ('SIGNATURE',)


def upgrade() -> None:
    op.execute("ALTER TYPE doctype RENAME TO doctype_old")
    new_values = ", ".join(f"'{v}'" for v in NEW_DOC_TYPES)
    op.execute(f"CREATE TYPE doctype AS ENUM ({new_values})")
    op.execute("""
        ALTER TABLE professional_docs
        ALTER COLUMN doc_type TYPE doctype USING doc_type::text::doctype
    """)
    op.execute("DROP TYPE doctype_old")

    # A los profesionales que YA tienen una firma subida (signature_url no
    # nulo) pero nunca pasaron por revisión, se les crea de entrada un
    # ProfessionalDoc SIGNATURE en PENDING, para que quede en la cola del
    # admin en vez de desaparecer silenciosamente. No se auto-aprueba: la
    # firma nunca fue revisada por nadie hasta ahora, así que le toca la
    # misma cola que a un documento nuevo.
    op.execute("""
        INSERT INTO professional_docs (id, professional_id, doc_type, file_url, status, created_at)
        SELECT gen_random_uuid(), p.id, 'SIGNATURE', p.signature_url, 'PENDING', now()
        FROM professionals p
        WHERE p.signature_url IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM professional_docs d
              WHERE d.professional_id = p.id AND d.doc_type = 'SIGNATURE'
          )
    """)


def downgrade() -> None:
    op.execute("DELETE FROM professional_docs WHERE doc_type = 'SIGNATURE'")
    op.execute("ALTER TYPE doctype RENAME TO doctype_new")
    old_values = ", ".join(f"'{v}'" for v in OLD_DOC_TYPES)
    op.execute(f"CREATE TYPE doctype AS ENUM ({old_values})")
    op.execute("""
        ALTER TABLE professional_docs
        ALTER COLUMN doc_type TYPE doctype USING doc_type::text::doctype
    """)
    op.execute("DROP TYPE doctype_new")
