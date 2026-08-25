"""Worker configuration from environment (.env supported)."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

LLAMA_SERVER_URL = os.environ.get("LLAMA_SERVER_URL", "").rstrip("/")
VIRAL_CSV_PATH = os.environ.get("VIRAL_CSV_PATH", "")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
VL_TOP_N = int(os.environ.get("VL_TOP_N", "8"))
RENDER_SERVER_URL = os.environ.get("RENDER_SERVER_URL", "http://127.0.0.1:3001").rstrip("/")

WORK_DIR = Path(
    os.environ.get("WORK_DIR")
    or Path(__file__).resolve().parent / "tmp"
)

POLL_INTERVAL_SECONDS = 5
CLAIM_TIMEOUT_MINUTES = 90  # jobs stuck in processing longer than this are reclaimable
