"""add_final_name_to_specialty_proposals

Hasta ahora, cuando un admin aprobaba una propuesta corrigiendo el nombre
(ej. profesional propuso "Neurodesarrollo", admin aprobó como
"Neurodesarrollo Infantojuvenil"), ese nombre final solo quedaba guardado
en AuditLog.metadata_["final_name"] — invisible para el frontend salvo
que alguien fuera a buscar el log a mano. Esto agrega una columna
persistente en specialty_proposals para poder mostrarlo directo.

Backfill: para propuestas ya APPROVED, se recupera el final_name real
desde el AuditLog más reciente de acción SPECIALTY_PROPOSAL_APPROVED para
esa propuesta (si existe y trae final_name en el metadata). Si no hay
AuditLog o no trae ese campo, se asume que se aprobó tal cual se propuso
(final_name = proposed_name) — mismo criterio que ya usa el código nuevo
cuando data.final_name no viene en el request (ver review_proposal en
specialties.py: `final_name = data.final_name or proposal.proposed_name`).

Revision ID: c5d6e7f8a9b0
Revises: 91216cea599f
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "c5d6e7f8a9b0"
down_revision = "91216cea599f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "specialty_proposals",
        sa.Column("final_name", sa.String(100), nullable=True),
    )

    # Backfill desde AuditLog para propuestas ya aprobadas. Se castea
    # audit_logs.entity_id (varchar) contra specialty_proposals.id (uuid
    # nativo) con ::text, mismo patrón usado en la migración anterior
    # (fa6c388bb958) para evitar el error de tipos uuid = varchar.
    #
    # OJO: audit_logs.metadata_ es el atributo Python — la columna real en
    # la base es "metadata" (ver mapped_column("metadata", JSON) en
    # models.py). Además es JSON genérico, no JSONB, así que el operador
    # `?` de existencia de key (jsonb-only) rompería acá; se usa
    # `->> 'final_name' IS NOT NULL` en su lugar, que sirve para json y jsonb.
    op.execute("""
        UPDATE specialty_proposals sp
        SET final_name = COALESCE(
            (
                SELECT al.metadata ->> 'final_name'
                FROM audit_logs al
                WHERE al.entity_type = 'SpecialtyProposal'
                  AND al.entity_id = sp.id::text
                  AND al.action = 'SPECIALTY_PROPOSAL_APPROVED'
                  AND al.metadata ->> 'final_name' IS NOT NULL
                ORDER BY al.created_at DESC
                LIMIT 1
            ),
            sp.proposed_name
        )
        WHERE sp.status = 'APPROVED'
    """)


def downgrade() -> None:
    op.drop_column("specialty_proposals", "final_name")
