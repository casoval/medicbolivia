"""fix chat module id/fk columns from varchar to native uuid

Mismo problema que ya se dio en el módulo de WhatsApp (ver
f9e8d7c6b5a4_fix_ia_whatsapp_uuid_columns.py): las columnas id de
chat_conversations, chat_messages y chat_blocks, además de
chat_messages.conversation_id (FK), se crearon como sa.String() plano
en la migración anterior, mientras que los modelos de SQLAlchemy
(models.py) las definen como UUID(as_uuid=False). Postgres no compara
varchar = uuid sin conversión explícita, lo que rompe cualquier
SELECT/UPDATE que filtre por id (ej. abrir una conversación por su id
al cargar el chat).

chat_blocks.blocked_id ya era UUID desde la migración original (no se
toca). consultation_id, patient_user_id, professional_user_id,
closed_by_admin_id, sender_id, blocker_id ya eran UUID también.

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def _drop_fk_on_column(table: str, column: str) -> None:
    """Suelta la FK que involucra `column` en `table`, buscando su nombre
    real en information_schema en vez de asumirlo."""
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            """
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name = :table
              AND kcu.column_name = :column
            """
        ),
        {"table": table, "column": column},
    )
    for row in result:
        op.drop_constraint(row[0], table, type_="foreignkey")


def upgrade() -> None:
    _drop_fk_on_column("chat_messages", "conversation_id")

    uuid_type = postgresql.UUID(as_uuid=False)

    for table, column in [
        ("chat_conversations", "id"),
        ("chat_messages", "id"),
        ("chat_messages", "conversation_id"),
        ("chat_blocks", "id"),
    ]:
        op.alter_column(
            table,
            column,
            type_=uuid_type,
            existing_type=sa.String(),
            postgresql_using=f"{column}::uuid",
        )

    op.create_foreign_key(
        "chat_messages_conversation_id_fkey",
        "chat_messages",
        "chat_conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    _drop_fk_on_column("chat_messages", "conversation_id")

    varchar_type = sa.String()

    for table, column in [
        ("chat_conversations", "id"),
        ("chat_messages", "id"),
        ("chat_messages", "conversation_id"),
        ("chat_blocks", "id"),
    ]:
        op.alter_column(
            table,
            column,
            type_=varchar_type,
            existing_type=postgresql.UUID(as_uuid=False),
            postgresql_using=f"{column}::varchar",
        )

    op.create_foreign_key(
        "chat_messages_conversation_id_fkey",
        "chat_messages",
        "chat_conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
