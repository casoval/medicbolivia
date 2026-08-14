"""add support chat module (patient/professional <-> admin)

Chat directo con soporte, separado del chat interno paciente-profesional
(chat_conversations/chat_messages, ver d1e2f3a4b5c6): este es un canal
siempre disponible, sin expiración ni bloqueo, una sola conversación por
usuario que cualquier admin puede ver y responder (bandeja compartida).

Revision ID: f4a5b6c7d8e9
Revises: c5d6e7f8a9b0
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── support_conversations ─────────────────────────
    op.create_table(
        'support_conversations',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('user_role', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('closed_by_admin_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('closed_at', sa.DateTime(), nullable=True),
        sa.Column('last_message_at', sa.DateTime(), nullable=True),
        sa.Column('last_message_preview', sa.String(length=300), nullable=True),
        sa.Column('last_message_from', sa.String(length=10), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['closed_by_admin_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.create_index('ix_support_conversations_status', 'support_conversations', ['status'])
    op.create_index('ix_support_conversations_last_message_at', 'support_conversations', ['last_message_at'])

    # ── support_messages ───────────────────────────────
    op.create_table(
        'support_messages',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('conversation_id', sa.String(), nullable=False),
        sa.Column('sender_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('attachment_key', sa.String(length=500), nullable=True),
        sa.Column('attachment_content_type', sa.String(length=100), nullable=True),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['support_conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_support_messages_conversation_id', 'support_messages', ['conversation_id'])
    op.create_index('ix_support_messages_created_at', 'support_messages', ['created_at'])

    # ── interruptor general en platform_settings ──────
    op.add_column(
        'platform_settings',
        sa.Column('support_chat_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column('platform_settings', 'support_chat_enabled')

    op.drop_index('ix_support_messages_created_at', table_name='support_messages')
    op.drop_index('ix_support_messages_conversation_id', table_name='support_messages')
    op.drop_table('support_messages')

    op.drop_index('ix_support_conversations_last_message_at', table_name='support_conversations')
    op.drop_index('ix_support_conversations_status', table_name='support_conversations')
    op.drop_table('support_conversations')
