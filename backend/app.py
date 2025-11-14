"""
Flask backend for streaming Ollama chat responses with SQLite persistence.
"""
import os
from flask import Flask, request, jsonify, Response, session, redirect, url_for
from flask_cors import CORS
from flask_migrate import Migrate
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from dotenv import load_dotenv
import ollama
import json
from datetime import datetime
import threading
import queue
from google.oauth2 import id_token
from google.auth.transport import requests
from models import db, User, Chat
from database import (
        create_chat, get_chat, get_all_chats,
        add_message, update_chat_title, delete_chat, find_empty_chat,
        get_setting, set_setting, get_or_create_user
    )

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Database configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(basedir, "chats.db")}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['GOOGLE_CLIENT_ID'] = os.getenv('GOOGLE_CLIENT_ID', '')

# Initialize extensions
db.init_app(app)
migrate = Migrate(app, db)

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = None  # We handle login via API, not Flask views

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(user_id)

# Enable CORS with explicit configuration for streaming and authentication
CORS(app, resources={
    r"/api/*": {
        "origins": "http://localhost:3000",
        "methods": ["GET", "POST", "OPTIONS", "DELETE", "PUT"],
        "allow_headers": ["Content-Type"],
        "supports_credentials": True
    }
}, supports_credentials=True)

# Get current date, also with the time up to the second
current_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
print(f"Current date: {current_date}")

# Database tables are created via Flask-Migrate migrations
# Run: flask db upgrade to create tables

