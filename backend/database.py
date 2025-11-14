"""
Database module using SQLAlchemy ORM.
Provides functions for chat and message operations.
"""
from models import db, Chat, Message, UserSettings, User
from typing import List, Dict, Optional
from datetime import datetime


# init_db is no longer needed as Flask-Migrate handles migrations
# Database initialization happens in app.py with db.create_all()


def get_or_create_user(google_id: str, email: str, name: str = None, picture: str = None) -> User:
    """Get or create a user by Google ID."""
    user = User.query.filter_by(google_id=google_id).first()
    if not user:
        user = User(
            google_id=google_id,
            email=email,
            name=name,
            picture=picture
        )
        db.session.add(user)
        db.session.commit()
    else:
        # Update last login and user info
        user.last_login = datetime.utcnow()
        if name:
            user.name = name
        if picture:
            user.picture = picture
        db.session.commit()
    return user

def create_chat(user_id: str, title: str, model: str = 'gemma3:1b') -> str:
    """Create a new chat and return its UUID."""
    chat = Chat(user_id=user_id, title=title, model=model)
    db.session.add(chat)
    db.session.commit()
    return chat.id


def get_chat(chat_id: str) -> Optional[Dict]:
    """Get a chat with its messages."""
    chat = Chat.query.get(chat_id)
    if not chat:
        return None
    return chat.to_dict()


def get_all_chats(user_id: str) -> List[Dict]:
    """Get all chats for a user, ordered by most recently updated."""
    chats = Chat.query.filter_by(user_id=user_id).order_by(Chat.updated_at.desc()).all()
    return [chat.to_dict() for chat in chats]


def find_empty_chat(user_id: str) -> Optional[str]:
    """Find the most recently created chat with no messages for a user. Returns chat_id or None."""
    # Find chats with no messages, ordered by most recently created
    # Use left join to find chats without messages
    from sqlalchemy.orm import outerjoin
    chat = Chat.query.filter_by(user_id=user_id).outerjoin(Message, Chat.id == Message.chat_id).filter(Message.id == None).order_by(Chat.created_at.desc()).first()
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


def get_setting(user_id: str, key: str, default: str = '') -> str:
    """Get a user setting by key. Returns default if not found."""
    setting = UserSettings.query.filter_by(user_id=user_id, key=key).first()
    return setting.value if setting else default


def set_setting(user_id: str, key: str, value: str):
    """Set a user setting. Creates if doesn't exist, updates if exists."""
    setting = UserSettings.query.filter_by(user_id=user_id, key=key).first()
    if setting:
        setting.value = value
    else:
        setting = UserSettings(user_id=user_id, key=key, value=value)
        db.session.add(setting)
    db.session.commit()
