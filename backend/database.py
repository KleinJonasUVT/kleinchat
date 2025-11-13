"""
Database module using SQLAlchemy ORM.
Provides functions for chat and message operations.
"""
from models import db, Chat, Message
from typing import List, Dict, Optional
from datetime import datetime


# init_db is no longer needed as Flask-Migrate handles migrations
# Database initialization happens in app.py with db.create_all()


def create_chat(title: str, model: str = 'gemma3:1b') -> str:
    """Create a new chat and return its UUID."""
    chat = Chat(title=title, model=model)
    db.session.add(chat)
    db.session.commit()
    return chat.id


def get_chat(chat_id: str) -> Optional[Dict]:
    """Get a chat with its messages."""
    chat = Chat.query.get(chat_id)
    if not chat:
        return None
    return chat.to_dict()


def get_all_chats() -> List[Dict]:
    """Get all chats ordered by most recently updated."""
    chats = Chat.query.order_by(Chat.updated_at.desc()).all()
    return [chat.to_dict() for chat in chats]


def find_empty_chat() -> Optional[str]:
    """Find the most recently created chat with no messages. Returns chat_id or None."""
    # Find chats with no messages, ordered by most recently created
    # Use left join to find chats without messages
    from sqlalchemy.orm import outerjoin
    chat = Chat.query.outerjoin(Message, Chat.id == Message.chat_id).filter(Message.id == None).order_by(Chat.created_at.desc()).first()
    return chat.id if chat else None


def add_message(chat_id: str, role: str, content: str) -> int:
    """Add a message to a chat and return message ID."""
    # Get next sequence order
    last_message = Message.query.filter_by(chat_id=chat_id).order_by(Message.sequence_order.desc()).first()
    sequence_order = (last_message.sequence_order + 1) if last_message else 0
    
    # Create message
    message = Message(
        chat_id=chat_id,
        role=role,
        content=content,
        sequence_order=sequence_order
    )
    db.session.add(message)
    
    # Update chat's updated_at timestamp
    chat = Chat.query.get(chat_id)
    if chat:
        chat.updated_at = datetime.utcnow()
    
    db.session.commit()
    return message.id


def update_chat_title(chat_id: str, title: str):
    """Update a chat's title."""
    chat = Chat.query.get(chat_id)
    if chat:
        chat.title = title
        chat.updated_at = datetime.utcnow()
        db.session.commit()


def delete_chat(chat_id: str):
    """Delete a chat and all its messages (CASCADE)."""
    chat = Chat.query.get(chat_id)
    if chat:
        db.session.delete(chat)
        db.session.commit()
