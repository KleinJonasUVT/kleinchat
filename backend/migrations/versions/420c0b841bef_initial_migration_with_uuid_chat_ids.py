"""Initial migration with UUID chat IDs

Revision ID: 420c0b841bef
Revises: 
Create Date: 2025-11-13 15:01:18.909500

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '420c0b841bef'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Create chats table
    op.create_table('chats',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('model', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create messages table
    op.create_table('messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.String(length=36), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('sequence_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chat_id', 'sequence_order', name='uq_chat_sequence')
    )
    
    # Create indexes
    op.create_index('idx_messages_chat_id', 'messages', ['chat_id'])
    op.create_index('idx_messages_sequence', 'messages', ['chat_id', 'sequence_order'])
    op.create_index('idx_chats_updated_at', 'chats', ['updated_at'])


def downgrade():
    # Drop indexes
    op.drop_index('idx_chats_updated_at', table_name='chats')
    op.drop_index('idx_messages_sequence', table_name='messages')
    op.drop_index('idx_messages_chat_id', table_name='messages')
    
    # Drop tables
    op.drop_table('messages')
    op.drop_table('chats')
