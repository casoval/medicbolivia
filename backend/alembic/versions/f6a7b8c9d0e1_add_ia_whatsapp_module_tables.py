"""add IA/whatsapp module tables (conversations, messages, agent_config,
reminder rules/logs, db backup config/logs)

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ── whatsapp_conversations ──────────────────────
    op.create_table(
        'whatsapp_conversations',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('audience', sa.String(length=20), nullable=False),
        sa.Column('contact_name', sa.String(length=150), nullable=True),
        sa.Column('agent_enabled', sa.Boolean(), nullable=False),
        sa.Column('last_message_at', sa.DateTime(), nullable=True),
        sa.Column('last_message_preview', sa.String(length=300), nullable=True),
        sa.Column('unread_count', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('phone'),
    )
    op.create_index('ix_whatsapp_conversations_audience', 'whatsapp_conversations', ['audience'])

    # ── whatsapp_messages ────────────────────────────
    op.create_table(
        'whatsapp_messages',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('conversation_id', sa.String(), nullable=False),
        sa.Column('direction', sa.String(length=10), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('sent_by', sa.String(length=20), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('error_detail', sa.String(length=300), nullable=True),
        sa.Column('related_entity_type', sa.String(length=50), nullable=True),
        sa.Column('related_entity_id', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['conversation_id'], ['whatsapp_conversations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_whatsapp_messages_conversation_id', 'whatsapp_messages', ['conversation_id'])

    # ── agent_config (fila única "global") ───────────
    op.create_table(
        'agent_config',
        sa.Column('id', sa.String(length=20), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('guardrail_diagnosis_locked', sa.Boolean(), nullable=False),
        sa.Column('auto_reply_public', sa.Boolean(), nullable=False),
        sa.Column('auto_reply_patients', sa.Boolean(), nullable=False),
        sa.Column('auto_reply_professionals', sa.Boolean(), nullable=False),
        sa.Column('business_hours_only', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── reminder_rules ───────────────────────────────
    op.create_table(
        'reminder_rules',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('trigger_type', sa.String(length=50), nullable=False),
        sa.Column('audience', sa.String(length=20), nullable=False),
        sa.Column('channel', sa.String(length=20), nullable=False),
        sa.Column('offset_minutes', sa.Integer(), nullable=True),
        sa.Column('message_template', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── reminder_logs ────────────────────────────────
    op.create_table(
        'reminder_logs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('rule_id', sa.String(), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('related_entity_type', sa.String(length=50), nullable=True),
        sa.Column('related_entity_id', sa.String(length=100), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('error_detail', sa.String(length=300), nullable=True),
        sa.Column('sent_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['rule_id'], ['reminder_rules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_reminder_logs_rule_id', 'reminder_logs', ['rule_id'])
    op.create_index('ix_reminder_logs_related_entity_id', 'reminder_logs', ['related_entity_id'])

    # ── db_backup_config (fila única "global") ───────
    op.create_table(
        'db_backup_config',
        sa.Column('id', sa.String(length=20), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('frequency', sa.String(length=20), nullable=False),
        sa.Column('hour_utc', sa.Integer(), nullable=False),
        sa.Column('recipient_emails', postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column('include_full_dump', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── db_backup_logs ───────────────────────────────
    op.create_table(
        'db_backup_logs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('file_size_bytes', sa.Integer(), nullable=True),
        sa.Column('recipients', postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column('error_detail', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('db_backup_logs')
    op.drop_table('db_backup_config')
    op.drop_index('ix_reminder_logs_related_entity_id', table_name='reminder_logs')
    op.drop_index('ix_reminder_logs_rule_id', table_name='reminder_logs')
    op.drop_table('reminder_logs')
    op.drop_table('reminder_rules')
    op.drop_table('agent_config')
    op.drop_index('ix_whatsapp_messages_conversation_id', table_name='whatsapp_messages')
    op.drop_table('whatsapp_messages')
    op.drop_index('ix_whatsapp_conversations_audience', table_name='whatsapp_conversations')
    op.drop_table('whatsapp_conversations')
