"""
SQLAlchemy models for the chat application.
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import uuid

db = SQLAlchemy()


class Chat(db.Model):
    """Chat model with UUID primary key."""
    __tablename__ = 'chats'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = db.Column(db.String(255), nullable=False)
    model = db.Column(db.String(100), nullable=False, default='gemma3:1b')
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationship to messages
    messages = db.relationship('Message', backref='chat', lazy=True, cascade='all, delete-orphan', order_by='Message.sequence_order')
    
    def to_dict(self):
        """Convert chat to dictionary."""
        return {
            'id': self.id,
            'title': self.title,
            'model': self.model,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'messages': [msg.to_dict() for msg in self.messages]
        }


class Message(db.Model):
    """Message model with foreign key to Chat."""
    __tablename__ = 'messages'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    chat_id = db.Column(db.String(36), db.ForeignKey('chats.id', ondelete='CASCADE'), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # 'user' or 'assistant'
    content = db.Column(db.Text, nullable=False)
    sequence_order = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
    # Unique constraint on chat_id and sequence_order
    __table_args__ = (db.UniqueConstraint('chat_id', 'sequence_order', name='uq_chat_sequence'),)
    
    def to_dict(self):
        """Convert message to dictionary."""
        return {
            'id': self.id,
            'chat_id': self.chat_id,
            'role': self.role,
            'content': self.content,
            'sequence_order': self.sequence_order,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

