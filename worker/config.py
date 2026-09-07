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

# Optional Netscape-format cookie file (YouTube bot-wall bypass). When set it
# becomes the first download strategy, ahead of the player-client tricks.
YTDLP_COOKIES_FILE = os.environ.get("YTDLP_COOKIES_FILE", "")

# HTTP(S)/SOCKS proxy for yt-dlp. YouTube blocks datacenter IPs at the
# playability gate before any PO token is checked; routing through a
# proxy (e.g. Cloudflare WARP SOCKS5 on 127.0.0.1:40000) makes the
# request egress from a non-flagged IP.
YTDLP_PROXY = os.environ.get("YTDLP_PROXY", "")

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

# ── Clip memory / smarter pipeline ───────────────────────────────────────
# Cache per-source analysis (download + transcribe + scenes) on disk and
# record every clip decision in the DB so re-submits pick fresh windows →
# untried style variants → supercut combos instead of duplicating clips.
CLIP_MEMORY_ENABLED = os.environ.get("CLIP_MEMORY_ENABLED", "1") == "1"

# ── Content type / streamer mode ─────────────────────────────────────────
# "auto" (podcast behaviour) | "podcast" | "streamer". When a job is
# streamer content the hook→question→payoff candidate generation is disabled
# and replaced by the streamer moment funnel (cheap event detection →
# dense Qwen3-VL multimodal analysis → multi-dimension scoring).
STREAMER_MODE = os.environ.get("STREAMER_MODE", "0") == "1"

# Cheap event detection bandwidth + sensitivity.
STREAMER_MAX_EVENTS = int(os.environ.get("STREAMER_MAX_EVENTS", "120"))
STREAMER_MAX_SEQUENCES = int(os.environ.get("STREAMER_MAX_SEQUENCES", "36"))
STREAMER_MERGE_GAP = float(os.environ.get("STREAMER_MERGE_GAP", "6.0"))
STREAMER_AUDIO_BUCKET = float(os.environ.get("STREAMER_AUDIO_BUCKET", "0.5"))
# Above this merged span a sequence is re-split at its largest internal gaps,
# so dense camera-cut events can't glue an entire stream into one cluster.
STREAMER_MAX_SEQ_SPAN = float(os.environ.get("STREAMER_MAX_SEQ_SPAN", "120.0"))

# Context windows per detected event.
STREAMER_CONTEXT_VARIANTS = int(os.environ.get("STREAMER_CONTEXT_VARIANTS", "4"))
STREAMER_CONTEXT_PRE = float(os.environ.get("STREAMER_CONTEXT_PRE", "12.0"))
STREAMER_CONTEXT_POST = float(os.environ.get("STREAMER_CONTEXT_POST", "16.0"))
STREAMER_CONTEXT_SPREAD = float(os.environ.get("STREAMER_CONTEXT_SPREAD", "0.5"))

# Dense multimodal sampling inside each event window.
STREAMER_DENSE_FRAMES = int(os.environ.get("STREAMER_DENSE_FRAMES", "9"))
STREAMER_DENSE_WIDTH = int(os.environ.get("STREAMER_DENSE_WIDTH", "512"))
STREAMER_ANALYZE_PRE = float(os.environ.get("STREAMER_ANALYZE_PRE", "6.0"))
STREAMER_ANALYZE_POST = float(os.environ.get("STREAMER_ANALYZE_POST", "8.0"))

# Qwen3-VL two-pass budget.
STREAMER_PASS_A_LIMIT = int(os.environ.get("STREAMER_PASS_A_LIMIT", "24"))
STREAMER_PASS_B_LIMIT = int(os.environ.get("STREAMER_PASS_B_LIMIT", "12"))
STREAMER_TEMPERATURE = float(os.environ.get("STREAMER_TEMPERATURE", "0.2"))

# Final cut boundaries (Qwen picks; these clamp the result at render time).
STREAMER_MIN_CLIP = float(os.environ.get("STREAMER_MIN_CLIP", "8.0"))
STREAMER_MAX_CLIP = float(os.environ.get("STREAMER_MAX_CLIP", "90.0"))

# TikTok
TIKTOK_CLIENT_KEY = os.environ.get("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.environ.get("TIKTOK_CLIENT_SECRET", "")

# YouTube / Google
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

# Instagram / Facebook
INSTAGRAM_CLIENT_ID = os.environ.get("INSTAGRAM_CLIENT_ID", "")
INSTAGRAM_CLIENT_SECRET = os.environ.get("INSTAGRAM_CLIENT_SECRET", "")
