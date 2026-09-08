"""Worker configuration from environment (.env supported)."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


def _env(name, default=""):
    """os.environ.get that treats an explicit empty value as missing.

    .env templates ship empty placeholders (FOO=) for optional settings;
    those must fall back to the default instead of crashing float()/int().
    """
    val = os.environ.get(name, "")
    return default if val == "" else val


SUPABASE_URL = _env("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY", "")

LLAMA_SERVER_URL = _env("LLAMA_SERVER_URL", "").rstrip("/")
VIRAL_CSV_PATH = _env("VIRAL_CSV_PATH", "")
WHISPER_MODEL = _env("WHISPER_MODEL", "base")
VL_TOP_N = int(_env("VL_TOP_N", "8"))
RENDER_SERVER_URL = _env("RENDER_SERVER_URL", "http://127.0.0.1:3002").rstrip("/")

# Optional Netscape-format cookie file (YouTube bot-wall bypass). When set it
# becomes the first download strategy, ahead of the player-client tricks.
YTDLP_COOKIES_FILE = _env("YTDLP_COOKIES_FILE", "")

# HTTP(S)/SOCKS proxy for yt-dlp. YouTube blocks datacenter IPs at the
# playability gate before any PO token is checked; routing through a
# proxy (e.g. Cloudflare WARP SOCKS5 on 127.0.0.1:40000) makes the
# request egress from a non-flagged IP.
YTDLP_PROXY = _env("YTDLP_PROXY", "")

# ── Reframe engine ───────────────────────────────────────────────────────
# "v1" = YuNet (original), "v2" = MediaPipe + YOLOv8 (smarter tracking)
REFRAME_ENGINE = _env("REFRAME_ENGINE", "v2")

WORK_DIR = Path(
    _env("WORK_DIR", "")
    or Path(__file__).resolve().parent / "tmp"
)

POLL_INTERVAL_SECONDS = 5
CLAIM_TIMEOUT_MINUTES = 90

# ── VL discovery sweep ────────────────────────────────────────────────────
# When the VL server is available the worker first watches the WHOLE video
# (sparse frame sampling) so visually-viral moments the transcript missed
# still become candidates. The results merge with transcript-scored windows
# before the focused watch pass.

VL_DISCOVER_ENABLED = _env("VL_DISCOVER_ENABLED", "1") == "1"
VL_DISCOVER_FRAMES = int(_env("VL_DISCOVER_FRAMES", "12"))
VL_DISCOVER_BATCH = int(_env("VL_DISCOVER_BATCH", "12"))
VL_DISCOVER_WIDTH = int(_env("VL_DISCOVER_WIDTH", "384"))
VL_DISCOVER_MIN_DUR = float(_env("VL_DISCOVER_MIN_DUR", "15"))
VL_DISCOVER_MAX_DUR = float(_env("VL_DISCOVER_MAX_DUR", "90"))

# ── Hook overlays ────────────────────────────────────────────────────────
HOOKS_ENABLED = _env("HOOKS_ENABLED", "0") == "1"
HOOK_STYLE = _env("HOOK_STYLE", "classic")
HOOK_POSITION = _env("HOOK_POSITION", "top")
HOOK_DURATION = float(_env("HOOK_DURATION", "4"))

# ── Social posting ────────────────────────────────────────────────────────

POSTING_ENABLED = _env("POSTING_ENABLED", "1") == "1"
POST_POLL_INTERVAL = int(_env("POST_POLL_INTERVAL", "10"))

# ── Clip memory / smarter pipeline ───────────────────────────────────────
# Cache per-source analysis (download + transcribe + scenes) on disk and
# record every clip decision in the DB so re-submits pick fresh windows →
# untried style variants → supercut combos instead of duplicating clips.
CLIP_MEMORY_ENABLED = _env("CLIP_MEMORY_ENABLED", "1") == "1"

# ── Content type / streamer mode ─────────────────────────────────────────
# "auto" (podcast behaviour) | "podcast" | "streamer". When a job is
# streamer content the hook→question→payoff candidate generation is disabled
# and replaced by the streamer moment funnel (cheap event detection →
# dense Qwen3-VL multimodal analysis → multi-dimension scoring).
STREAMER_MODE = _env("STREAMER_MODE", "0") == "1"

# Cheap event detection bandwidth + sensitivity.
STREAMER_MAX_EVENTS = int(_env("STREAMER_MAX_EVENTS", "120"))
STREAMER_MAX_SEQUENCES = int(_env("STREAMER_MAX_SEQUENCES", "36"))
STREAMER_MERGE_GAP = float(_env("STREAMER_MERGE_GAP", "6.0"))
STREAMER_AUDIO_BUCKET = float(_env("STREAMER_AUDIO_BUCKET", "0.5"))
# Above this merged span a sequence is re-split at its largest internal gaps,
# so dense camera-cut events can't glue an entire stream into one cluster.
STREAMER_MAX_SEQ_SPAN = float(_env("STREAMER_MAX_SEQ_SPAN", "120.0"))

# Context windows per detected event.
STREAMER_CONTEXT_VARIANTS = int(_env("STREAMER_CONTEXT_VARIANTS", "4"))
STREAMER_CONTEXT_PRE = float(_env("STREAMER_CONTEXT_PRE", "12.0"))
STREAMER_CONTEXT_POST = float(_env("STREAMER_CONTEXT_POST", "16.0"))
STREAMER_CONTEXT_SPREAD = float(_env("STREAMER_CONTEXT_SPREAD", "0.5"))

# Dense multimodal sampling inside each event window.
STREAMER_DENSE_FRAMES = int(_env("STREAMER_DENSE_FRAMES", "9"))
STREAMER_DENSE_WIDTH = int(_env("STREAMER_DENSE_WIDTH", "512"))
STREAMER_ANALYZE_PRE = float(_env("STREAMER_ANALYZE_PRE", "6.0"))
STREAMER_ANALYZE_POST = float(_env("STREAMER_ANALYZE_POST", "8.0"))

# Qwen3-VL two-pass budget.
STREAMER_PASS_A_LIMIT = int(_env("STREAMER_PASS_A_LIMIT", "24"))
STREAMER_PASS_B_LIMIT = int(_env("STREAMER_PASS_B_LIMIT", "12"))
STREAMER_TEMPERATURE = float(_env("STREAMER_TEMPERATURE", "0.2"))

# Final cut boundaries (Qwen picks; these clamp the result at render time).
STREAMER_MIN_CLIP = float(_env("STREAMER_MIN_CLIP", "8.0"))
STREAMER_MAX_CLIP = float(_env("STREAMER_MAX_CLIP", "90.0"))

# TikTok
TIKTOK_CLIENT_KEY = _env("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = _env("TIKTOK_CLIENT_SECRET", "")

# YouTube / Google
GOOGLE_CLIENT_ID = _env("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = _env("GOOGLE_CLIENT_SECRET", "")

# Instagram / Facebook
INSTAGRAM_CLIENT_ID = _env("INSTAGRAM_CLIENT_ID", "")
INSTAGRAM_CLIENT_SECRET = _env("INSTAGRAM_CLIENT_SECRET", "")