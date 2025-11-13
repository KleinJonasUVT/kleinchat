# KleinChat

A minimalistic chat interface for streaming responses from local Ollama models (Gemma 3:1b).

## Project Structure

```
kleinchat/
├── backend/
│   ├── app.py                  # Flask backend with streaming endpoint
│   ├── models.py               # SQLAlchemy models (Chat, Message)
│   ├── database.py             # Database operations using SQLAlchemy
│   ├── requirements.txt        # Python dependencies
│   ├── README_MIGRATIONS.md    # Database migration guide
│   ├── migrations/             # Flask-Migrate migration files (created after init)
│   └── chats.db                # SQLite database (created after migration)
├── frontend/
│   ├── public/
│   │   └── index.html          # HTML template
│   ├── src/
│   │   ├── App.jsx             # Main chat component with routing
│   │   ├── ChatView.jsx        # Chat view component
│   │   ├── CodeBlock.jsx       # Code block component with syntax highlighting
│   │   ├── App.css             # Styles for the chat interface
│   │   ├── index.jsx           # React entry point
│   │   └── index.css           # Global styles
│   └── package.json            # Node.js dependencies
├── .gitignore
└── README.md
```

## Prerequisites

1. **Python 3.8+** installed
2. **Node.js 16+** and npm installed
3. **Ollama** installed and running
4. **Gemma 3:1b model** pulled in Ollama

### Installing Ollama and Pulling the Model

1. Install Ollama from [https://ollama.com](https://ollama.com)
2. Pull the Gemma 3:1b model:
   ```bash
   ollama pull gemma3:1b
   ```

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment (recommended):
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Create a `.env` file in the backend directory:
   ```bash
   cp .env.example .env
   ```
   
   Or manually create `backend/.env` with:
   ```
   FLASK_APP=app.py
   FLASK_ENV=development
   ```

5. Set up the database with Flask-Migrate:
   ```bash
   flask db init
   flask db migrate -m "Initial migration with UUID chat IDs"
   flask db upgrade
   ```
   
   **Note:** The `FLASK_APP` environment variable is now loaded from the `.env` file automatically.
   
   For detailed migration instructions, see [backend/README_MIGRATIONS.md](backend/README_MIGRATIONS.md).

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

## Running the Application

### Step 1: Start the Backend

In a terminal, navigate to the backend directory and run:

```bash
cd backend
source venv/bin/activate  # If using virtual environment
python app.py
```

The Flask server will start on `http://localhost:5001`.

**Note:** Port 5000 is used by macOS AirPlay Receiver by default, so we use port 5001 to avoid conflicts.

### Step 2: Start the Frontend

In a **new terminal**, navigate to the frontend directory and run:

```bash
cd frontend
npm start
```

The React app will start on `http://localhost:3000` and automatically open in your browser.

## How It Works

### Backend (Flask)

- **Endpoint**: `POST /api/chat`
- **Request Body**: 
  ```json
  {
    "message": "Your message here",
    "model": "gemma3:1b"
  }
  ```
- **Response**: Server-Sent Events (SSE) stream with chunks of the response
- **Streaming**: Uses Ollama's streaming API to send responses token by token

### Frontend (React)

- **Chat Interface**: Minimalistic design with sidebar and main chat area
- **Streaming**: Reads SSE stream and updates the UI in real-time as tokens arrive
- **Features**:
  - Send messages via input field or Enter key
  - View streaming responses
  - Model selector (currently gemma3:1b)
  - Chat history sidebar (UI only, not persisted)

### Communication Flow

1. User types a message and clicks send (or presses Enter)
2. Frontend sends POST request to `http://localhost:5001/api/chat`
3. Backend receives request and starts streaming from Ollama
4. Backend sends response chunks via Server-Sent Events (SSE)
5. Frontend reads the stream and updates the chat UI in real-time

## API Endpoints

### `POST /api/chat`

Streams a chat response from Ollama.

**Request:**
```json
{
  "message": "Hello, how are you?",
  "model": "gemma3:1b"
}
```

**Response:** Server-Sent Events stream
```
data: {"content": "Hello"}
data: {"content": "!"}
data: {"content": " I"}
...
data: {"done": true}
```

### `GET /api/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## Troubleshooting

### Backend Issues

- **Port 5001 already in use**: Change the port in `backend/app.py` (line 85)
- **Ollama connection error**: Make sure Ollama is running (`ollama serve`)
- **Model not found**: Run `ollama pull gemma3:1b`

### Frontend Issues

- **CORS errors**: Make sure `flask-cors` is installed and the backend is running
- **Connection refused**: Verify the backend is running on port 5001
- **Port 3000 already in use**: React will prompt to use a different port

### General Issues

- **Streaming not working**: Check browser console and backend terminal for errors
- **Messages not appearing**: Verify both frontend and backend are running

## Development

### Backend Development

- The Flask app runs in debug mode by default
- Changes to `app.py` will auto-reload the server

### Frontend Development

- React runs in development mode with hot-reloading
- Changes to React components will automatically refresh the browser

## Production Build

To build the frontend for production:

```bash
cd frontend
npm run build
```

The built files will be in `frontend/build/`. You can serve them with any static file server or integrate with the Flask backend.

## License

MIT

