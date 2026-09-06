"""Clip memory: source-key normalization, analysis caching, variation picking.

The "smarter pipeline":
  1. Every source URL is normalized to a stable source_key (YouTube video ID
     extracted, other URLs hashed).
  2. The expensive analysis (download → transcribe → scene detect) is cached on
     disk keyed by source_key. Re-submitting the same video skips it entirely.
  3. Every clip decision the worker makes is recorded in the DB (clip_memory):
       window         → a fresh arc window, never clipped before
       style_variant  → the same window re-cut with a different caption combo
       combo          → a multi-window supercut (when a video is exhausted)
     Picking for a new job tries fresh windows first, then style variants that
     haven't been used, then supercuts. Runs never repeat an identical clip.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any, Iterator

import config
import segment

MAX_WINDOW = segment.MAX_WINDOW

# ── source keys ─────────────────────────────────────────────────────────────

_YT_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?[^#]*v=|shorts/|embed/|live/|v/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{6,16})",
    re.IGNORECASE,
)


def source_key(url: str) -> str:
    """Canonical key for a source URL.

    YouTube URLs collapse to the video ID (`yt:<ID>`) so watch?v=, youtu.be,
    shorts, embed and live variants all cache together. Everything else becomes
    a stable sha1 of the normalized URL.
    """
    if not url:
        return "unknown"
    m = _YT_ID_RE.search(url)
    if m:
        return f"yt:{m.group(1)}"
    norm = url.strip().lower().rstrip("/")
    return "url:" + hashlib.sha1(norm.encode("utf-8")).hexdigest()[:20]


def window_key(start: float, end: float) -> str:
    """Stable id for a clip's time window (0.1s precision)."""
    return f"{float(start):.1f}-{float(end):.1f}"


def style_sig(
    style: str, font: str, sub: str, theme: str, reframe_style: str
) -> str:
    return f"{style}|{font}|{sub}|{theme}|{reframe_style}"


# ── analysis + media cache (disk, per source_key) ───────────────────────────


def cache_dir(source_key: str) -> Path:
    d = config.WORK_DIR / "cache" / source_key.replace("/", "_")
    d.mkdir(parents=True, exist_ok=True)
    return d


def analysis_path(source_key: str) -> Path:
    return cache_dir(source_key) / "analysis.json"


def video_path(source_key: str) -> Path:
    return cache_dir(source_key) / "source.mp4"


def audio_path(source_key: str) -> Path:
    return cache_dir(source_key) / "audio.wav"


def save_analysis(
    source_key: str,
    transcript: dict[str, Any],
    scenes: list[tuple[float, float]],
    total_duration: float,
) -> None:
    """Persist the full analysis for later re-submits (skips re-download etc.)."""
    payload = {
        "transcript": transcript,
        "scenes": scenes,
        "total_duration": total_duration,
    }
    tmp = analysis_path(source_key).with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    shutil.move(str(tmp), analysis_path(source_key))


def load_analysis(source_key: str) -> dict[str, Any] | None:
    """Return cached {transcript, scenes, total_duration} or None."""
    p = analysis_path(source_key)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not data.get("transcript") or "segments" not in data["transcript"]:
            return None
        return data
    except Exception:
        return None


def ensure_cached_media(
    source_key: str, full_video: Path, wav: Path
) -> None:
    """Mirror a freshly downloaded full video + wav into the cache dir so a
    re-submit of the same video can skip download entirely."""
    vp = video_path(source_key)
    if not vp.exists() and full_video.exists():
        try:
            shutil.copy2(full_video, vp)
        except OSError:
            pass
    ap = audio_path(source_key)
    if not ap.exists() and wav.exists():
        try:
            shutil.copy2(wav, ap)
        except OSError:
            pass


def cached_video_available(source_key: str) -> bool:
    return video_path(source_key).exists() and video_path(source_key).stat().st_size > 1_000_000


# ── style combo iteration ────────────────────────────────────────────────────

STYLES = ["pop", "karaoke", "pill", "boxed", "minimal", "two_tone"]
FONTS = ["anton", "impact", "outfit", "poppins", "montserrat", "rajdhani"]
SUBS = ["zoom", "plain", "bounce", "fade", "wave", "rotate"]
THEMES = ["pop", "karaoke", "hustle", "grape", "beast", "poppin"]
REFRAMES = ["track", "blur"]


