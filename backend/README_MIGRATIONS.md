# Database Migrations with Flask-Migrate

This project uses SQLAlchemy with Flask-Migrate for database schema management.

## Initial Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Initialize the migration repository:**
   ```bash
   export FLASK_APP=app.py  # On Windows: set FLASK_APP=app.py
   flask db init
   ```
   This creates a `migrations/` directory with migration scripts.

3. **Create the initial migration:**
   ```bash
   export FLASK_APP=app.py
   flask db migrate -m "Initial migration with UUID chat IDs"
   ```
   This creates a migration file based on your current models.

4. **Apply the migration:**
   ```bash
   export FLASK_APP=app.py
   flask db upgrade
   ```
   This creates the database tables.

## Working with Migrations

### Creating a New Migration

After making changes to your models (`models.py`):

```bash
flask db migrate -m "Description of changes"
```

### Applying Migrations

```bash
flask db upgrade
```

### Rolling Back a Migration

```bash
flask db downgrade
```

To roll back to a specific revision:
```bash
flask db downgrade <revision>
```

### Viewing Migration History

```bash
flask db history
```

### Viewing Current Revision

```bash
flask db current
```

## Environment Variables

**Important:** The Flask CLI (`flask` command) does not automatically load `.env` files. You need to export `FLASK_APP` before running migration commands:

```bash
export FLASK_APP=app.py  # On Windows: set FLASK_APP=app.py
flask db migrate -m "Description"
```

Or you can set it for the current session:
```bash
export FLASK_APP=app.py
```

**Note:** The `.env` file is automatically loaded when you run `python app.py` (the Flask app itself), but the Flask CLI commands require `FLASK_APP` to be exported in your shell environment.

**Tip:** You can add `export FLASK_APP=app.py` to your shell profile (`.bashrc`, `.zshrc`, etc.) to make it persistent.

## Notes

- The database file (`chats.db`) is created in the `backend/` directory
- Migrations are stored in the `migrations/` directory
- Always review migration files before applying them
- In production, test migrations on a copy of your database first

