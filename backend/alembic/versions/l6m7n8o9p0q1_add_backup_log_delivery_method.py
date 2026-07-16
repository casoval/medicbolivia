"""Agrega db_backup_logs.delivery_method (ATTACHMENT / R2_LINK)

Distingue si el backup se mandó como adjunto directo en el correo o
como link firmado de R2 (cuando el dump supera BACKUP_MAX_ATTACHMENT_MB).
Ver app/tasks/backup_tasks.py. Default ATTACHMENT para no romper filas
existentes, que siempre fueron adjuntos (el fallback a R2 no existía).

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

revision = "l6m7n8o9p0q1"
down_revision = "k5l6m7n8o9p0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "db_backup_logs",
        sa.Column(
            "delivery_method",
            sa.String(length=20),
            nullable=False,
            server_default="ATTACHMENT",
        ),
    )
    # El server_default fue solo para poblar filas existentes sin bloquear
    # la migración — el default real lo maneja la app vía el modelo.
    op.alter_column("db_backup_logs", "delivery_method", server_default=None)


def downgrade() -> None:
    op.drop_column("db_backup_logs", "delivery_method")
