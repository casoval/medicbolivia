"""add currency and bank_qr_id to payments (Banco Ganadero QR v1.7)

Suma los dos campos que necesita la integración real con el banco:
- currency: moneda ISO 4217 de la transacción (BOB/USD). Antes no se
  registraba explícito en ningún lado — se asumía BOB implícito.
- bank_qr_id: el qrId que devuelve el banco al generar la orden de cobro
  (POST /qrcode/collections). Se necesita para poder anular la orden
  después (POST /qrcode/cancellations) o para reconciliar contra
  /qrcode/transactions. Es distinto de payments.qr_code, que sigue
  siendo el contenido/base64 que se le muestra al paciente.
- qr_image_url: la imagen (URL o data-URI base64) a mostrar. Con el
  banco real solo se devuelve una vez al crear la orden, así que hay que
  persistirla en vez de reconstruirla como se hacía con el QR simulado.

Backfill: todas las filas existentes son de QR simulados en BOB, así que
currency se llena con 'BOB' server-side (default) y bank_qr_id queda NULL
(no aplica, nunca hubo una orden real en el banco).

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-07-29
"""
from alembic import op
import sqlalchemy as sa

revision = "s3t4u5v6w7x8"
down_revision = "r2s3t4u5v6w7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="BOB"),
    )
    op.add_column(
        "payments",
        sa.Column("bank_qr_id", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("qr_image_url", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_payments_bank_qr_id", "payments", ["bank_qr_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_payments_bank_qr_id", table_name="payments")
    op.drop_column("payments", "qr_image_url")
    op.drop_column("payments", "bank_qr_id")
    op.drop_column("payments", "currency")