@app.route('/api/chat', methods=['POST', 'OPTIONS'])
@login_required
def chat():
    """
    Stream chat responses from Ollama and save to database.
    Expects JSON: {'message': 'user message', 'model': 'gemma3:1b', 'chat_id': <id>}
    If chat_id is not provided, creates a new chat.
    """
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    try:
        data = request.json
        user_message = data.get('message', '')
        model = data.get('model', 'gemma3:1b')
        chat_id = data.get('chat_id')
        
        if not user_message:
            response = jsonify({'error': 'Message is required'})
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 400
        
        # Check authentication
        if not current_user.is_authenticated:
            response = jsonify({'error': 'Authentication required'})
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 401
        
        user_id = current_user.get_id()
        
        # Use existing empty chat or create new chat if chat_id not provided
        if not chat_id:
            # Check if there's an existing empty chat
            empty_chat_id = find_empty_chat(user_id)
            if empty_chat_id:
                chat_id = empty_chat_id
            else:
                # Generate title from first 50 chars of message
                title = user_message[:50] + ('...' if len(user_message) > 50 else '')
                chat_id = create_chat(user_id, title, model)
        
        # Check if this is the first message in the chat and update title
        chat = get_chat(chat_id)
        if chat and len(chat.get('messages', [])) == 0:
            # This is the first message, update the title
            title = user_message[:50] + ('...' if len(user_message) > 50 else '')
            update_chat_title(chat_id, title)
        
        # Save user message to database
        add_message(chat_id, 'user', user_message)
        
        # Get conversation history for context
        chat = get_chat(chat_id)
        conversation_history = [
            {'role': msg['role'], 'content': msg['content']}
            for msg in chat['messages']
        ]
        
        # Get custom instructions from database (or use empty string if not set)
        custom_instructions = get_setting(user_id, 'custom_instructions', '')
        
        # Build system prompt with custom instructions
        if custom_instructions:
            messages_with_system = [
                {'role': 'system', 'content': custom_instructions}
            ] + conversation_history
        else:
            # No custom instructions, use conversation history only
            messages_with_system = conversation_history
        
        # Queue for communication between background thread and streaming generator
        content_queue = queue.Queue()
        error_queue = queue.Queue()
        completion_event = threading.Event()
        
        def generate_in_background():
            """Background thread function that generates response and saves to DB."""
            assistant_content = ''
            last_save_length = 0
            save_interval = 100  # Save to DB every 100 characters
            message_id = None  # Track the message ID for updates
            
            try:
                stream = ollama.chat(
                    model=model,
                    messages=messages_with_system,
                    stream=True,
                )
                
                for chunk in stream:
                    if 'message' in chunk and 'content' in chunk['message']:
                        content = chunk['message']['content']
                        assistant_content += content
                        
                        # Put content in queue for streaming (non-blocking)
                        try:
                            content_queue.put_nowait(('content', content))
                        except queue.Full:
                            pass  # Queue full, continue anyway
                        
                        # Create message in DB on first content
                        if message_id is None and assistant_content.strip():
                            with app.app_context():
                                try:
                                    message_id = add_message(chat_id, 'assistant', assistant_content)
                                    last_save_length = len(assistant_content)
                                    print(f"Created assistant message {message_id} for chat {chat_id} (initial length: {len(assistant_content)})")
                                except Exception as db_error:
                                    import traceback
                                    print(f"ERROR: Failed to create assistant message for chat {chat_id}: {db_error}")
                                    print(traceback.format_exc())
                        
                        # Periodically update message in DB (every save_interval characters)
                        elif message_id and len(assistant_content) - last_save_length >= save_interval:
                            with app.app_context():
                                try:
                                    from models import Message
                                    msg_obj = Message.query.get(message_id)
                                    if msg_obj:
                                        msg_obj.content = assistant_content
                                        db.session.commit()
                                        print(f"Updated assistant message {message_id} for chat {chat_id} (length: {len(assistant_content)})")
                                        last_save_length = len(assistant_content)
                                except Exception as db_error:
                                    import traceback
                                    print(f"ERROR: Failed to update assistant message for chat {chat_id}: {db_error}")
                                    print(traceback.format_exc())
                
                # Final save of complete message
                if assistant_content and assistant_content.strip():
                    with app.app_context():
                        try:
                            if message_id:
                                # Update existing message with final content
                                from models import Message
                                msg_obj = Message.query.get(message_id)
                                if msg_obj:
                                    msg_obj.content = assistant_content
                                    db.session.commit()
                                    print(f"Final update: assistant message {message_id} for chat {chat_id} (final length: {len(assistant_content)})")
                                else:
                                    # Message was deleted? Create new one
                                    message_id = add_message(chat_id, 'assistant', assistant_content)
                                    print(f"Final save (recreated): assistant message {message_id} for chat {chat_id} (final length: {len(assistant_content)})")
                            else:
                                # Create new message if it doesn't exist
                                message_id = add_message(chat_id, 'assistant', assistant_content)
                                print(f"Final save: assistant message {message_id} for chat {chat_id} (final length: {len(assistant_content)})")
                        except Exception as db_error:
                            import traceback
                            print(f"ERROR: Failed to final save assistant message for chat {chat_id}: {db_error}")
                            print(traceback.format_exc())
                else:
                    print(f"WARNING: No assistant content to save for chat {chat_id}")
                
                # Signal completion
                content_queue.put(('done', {'chat_id': chat_id}))
                completion_event.set()
                
            except Exception as e:
                error_queue.put(str(e))
                completion_event.set()
        
        # Start background generation thread
        bg_thread = threading.Thread(target=generate_in_background, daemon=True)
        bg_thread.start()
        
        def generate():
            """Generator function for streaming responses from queue."""
            try:
                while True:
                    try:
                        # Wait for content with timeout to check for completion
                        item_type, item_data = content_queue.get(timeout=0.1)
                        
                        if item_type == 'content':
                            # Stream content to client
                            yield f"data: {json.dumps({'content': item_data})}\n\n"
                        elif item_type == 'done':
                            # Send completion signal
                            yield f"data: {json.dumps({'done': True, 'chat_id': item_data.get('chat_id', chat_id)})}\n\n"
                            break
                    except queue.Empty:
                        # Check if generation is complete
                        if completion_event.is_set():
                            # Check for errors
                            try:
                                error = error_queue.get_nowait()
                                error_data = json.dumps({'error': error})
                                yield f"data: {error_data}\n\n"
                            except queue.Empty:
                                # No error, just completion
                                yield f"data: {json.dumps({'done': True, 'chat_id': chat_id})}\n\n"
                            break
                        # Continue waiting for content
                        continue
            except Exception as e:
                error_data = json.dumps({'error': str(e)})
                yield f"data: {error_data}\n\n"
        
        # Return the streaming response
        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true'
            }
        )
    
    except Exception as e:
        response = jsonify({'error': str(e)})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@app.route('/api/chats', methods=['GET', 'OPTIONS'])
@login_required
def get_chats():
    """Get all chats for the current user."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    try:
        user_id = current_user.get_id()
        chats = get_all_chats(user_id)
        return jsonify(chats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats', methods=['POST', 'OPTIONS'])
@login_required
def create_new_chat():
    """Create a new chat or return existing empty chat."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    try:
        user_id = current_user.get_id()
        data = request.json or {}
        title = data.get('title', 'New Chat')
        model = data.get('model', 'gemma3:1b')
        
        # Check if there's an existing empty chat
        empty_chat_id = find_empty_chat(user_id)
        if empty_chat_id:
            chat = get_chat(empty_chat_id)
            return jsonify(chat), 200
        
        # Create new chat if no empty chat exists
        chat_id = create_chat(user_id, title, model)
        chat = get_chat(chat_id)
        return jsonify(chat), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats/<chat_id>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
