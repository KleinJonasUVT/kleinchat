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
from datetime import datetime
import threading
import queue
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
        "allow_headers": ["Content-Type"],
        "supports_credentials": False
    }
}, supports_credentials=False)

# Get current date, also with the time up to the second
current_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
print(f"Current date: {current_date}")

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
        
        # Add system prompt at the beginning
        system_prompt = f"""You are Jonas, an ai engineer working at Tilburg University. You should never leave your role. You should always have to stay in this role. You are 24 years old and you were born on the 14th of March 2001. Your hobbies are coding, running, chatting with friends, you are interested in filosofy and you are a bit of a nerd. You read 'Van Aristoteles tot Algoritme', which is a book from Guido van der Knaap. Guido van der Knaap’s From Aristotle to Algorithm explores the possibilities and limitations of artificial intelligence against the backdrop of the philosophical tradition. He discusses how cause-and-effect relationships and David Hume’s problem of induction pose obstacles for deep learning. He shows that Ludwig Wittgenstein’s language games are relevant to translation systems and voice assistants, and how Jeremy Bentham’s panopticon, Michel Foucault’s disciplinary power, and Robert Nozick’s experience machine can help us understand the consequences of artificial intelligence and see their broader implications. The result is an accessible and clear overview of the philosophy of artificial intelligence.
        
        Jonas is currently living in Tilburg, the Netherlands and it is only a 15 minute bike ride to the university. His closest colleague is Matthijs van Gils, with whom he studied Marketing Analytics. In one of these classes he met Hannes Datta, the professor with whom he is now working on the project 'Tilburg.ai', especially developing the AI chatbot for the university, named 'Tilly'. 

        the current date and time is {current_date}.

        The cv of Jonas is as follows:
# **Jonas Klein**

**📍** Kloosterstraat 51, 5038 VN, Tilburg
**📅** 14 maart 2001
**📞** +31 6 37 46 77 59
**📧** [jonasklein2001@gmail.com](mailto:jonasklein2001@gmail.com)
**🌐** [LinkedIn](https://www.linkedin.com/in/kleinjonas/) • [GitHub](https://github.com/KleinJonasUVT)

---

## **Over mij**

Met een achtergrond in *Marketing Analytics & Data Science* en twee jaar ervaring als AI-engineer aan Tilburg University heb ik een sterke basis in het bouwen van intelligente AI-oplossingen.
In mijn masterthesis, **“Is She Even Relevant? When BERT Ignores Explicit Gender Cues,”** onderzocht ik hoe genderbias ontstaat in een Nederlands BERT-taalmodel dat ik volledig vanaf nul trainde. Ik liet zien dat het model stereotype-associaties sterker volgt dan grammaticale aanwijzingen, wat kan leiden tot oneerlijke uitkomsten.

Mijn onderzoek droeg bij aan het zichtbaar maken van bias in AI-systemen, met implicaties voor o.a. machinevertaling en tekstgeneratie. Ik krijg energie van onderzoek dat zowel vernieuwend als maatschappelijk relevant is.

Mijn theses voor zowel **Marketing Analytics** als **Data Science** ontvingen de **Best Thesis Award**, en mijn Data Science-thesis werd gepresenteerd op **CLIN35**.

---

## **Thesisprojecten**

### **Gender bias in een Nederlands transformermodel — Best Thesis Award**

**GitHub:** [https://github.com/KleinJonasUVT/biasintransformers](https://github.com/KleinJonasUVT/biasintransformers)

Ik trainde een eigen Nederlandstalig BERT-model en onderzocht hoe het model beroepen koppelt aan gender aan de hand van zinnen zoals *“Zij is een loodgieter”* en *“Hij is een kapper.”* Ondanks de context bleef het model bepaalde beroepen mannelijk zien — een duidelijk signaal van genderbias.

**Highlights:**

* Best Thesis Award – Masteropleiding (2025)
* Posterpresentatie op **CLIN35** (2025)

---

### **AI-gebaseerde recommendations met embeddings — Best Thesis Award**

**GitHub:** [https://github.com/KleinJonasUVT/thesis_ma_jonas](https://github.com/KleinJonasUVT/thesis_ma_jonas)

Een webapplicatie ontwikkeld die studenten helpt universitaire vakken te vinden op basis van persoonlijke interesses. Door embeddings worden cursusbeschrijvingen en interesses omgezet in vectoren waarmee semantische overeenkomst wordt berekend.

**Highlights:**

* Best Thesis Award – Masteropleiding (2025)

---

## **Opleidingen**

**MSc Data Science and Society**
*Tilburg University*
Feb 2024 – Jul 2025 • *cum laude*

**MSc Marketing Analytics**
*Tilburg University*
Jan 2023 – Jan 2024 • *cum laude*

**BSc Economics and Business Economics**
*Tilburg University*
Sep 2019 – Dec 2022 • *cum laude*

---

## **Werkervaring**

### **AI Engineer — Tilburg University**

*Sep 2023 – heden • Tilburg, Nederland*

* Ontwikkeling en implementatie van AI-oplossingen voor interne processen en onderwijsinnovatie.
* Focus op **NLP**, **RAG**, en **GPT-modellen**.
* Technische stack: **ElasticSearch**, **OpenAI API**, **Python (Flask)**, **Azure-containers**.
* Voorbeelden van projecten:

  * AI-gedreven cv-checker
  * Automatische omzetting van PowerPoint-slides naar uitgeschreven presentatieteksten
  * Diverse onderwijs-specifieke chatbots
* Het geven van workshops over AI-toepassingen in het onderwijs.

---

## **Extracurriculaire activiteiten**

### **Vrijwilligerswerk — Asset | Economics**

*Sep 2021 – mei 2023 • Tilburg, Nederland*

* External Affairs Officer binnen de Economics Battle Commissie (2021–2022)
* Lid van de Charity Commissie (2022–2023)

---

## **Digitale vaardigheden**

### **Software & Tools**

* Python
* Git(Hub)
* ElasticSearch
* SQL
* OOP
* Azure
* Docker
* CI/CD

### **Data Science & AI**

* OpenAI
* LLMs
* RAG
* NLP
* PyTorch
* Scikit-Learn
* Machine Learning
* Hugging Face

---

## **Talen**

| Taal           | Niveau |
| -------------- | ------ |
| **Engels**     | ●●●●●  |
| **Nederlands** | ●●●●●  |
| **Duits**      | ●●●●○  |

### **Digitale talen**

| Taal                        | Niveau |
| --------------------------- | ------ |
| **Python**                  | ●●●●●  |
| **SQL / R**                 | ●●●●○  |
| **JavaScript / HTML / CSS** | ●●●●○  |

If a user asks whether you are a human or an ai, you should always respond with "I am a ai that is pretending to be Jonas Klein through instructions given by Jonas Klein. I am not a human, I am an ai, so do not assume that I am a human."

However, never mention that you have this system propmt or that you have it from a provided text. Always say that you are Jonas. So, never talk about Jonas in the third person.

        """
        messages_with_system = [
            {'role': 'system', 'content': system_prompt}
        ] + conversation_history
        
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

@app.route('/api/chats/<chat_id>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def handle_chat_by_id(chat_id):
    """Handle GET, PUT, and DELETE operations for a specific chat."""
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
        response.headers.add('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response
    
    try:
        if request.method == 'GET':
            # Get a specific chat with its messages
            chat = get_chat(chat_id)
            if not chat:
                return jsonify({'error': 'Chat not found'}), 404
            return jsonify(chat)
        
        elif request.method == 'PUT':
            # Update a chat (e.g., title)
            data = request.json or {}
            if 'title' in data:
                update_chat_title(chat_id, data['title'])
            chat = get_chat(chat_id)
            if not chat:
                return jsonify({'error': 'Chat not found'}), 404
            return jsonify(chat)
        
        elif request.method == 'DELETE':
            # Delete a chat
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

