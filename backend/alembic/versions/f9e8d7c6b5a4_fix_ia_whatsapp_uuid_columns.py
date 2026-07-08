"""fix IA/whatsapp module id/fk columns from varchar to native uuid

Las columnas id (y las FK que apuntan a ellas) de whatsapp_conversations,
whatsapp_messages, reminder_rules, reminder_logs y db_backup_logs se
crearon como sa.String() plano en la migración anterior, mientras que
los modelos de SQLAlchemy (models.py) las definen como UUID(as_uuid=False).
Postgres no compara varchar = uuid sin conversión explícita, lo que rompe
cualquier UPDATE/SELECT que filtre por id (ej. actualizar last_message_at
de una conversación after enviar un mensaje).

agent_config y db_backup_config NO se tocan: su id es un string fijo
("global") a propósito, no un UUID.

Revision ID: f9e8d7c6b5a4
Revises: f6a7b8c9d0e1
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f9e8d7c6b5a4"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def _drop_fk_on_column(table: str, column: str) -> None:
    """
    Suelta la FK que involucra `column` en `table`, buscando su nombre
    real en information_schema en vez de asumirlo — el nombre autogenerado
    por Postgres puede variar según cómo se creó la constraint.
    """
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
    # Hay que soltar las FKs antes de alterar el tipo de las columnas que
    # referencian, y recrearlas después.
    _drop_fk_on_column("whatsapp_messages", "conversation_id")
    _drop_fk_on_column("reminder_logs", "rule_id")

    uuid_type = postgresql.UUID(as_uuid=False)

    for table, column in [
        ("whatsapp_conversations", "id"),
        ("whatsapp_messages", "id"),
        ("whatsapp_messages", "conversation_id"),
        ("reminder_rules", "id"),
        ("reminder_logs", "id"),
        ("reminder_logs", "rule_id"),
        ("db_backup_logs", "id"),
    ]:
        op.alter_column(
            table,
            column,
            type_=uuid_type,
            existing_type=sa.String(),
            postgresql_using=f"{column}::uuid",
        )

    op.create_foreign_key(
        "whatsapp_messages_conversation_id_fkey",
        "whatsapp_messages",
        "whatsapp_conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "reminder_logs_rule_id_fkey",
        "reminder_logs",
        "reminder_rules",
        ["rule_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    _drop_fk_on_column("whatsapp_messages", "conversation_id")
    _drop_fk_on_column("reminder_logs", "rule_id")

    varchar_type = sa.String()

    for table, column in [
        ("whatsapp_conversations", "id"),
        ("whatsapp_messages", "id"),
        ("whatsapp_messages", "conversation_id"),
        ("reminder_rules", "id"),
        ("reminder_logs", "id"),
        ("reminder_logs", "rule_id"),
        ("db_backup_logs", "id"),
    ]:
        op.alter_column(
            table,
            column,
            type_=varchar_type,
            existing_type=postgresql.UUID(as_uuid=False),
            postgresql_using=f"{column}::varchar",
        )

    op.create_foreign_key(
        "whatsapp_messages_conversation_id_fkey",
        "whatsapp_messages",
        "whatsapp_conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "reminder_logs_rule_id_fkey",
        "reminder_logs",
        "reminder_rules",
        ["rule_id"],
        ["id"],
        ondelete="CASCADE",
    )
