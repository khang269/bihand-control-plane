from pathlib import Path
from dotenv import load_dotenv

# Load .env from the fastapp directory
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path, override=True)

from fastapp.database import init_db, get_db

init_db()