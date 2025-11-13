"""
Flask backend for streaming Ollama chat responses with SQLite persistence.
"""
import os
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from flask_migrate import Migrate
from dotenv import load_dotenv
import ollama
import json
from models import db
from database import (
    create_chat, get_chat, get_all_chats,
    add_message, update_chat_title, delete_chat, find_empty_chat
)

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Database configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{os.path.join(basedir, "chats.db")}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db.init_app(app)
migrate = Migrate(app, db)

# Enable CORS with explicit configuration for streaming
CORS(app, resources={
    r"/api/*": {
        "origins": "http://localhost:3000",
        "methods": ["GET", "POST", "OPTIONS", "DELETE", "PUT"],
        "allow_headers": ["Content-Type"]
    }
})

# Database tables are created via Flask-Migrate migrations
# Run: flask db upgrade to create tables

@app.route('/api/chat', methods=['POST', 'OPTIONS'])
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
        return response
    try:
        data = request.json
        user_message = data.get('message', '')
        model = data.get('model', 'gemma3:1b')
        chat_id = data.get('chat_id')
        
        if not user_message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Use existing empty chat or create new chat if chat_id not provided
        if not chat_id:
            # Check if there's an existing empty chat
            empty_chat_id = find_empty_chat()
            if empty_chat_id:
                chat_id = empty_chat_id
            else:
                # Generate title from first 50 chars of message
                title = user_message[:50] + ('...' if len(user_message) > 50 else '')
                chat_id = create_chat(title, model)
        
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
        
        def generate():
            """Generator function for streaming responses."""
            assistant_content = ''
            try:
                stream = ollama.chat(
                    model=model,
                    messages=conversation_history,
                    stream=True,
                )
                
                for chunk in stream:
                    if 'message' in chunk and 'content' in chunk['message']:
                        content = chunk['message']['content']
                        assistant_content += content
                        # Send as Server-Sent Events (SSE) format
                        yield f"data: {json.dumps({'content': content})}\n\n"
                
                # Save assistant message to database within app context
                # Only save if we have content
                if assistant_content and assistant_content.strip():
                    with app.app_context():
                        try:
                            message_id = add_message(chat_id, 'assistant', assistant_content)
                            print(f"Successfully saved assistant message {message_id} for chat {chat_id}")
                        except Exception as db_error:
                            # Log database error but don't fail the response
                            import traceback
                            print(f"ERROR: Failed to save assistant message for chat {chat_id}: {db_error}")
                            print(traceback.format_exc())
                else:
                    print(f"WARNING: No assistant content to save for chat {chat_id}")
                
                # Send completion signal with chat_id
                yield f"data: {json.dumps({'done': True, 'chat_id': chat_id})}\n\n"
                
            except Exception as e:
                error_data = json.dumps({'error': str(e)})
                yield f"data: {error_data}\n\n"
        
        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        )
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats', methods=['GET', 'OPTIONS'])
def get_chats():
    """Get all chats."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        return response
    
    try:
        chats = get_all_chats()
        return jsonify(chats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats', methods=['POST', 'OPTIONS'])
def create_new_chat():
    """Create a new chat or return existing empty chat."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        return response
    
    try:
        data = request.json or {}
        title = data.get('title', 'New Chat')
        model = data.get('model', 'gemma3:1b')
        
        # Check if there's an existing empty chat
        empty_chat_id = find_empty_chat()
        if empty_chat_id:
            chat = get_chat(empty_chat_id)
            return jsonify(chat), 200
        
        # Create new chat if no empty chat exists
        chat_id = create_chat(title, model)
        chat = get_chat(chat_id)
        return jsonify(chat), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats/<chat_id>', methods=['GET', 'OPTIONS'])
def get_chat_by_id(chat_id):
    """Get a specific chat with its messages."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        return response
    
    try:
        chat = get_chat(chat_id)
        if not chat:
            return jsonify({'error': 'Chat not found'}), 404
        return jsonify(chat)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats/<chat_id>', methods=['PUT', 'OPTIONS'])
def update_chat(chat_id):
    """Update a chat (e.g., title)."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'PUT, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        return response
    
    try:
        data = request.json or {}
        if 'title' in data:
            update_chat_title(chat_id, data['title'])
        chat = get_chat(chat_id)
        if not chat:
            return jsonify({'error': 'Chat not found'}), 404
        return jsonify(chat)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chats/<chat_id>', methods=['DELETE', 'OPTIONS'])
def delete_chat_by_id(chat_id):
    """Delete a chat."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        return response
    
    try:
        delete_chat(chat_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(debug=True, port=5001, threaded=True)

