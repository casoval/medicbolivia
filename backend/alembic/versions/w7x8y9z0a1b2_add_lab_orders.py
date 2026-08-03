"""add lab_orders table

Órdenes de laboratorio digitales — documento separado de Prescription,
mismo patrón de firma (hash SHA-256 + QR verificable + anulación/reemisión,
nunca se edita). Ver LabOrder en app/models/models.py y
app/api/v1/endpoints/lab_orders.py.

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-08-02
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'w7x8y9z0a1b2'
down_revision: Union[str, Sequence[str], None] = 'v6w7x8y9z0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE laborderurgency AS ENUM ('ROUTINE', 'URGENT');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS lab_orders (
            id UUID PRIMARY KEY,
            consultation_id UUID NOT NULL REFERENCES consultations(id),
            professional_id UUID NOT NULL REFERENCES professionals(id),
            patient_name VARCHAR(200) NOT NULL,
            patient_ci VARCHAR(20) NOT NULL,
            patient_age INTEGER NOT NULL,
            tests JSON NOT NULL,
            clinical_indication TEXT,
            fasting_required BOOLEAN NOT NULL DEFAULT FALSE,
            urgency laborderurgency NOT NULL DEFAULT 'ROUTINE',
            instructions TEXT,
            digital_hash VARCHAR(256) NOT NULL UNIQUE,
            qr_verify_code VARCHAR(100) NOT NULL UNIQUE,
            pdf_url VARCHAR(500),
            signed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            voided_at TIMESTAMP WITHOUT TIME ZONE,
            void_reason TEXT,
            replaces_lab_order_id UUID REFERENCES lab_orders(id)
        )
    """)

    op.execute("CREATE INDEX IF NOT EXISTS ix_lab_orders_consultation_id ON lab_orders(consultation_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_lab_orders_professional_id ON lab_orders(professional_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS lab_orders")
    op.execute("DROP TYPE IF EXISTS laborderurgency")
