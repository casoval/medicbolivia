"""add internal chat module tables (conversations, messages, blocks)

Revision ID: d1e2f3a4b5c6
Revises: c4d5e6f7a8b9
Create Date: 2026-07-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ── chat_conversations ───────────────────────────
    op.create_table(
        'chat_conversations',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('consultation_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('patient_user_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('professional_user_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('closed_by_admin_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('close_reason', sa.String(length=255), nullable=True),
        sa.Column('last_message_at', sa.DateTime(), nullable=True),
        sa.Column('last_message_preview', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['consultation_id'], ['consultations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['patient_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['professional_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['closed_by_admin_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('consultation_id'),
    )
    op.create_index('ix_chat_conversations_patient_user_id', 'chat_conversations', ['patient_user_id'])
    op.create_index('ix_chat_conversations_professional_user_id', 'chat_conversations', ['professional_user_id'])
    op.create_index('ix_chat_conversations_expires_at', 'chat_conversations', ['expires_at'])
    op.create_index('ix_chat_conversations_status', 'chat_conversations', ['status'])

    # ── chat_messages ─────────────────────────────────
    op.create_table(
        'chat_messages',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('conversation_id', sa.String(), nullable=False),
        sa.Column('sender_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('attachment_key', sa.String(length=500), nullable=True),
        sa.Column('attachment_content_type', sa.String(length=100), nullable=True),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['chat_conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chat_messages_conversation_id', 'chat_messages', ['conversation_id'])
    op.create_index('ix_chat_messages_created_at', 'chat_messages', ['created_at'])

    # ── chat_blocks ───────────────────────────────────
    op.create_table(
        'chat_blocks',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('blocker_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('blocked_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('scope', sa.String(length=10), nullable=False),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['blocker_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['blocked_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chat_blocks_blocker_id', 'chat_blocks', ['blocker_id'])
    op.create_index('ix_chat_blocks_blocked_id', 'chat_blocks', ['blocked_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_chat_blocks_blocked_id', table_name='chat_blocks')
    op.drop_index('ix_chat_blocks_blocker_id', table_name='chat_blocks')
    op.drop_table('chat_blocks')

    op.drop_index('ix_chat_messages_created_at', table_name='chat_messages')
    op.drop_index('ix_chat_messages_conversation_id', table_name='chat_messages')
    op.drop_table('chat_messages')

    op.drop_index('ix_chat_conversations_status', table_name='chat_conversations')
    op.drop_index('ix_chat_conversations_expires_at', table_name='chat_conversations')
    op.drop_index('ix_chat_conversations_professional_user_id', table_name='chat_conversations')
    op.drop_index('ix_chat_conversations_patient_user_id', table_name='chat_conversations')
    op.drop_table('chat_conversations')
