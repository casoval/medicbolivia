"""add broadcast_messages table

Mensajería masiva: el admin redacta un anuncio libre (título + cuerpo) y
lo manda a un segmento de usuarios (todos / pacientes / profesionales /
contactos públicos de WhatsApp). Esta tabla es solo el registro de
auditoría de cada campaña enviada — el envío real (notificación in-app +
WhatsApp escalonado) pasa por app/services/broadcast.py.

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "n8o9p0q1r2s3"
down_revision = "m7n8o9p0q1r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "broadcast_messages",
        sa.Column("id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("audience", sa.String(length=20), nullable=False),
        sa.Column("send_whatsapp", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("recipients_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_by_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["sent_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_broadcast_messages_created_at", "broadcast_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_broadcast_messages_created_at", table_name="broadcast_messages")
    op.drop_table("broadcast_messages")
