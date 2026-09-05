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
RENDER_SERVER_URL = os.environ.get("RENDER_SERVER_URL", "http://127.0.0.1:3002").rstrip("/")

# ── Reframe engine ───────────────────────────────────────────────────────
# "v1" = YuNet (original), "v2" = MediaPipe + YOLOv8 (smarter tracking)
REFRAME_ENGINE = os.environ.get("REFRAME_ENGINE", "v2")

WORK_DIR = Path(
    os.environ.get("WORK_DIR")
    or Path(__file__).resolve().parent / "tmp"
)

POLL_INTERVAL_SECONDS = 5
CLAIM_TIMEOUT_MINUTES = 90

# ── VL discovery sweep ────────────────────────────────────────────────────
# When the VL server is available the worker first watches the WHOLE video
# (sparse frame sampling) so visually-viral moments the transcript missed
# still become candidates. The results merge with transcript-scored windows
# before the focused watch pass.

VL_DISCOVER_ENABLED = os.environ.get("VL_DISCOVER_ENABLED", "1") == "1"
VL_DISCOVER_FRAMES = int(os.environ.get("VL_DISCOVER_FRAMES", "12"))
VL_DISCOVER_BATCH = int(os.environ.get("VL_DISCOVER_BATCH", "12"))
VL_DISCOVER_WIDTH = int(os.environ.get("VL_DISCOVER_WIDTH", "384"))
VL_DISCOVER_MIN_DUR = float(os.environ.get("VL_DISCOVER_MIN_DUR", "15"))
VL_DISCOVER_MAX_DUR = float(os.environ.get("VL_DISCOVER_MAX_DUR", "90"))

# ── Hook overlays ────────────────────────────────────────────────────────
HOOKS_ENABLED = os.environ.get("HOOKS_ENABLED", "0") == "1"
HOOK_STYLE = os.environ.get("HOOK_STYLE", "classic")
HOOK_POSITION = os.environ.get("HOOK_POSITION", "top")
HOOK_DURATION = float(os.environ.get("HOOK_DURATION", "4"))

# ── Social posting ────────────────────────────────────────────────────────

POSTING_ENABLED = os.environ.get("POSTING_ENABLED", "1") == "1"
POST_POLL_INTERVAL = int(os.environ.get("POST_POLL_INTERVAL", "10"))

# TikTok
TIKTOK_CLIENT_KEY = os.environ.get("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.environ.get("TIKTOK_CLIENT_SECRET", "")

# YouTube / Google
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

# Instagram / Facebook
INSTAGRAM_CLIENT_ID = os.environ.get("INSTAGRAM_CLIENT_ID", "")
INSTAGRAM_CLIENT_SECRET = os.environ.get("INSTAGRAM_CLIENT_SECRET", "")