@login_required
def handle_chat_by_id(chat_id):
    """Handle GET, PUT, and DELETE operations for a specific chat."""
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response
    
    try:
        user_id = current_user.get_id()
        
        if request.method == 'GET':
            # Get a specific chat with its messages
            chat = get_chat(chat_id)
            if not chat:
                response = jsonify({'error': 'Chat not found'})
                response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
                response.headers.add('Access-Control-Allow-Credentials', 'true')
                return response, 404
            # Verify chat belongs to user
            chat_obj = Chat.query.get(chat_id)
            if chat_obj and chat_obj.user_id != user_id:
                response = jsonify({'error': 'Unauthorized'})
                response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
                response.headers.add('Access-Control-Allow-Credentials', 'true')
                return response, 403
            response = jsonify(chat)
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response
        
        elif request.method == 'PUT':
            # Update a chat (e.g., title)
            chat_obj = Chat.query.get(chat_id)
            if not chat_obj:
                response = jsonify({'error': 'Chat not found'})
                response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
                response.headers.add('Access-Control-Allow-Credentials', 'true')
                return response, 404
            if chat_obj.user_id != user_id:
                response = jsonify({'error': 'Unauthorized'})
                response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
                response.headers.add('Access-Control-Allow-Credentials', 'true')
                return response, 403
            data = request.json or {}
            if 'title' in data:
                update_chat_title(chat_id, data['title'])
            chat = get_chat(chat_id)
            response = jsonify(chat)
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response
        
        elif request.method == 'DELETE':
            # Delete a chat
            chat_obj = Chat.query.get(chat_id)
            if not chat_obj:
                response = jsonify({'error': 'Chat not found'})
                response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
                response.headers.add('Access-Control-Allow-Credentials', 'true')
                return response, 404
            if chat_obj.user_id != user_id:
                response = jsonify({'error': 'Unauthorized'})
                response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
                response.headers.add('Access-Control-Allow-Credentials', 'true')
                return response, 403
            delete_chat(chat_id)
            response = jsonify({'success': True})
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 200
            
    except Exception as e:
        response = jsonify({'error': str(e)})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@app.route('/api/auth/login', methods=['POST', 'OPTIONS'])
def login():
    """Authenticate user with Google OAuth token."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    try:
        data = request.json
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Token is required'}), 400
        
        # Verify the token with Google
        try:
            idinfo = id_token.verify_oauth2_token(
                token, requests.Request(), app.config['GOOGLE_CLIENT_ID']
            )
            
            # Verify the issuer
            if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
                raise ValueError('Wrong issuer.')
            
            # Get user info
            google_id = idinfo['sub']
            email = idinfo['email']
            name = idinfo.get('name', '')
            picture = idinfo.get('picture', '')
            
            # Get or create user
            user = get_or_create_user(google_id, email, name, picture)
            
            # Log the user in
            login_user(user, remember=True)
            
            response = jsonify({
                'success': True,
                'user': user.to_dict()
            })
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response
        except ValueError as e:
            response = jsonify({'error': f'Invalid token: {str(e)}'})
            response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 401
    except Exception as e:
        response = jsonify({'error': str(e)})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@app.route('/api/auth/logout', methods=['POST', 'OPTIONS'])
@login_required
def logout():
    """Logout the current user."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    logout_user()
    response = jsonify({'success': True})
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

@app.route('/api/auth/me', methods=['GET', 'OPTIONS'])
def get_current_user():
    """Get the current authenticated user."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    if current_user.is_authenticated:
        response = jsonify({'user': current_user.to_dict()})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    else:
        response = jsonify({'user': None})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 401

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'})

@app.route('/api/settings', methods=['GET', 'PUT', 'OPTIONS'])
@login_required
def handle_settings():
    """Handle GET and PUT operations for user settings."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    user_id = current_user.get_id()
    
    if request.method == 'GET':
        try:
            custom_instructions = get_setting(user_id, 'custom_instructions', '')
            return jsonify({
                'custom_instructions': custom_instructions
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    
    elif request.method == 'PUT':
        try:
            data = request.json
            custom_instructions = data.get('custom_instructions', '')
            set_setting(user_id, 'custom_instructions', custom_instructions)
            return jsonify({
                'message': 'Settings updated successfully',
                'custom_instructions': custom_instructions
            })
        except Exception as e:
            return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001, threaded=True)

