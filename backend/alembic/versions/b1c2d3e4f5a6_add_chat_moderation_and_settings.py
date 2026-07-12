"""add chat moderation (reports, professional-patient visibility block),
admin-editable chat settings and audit log

Revision ID: b1c2d3e4f5a6
Revises: e2f3a4b5c6d7
Create Date: 2026-07-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ── chat_blocks: reporte, origen y auditoría de desbloqueo ───────
    op.add_column('chat_blocks', sa.Column('origin', sa.String(length=20), nullable=False, server_default='CHAT_WINDOW'))
    op.add_column('chat_blocks', sa.Column('is_reported', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('chat_blocks', sa.Column('reason_category', sa.String(length=40), nullable=True))
    op.add_column('chat_blocks', sa.Column('reason_text', sa.String(length=1000), nullable=True))
    op.add_column('chat_blocks', sa.Column('admin_notified_at', sa.DateTime(), nullable=True))
    op.add_column('chat_blocks', sa.Column('admin_reviewed_at', sa.DateTime(), nullable=True))
    op.add_column('chat_blocks', sa.Column('admin_reviewed_by_id', postgresql.UUID(as_uuid=False), nullable=True))
    op.add_column('chat_blocks', sa.Column('admin_resolution_notes', sa.String(length=1000), nullable=True))
    op.add_column('chat_blocks', sa.Column('unblocked_at', sa.DateTime(), nullable=True))
    op.add_column('chat_blocks', sa.Column('unblocked_by_id', postgresql.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key('fk_chat_blocks_admin_reviewed_by', 'chat_blocks', 'users', ['admin_reviewed_by_id'], ['id'])
    op.create_foreign_key('fk_chat_blocks_unblocked_by', 'chat_blocks', 'users', ['unblocked_by_id'], ['id'])
    op.create_index('ix_chat_blocks_is_reported', 'chat_blocks', ['is_reported'])
    op.create_index('ix_chat_blocks_unblocked_at', 'chat_blocks', ['unblocked_at'])
    # server_default solo era para poblar filas existentes; se retira
    # para que el ORM controle el default hacia adelante.
    op.alter_column('chat_blocks', 'origin', server_default=None)
    op.alter_column('chat_blocks', 'is_reported', server_default=None)

    # ── professional_patient_visibility (bloqueo integral) ───────────
    op.create_table(
        'professional_patient_visibility',
        sa.Column('id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('professional_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('patient_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('hidden', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('is_reported', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('reason_category', sa.String(length=40), nullable=True),
        sa.Column('reason_text', sa.String(length=1000), nullable=True),
        sa.Column('admin_notified_at', sa.DateTime(), nullable=True),
        sa.Column('admin_reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('admin_reviewed_by_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column('admin_resolution_notes', sa.String(length=1000), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('restored_at', sa.DateTime(), nullable=True),
        sa.Column('restored_by_id', postgresql.UUID(as_uuid=False), nullable=True),
        sa.ForeignKeyConstraint(['professional_id'], ['professionals.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['admin_reviewed_by_id'], ['users.id']),
        sa.ForeignKeyConstraint(['restored_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('professional_id', 'patient_id', name='uq_professional_patient_visibility'),
    )
    op.create_index('ix_ppv_professional_id', 'professional_patient_visibility', ['professional_id'])
    op.create_index('ix_ppv_patient_id', 'professional_patient_visibility', ['patient_id'])
    op.create_index('ix_ppv_hidden', 'professional_patient_visibility', ['hidden'])
    op.create_index('ix_ppv_restored_at', 'professional_patient_visibility', ['restored_at'])

    # ── admin_access_logs (auditoría de acceso a conversaciones reportadas) ──
    op.create_table(
        'admin_access_logs',
        sa.Column('id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('admin_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('conversation_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('accessed_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['admin_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['chat_conversations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_admin_access_logs_conversation_id', 'admin_access_logs', ['conversation_id'])

    # ── platform_settings: configuración de chat editable en caliente ──
    op.add_column('platform_settings', sa.Column('chat_window_days', sa.Integer(), nullable=False, server_default='15'))
    op.add_column('platform_settings', sa.Column('chat_attachments_enabled_patient', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('platform_settings', sa.Column('chat_attachments_enabled_professional', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.alter_column('platform_settings', 'chat_window_days', server_default=None)
    op.alter_column('platform_settings', 'chat_attachments_enabled_patient', server_default=None)
    op.alter_column('platform_settings', 'chat_attachments_enabled_professional', server_default=None)

    # ── consultations: snapshot de chat_window_days ──────────────────
    op.add_column('consultations', sa.Column('chat_window_days_snapshot', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('consultations', 'chat_window_days_snapshot')

    op.drop_column('platform_settings', 'chat_attachments_enabled_professional')
    op.drop_column('platform_settings', 'chat_attachments_enabled_patient')
    op.drop_column('platform_settings', 'chat_window_days')

    op.drop_index('ix_admin_access_logs_conversation_id', table_name='admin_access_logs')
    op.drop_table('admin_access_logs')

    op.drop_index('ix_ppv_restored_at', table_name='professional_patient_visibility')
    op.drop_index('ix_ppv_hidden', table_name='professional_patient_visibility')
    op.drop_index('ix_ppv_patient_id', table_name='professional_patient_visibility')
    op.drop_index('ix_ppv_professional_id', table_name='professional_patient_visibility')
    op.drop_table('professional_patient_visibility')

    op.drop_index('ix_chat_blocks_unblocked_at', table_name='chat_blocks')
    op.drop_index('ix_chat_blocks_is_reported', table_name='chat_blocks')
    op.drop_constraint('fk_chat_blocks_unblocked_by', 'chat_blocks', type_='foreignkey')
    op.drop_constraint('fk_chat_blocks_admin_reviewed_by', 'chat_blocks', type_='foreignkey')
    op.drop_column('chat_blocks', 'unblocked_by_id')
    op.drop_column('chat_blocks', 'unblocked_at')
    op.drop_column('chat_blocks', 'admin_resolution_notes')
    op.drop_column('chat_blocks', 'admin_reviewed_by_id')
    op.drop_column('chat_blocks', 'admin_reviewed_at')
    op.drop_column('chat_blocks', 'admin_notified_at')
    op.drop_column('chat_blocks', 'reason_text')
    op.drop_column('chat_blocks', 'reason_category')
    op.drop_column('chat_blocks', 'is_reported')
    op.drop_column('chat_blocks', 'origin')