def style_combos() -> Iterator[tuple[str, str, str, str, str]]:
    """Deterministic iteration of all caption combos. Prefer theme + sub + font
    changes first (visually obvious), then style, then reframe engine."""
    for theme in THEMES:
        for sub in SUBS:
            for font in FONTS:
                for style in STYLES:
                    for reframe in REFRAMES:
                        yield style, font, sub, theme, reframe


# ── DB helpers ──────────────────────────────────────────────────────────────


def list_used(
    org_id: str, source_key: str
) -> list[dict[str, Any]]:
    """All clip decisions previously made for this source in this workspace."""
    import supabase_client as db

    return db.list_clip_memory(org_id, source_key)


def pick_variations(
    ranked: list[dict[str, Any]],
    clip_count: int,
    org_id: str,
    source_key: str,
    base_style: str,
    base_font: str,
    base_sub: str,
    base_theme: str,
    base_reframe: str,
) -> list[dict[str, Any]]:
    """Pick `clip_count` clips for THIS job using memory:
    fresh windows → untried style variants → supercuts.

    Each returned window dict gains:
      - memory_kind  ("window" | "style_variant" | "combo")
      - style override fields (caption_style/font/sub/theme/reframe_style)
      - `combo` entries get extra_segments: [w2, w3, ...] for stitching
    """
    used = list_used(org_id, source_key)
    used_keys = {u["window_key"] for u in used}
    used_by_key: dict[str, list[str]] = {}
    for u in used:
        used_by_key.setdefault(u["window_key"], []).append(u["style_sig"])

    dones: list[dict[str, Any]] = []

    # 1 · Fresh arc windows never clipped for this source.
    fresh = [
        w for w in ranked
        if window_key(float(w["start"]), float(w["end"])) not in used_keys
    ]
    for w in fresh:
        if len(dones) >= clip_count:
            break
        w["memory_kind"] = "window"
        w["caption_style"] = base_style
        w["caption_font"] = base_font
        w["caption_sub"] = base_sub
        w["caption_theme"] = base_theme
        w["reframe_style"] = base_reframe
        dones.append(w)

    # 2 · Style variants — pick the highest-ranked used windows and give each
    #     a caption combo it hasn't been cut with yet. Prefer strong arcs.
    if len(dones) < clip_count:
        for w in ranked:
            if len(dones) >= clip_count:
                break
            key = window_key(float(w["start"]), float(w["end"]))
            if key in used_keys:
                used_sigs = set(used_by_key.get(key, []))
                for combo in style_combos():
                    sig = style_sig(*combo)
                    if combo[1] == base_font and sig in used_sigs:
                        continue
                    if sig not in used_sigs:
                        w["memory_kind"] = "style_variant"
                        w["caption_style"], w["caption_font"], w["caption_sub"], \
                            w["caption_theme"], w["reframe_style"] = combo
                        dones.append(w)
                        break

    # 3 · Supercuts — stitch THIS window + the next unused windows into one
    #     longer clip so a video keeps yielding even after every fresh window
    #     and style variant is exhausted. Combo span is capped at MAX_WINDOW.
    if len(dones) < clip_count:
        for w in ranked:
            if len(dones) >= clip_count:
                break
            key = window_key(float(w["start"]), float(w["end"]))
            if key in used_keys:
                continue
            start = float(w["start"])
            end = float(w["end"])
            extra: list[dict[str, Any]] = []
            for other in ranked:
                if other is w:
                    continue
                if window_key(float(other["start"]), float(other["end"])) in used_keys:
                    continue
                if float(other["start"]) < end - 2.0:
                    continue  # overlaps the current supercut already
                if float(other["end"]) - start > MAX_WINDOW:
                    break
                extra.append(other)
                end = float(other["end"])
            if not extra:
                continue  # nothing to combine — a plain fresh window already took slot 2
            w["memory_kind"] = "combo"
            w["extra_segments"] = extra
            w["end"] = round(end, 2)
            w["caption_style"] = base_style
            w["caption_font"] = base_font
            w["caption_sub"] = base_sub
            w["caption_theme"] = base_theme
            w["reframe_style"] = base_reframe
            dones.append(w)

    return dones[:clip_count]