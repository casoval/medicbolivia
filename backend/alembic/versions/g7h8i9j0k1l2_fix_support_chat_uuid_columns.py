"""fix support chat uuid columns (id / conversation_id)

La migración f4a5b6c7d8e9 creó support_conversations.id, support_messages.id
y support_messages.conversation_id como VARCHAR (sa.String()), pero el
modelo de SQLAlchemy (models.py) los mapea como UUID(as_uuid=False) — igual
error de tipeo que ya se había cometido antes con chat_conversations (ver
e2f3a4b5c6d7_fix_chat_uuid_columns). Esto rompe cualquier query que filtre
por esas columnas: "operator does not exist: character varying = uuid".

Hay que soltar el FK de support_messages.conversation_id antes de poder
cambiar el tipo de support_conversations.id (Postgres no permite alterar
el tipo de una columna referenciada por una FK activa), y recrearlo después.

Revision ID: g7h8i9j0k1l2
Revises: f4a5b6c7d8e9
Create Date: 2026-08-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'g7h8i9j0k1l2'
down_revision: Union[str, Sequence[str], None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Soltar el FK que referencia support_conversations.id antes de poder
    # cambiar su tipo.
    op.drop_constraint(
        'support_messages_conversation_id_fkey', 'support_messages', type_='foreignkey'
    )

    op.alter_column(
        'support_conversations', 'id',
        existing_type=sa.String(),
        type_=postgresql.UUID(as_uuid=False),
        postgresql_using='id::uuid',
    )
    op.alter_column(
        'support_messages', 'id',
        existing_type=sa.String(),
        type_=postgresql.UUID(as_uuid=False),
        postgresql_using='id::uuid',
    )
    op.alter_column(
        'support_messages', 'conversation_id',
        existing_type=sa.String(),
        type_=postgresql.UUID(as_uuid=False),
        postgresql_using='conversation_id::uuid',
    )

    op.create_foreign_key(
        'support_messages_conversation_id_fkey', 'support_messages', 'support_conversations',
        ['conversation_id'], ['id'], ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint(
        'support_messages_conversation_id_fkey', 'support_messages', type_='foreignkey'
    )

    op.alter_column(
        'support_messages', 'conversation_id',
        existing_type=postgresql.UUID(as_uuid=False),
        type_=sa.String(),
    )
    op.alter_column(
        'support_messages', 'id',
        existing_type=postgresql.UUID(as_uuid=False),
        type_=sa.String(),
    )
    op.alter_column(
        'support_conversations', 'id',
        existing_type=postgresql.UUID(as_uuid=False),
        type_=sa.String(),
    )

    op.create_foreign_key(
        'support_messages_conversation_id_fkey', 'support_messages', 'support_conversations',
        ['conversation_id'], ['id'], ondelete='CASCADE',
    )
