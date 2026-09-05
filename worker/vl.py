"""Stage 5: Qwen2.5-VL pass — discover viral moments + watch finalists.

Two passes:

1. DISCOVER — sample sparse frames across the WHOLE video and ask the model
   which timestamp ranges look most viral.  These become candidate windows
   that merge with transcript-scored picks so visually-hot moments with
   bland speech aren't silently dropped.

2. WATCH — the existing focused pass that re-scores every finalist (both
   transcript-picked and VL-discovered) with full per-window attention.

If LLAMA_SERVER_URL is unset or unreachable both passes are skipped and
heuristic scores stand — the pipeline never hard-fails because of it.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path
from typing import Any

import requests

import config

SYSTEM_PROMPT = (
    "You are a short-form video virality expert. You will see sampled frames "
    "from one candidate clip window plus its transcript. Judge it like a "
    "TikTok/Shorts algorithm would. Respond ONLY with minified JSON: "
    '{"score": <0-100 int>, "hook": "<3-word hook type>", '
    '"reasoning": "<one sentence>", "visual_energy": <0-10 int>}'
)

DISCOVER_PROMPT = (
    "You are a short-form video virality expert scouting a long-form video "
    "for moments worth clipping into TikToks / YouTube Shorts / Reels.\n\n"
    "You will see {count} sampled frames spanning the entire video. Each frame "
    "is labeled with its timestamp in seconds. Look for:\n"
    "- High-energy visual moments (dramatic reactions, physical comedy, "
    "climaxes, reveals, visual gags, emotional peaks)\n"
    "- Moments where something visually interesting happens even if the "
    "speaker's words are ordinary\n"
    "- Moments with rapid cuts, motion, or strong facial expressions\n"
    "- Avoid: static talking heads, low-energy stretches, intros/outros\n\n"
    "Return ONLY a minified JSON array of up to {max_ranges} ranges you think "
    "are most worth clipping. Each range must be 15-60 seconds long.\n"
    'Format: [{{"start": <seconds>, "end": <seconds>, '
    '"hook": "<3-word hook type>", '
    '"reasoning": "<one sentence>", "confidence": <0.0-1.0>}}]\n'
    "Return [] if nothing looks viral enough."
)


def available() -> bool:
    if not config.LLAMA_SERVER_URL:
        return False
    try:
        r = requests.get(f"{config.LLAMA_SERVER_URL}/health", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


# ── Frame sampling ────────────────────────────────────────────────────────


def sample_frames(
    video: Path,
    start: float,
    end: float,
    out_dir: Path,
    max_frames: int = 40,
) -> list[Path]:
    """Sample frames from a specific time range (watch pass)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    duration = max(end - start, 1)
    fps = min(1.0, max_frames / duration)
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", str(start), "-t", str(duration),
            "-i", str(video), "-vf", f"fps={fps},scale={config.VL_DISCOVER_WIDTH}:-2",
            str(out_dir / "f_%03d.jpg"),
        ],
        capture_output=True,
        timeout=300,
        check=True,
    )
    frames = sorted(out_dir.glob("f_*.jpg"))[:max_frames]
    return frames


def sample_frames_full_video(
    video: Path,
    total_duration: float,
    out_dir: Path,
) -> list[tuple[float, Path]]:
    """Sparse frames across the ENTIRE video (discovery pass).

    Returns list of (timestamp_seconds, frame_path) pairs.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    n = min(config.VL_DISCOVER_FRAMES, max(1, int(total_duration / 5)))
    fps = n / max(total_duration, 1)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(video),
            "-vf", f"fps={fps},scale={config.VL_DISCOVER_WIDTH}:-2",
            str(out_dir / "d_%03d.jpg"),
        ],
        capture_output=True,
        timeout=300,
        check=True,
    )
    frames = sorted(out_dir.glob("d_*.jpg"))[:n]
    return [
        (round(i * total_duration / max(len(frames), 1), 2), p)
        for i, p in enumerate(frames)
    ]


# ── VLM API calls ────────────────────────────────────────────────────────


def _ask_vlm(frames: list[Path], transcript: str) -> dict[str, Any] | None:
    content: list[dict[str, Any]] = []
    for f in frames:
        b64 = base64.b64encode(f.read_bytes()).decode()
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
        )
    content.append(
        {
            "type": "text",
            "text": f"Transcript of this clip:\n{transcript[:1500]}\n\nScore it.",
        }
    )

    try:
        resp = requests.post(
            f"{config.LLAMA_SERVER_URL}/v1/chat/completions",
            json={
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.2,
                "max_tokens": 220,
            },
            timeout=600,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        data = json.loads(match.group(0))
        return {
            "score": max(0, min(100, int(data.get("score", 0)))),
            "hook": str(data.get("hook", ""))[:40],
            "reasoning": str(data.get("reasoning", ""))[:300],
            "visual_energy": max(0, min(10, int(data.get("visual_energy", 5)))),
        }
    except Exception:
        return None


def _ask_discovery(
    frames: list[tuple[float, Path]],
    total_duration: float,
) -> list[dict[str, Any]]:
    """Ask the VLM to identify viral ranges across the whole video."""
    if not frames:
        return []

    content: list[dict[str, Any]] = []
    for ts, path in frames:
        b64 = base64.b64encode(path.read_bytes()).decode()
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
        )

    content.append(
        {
            "type": "text",
            "text": (
                f"Video duration: {total_duration:.0f}s. "
                f"{len(frames)} frames sampled roughly every "
                f"{total_duration / max(len(frames), 1):.0f}s.\n"
                "Identify the most viral-worthy clip ranges."
            ),
        }
    )

    max_ranges = max(1, config.VL_DISCOVER_FRAMES // 4)
    prompt = DISCOVER_PROMPT.format(count=len(frames), max_ranges=max_ranges)

    try:
        resp = requests.post(
            f"{config.LLAMA_SERVER_URL}/v1/chat/completions",
            json={
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.2,
                "max_tokens": 500,
            },
            timeout=600,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            return []
        items = json.loads(match.group(0))
        if not isinstance(items, list):
            return []

        results: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            s = float(item.get("start", 0))
            e = float(item.get("end", 0))
            if e - s < config.VL_DISCOVER_MIN_DUR:
                e = s + config.VL_DISCOVER_MIN_DUR
            if e - s > config.VL_DISCOVER_MAX_DUR:
                e = s + config.VL_DISCOVER_MAX_DUR
            e = min(e, total_duration)
            if e <= s + 5:
                continue
            results.append({
                "start": round(max(0, s), 2),
                "end": round(min(e, total_duration), 2),
                "hook": str(item.get("hook", ""))[:40],
                "reasoning": str(item.get("reasoning", ""))[:300],
                "confidence": round(min(1.0, max(0.0, float(item.get("confidence", 0.5)))), 2),
            })
        return results
    except Exception:
        return []


# ── Merge helpers ─────────────────────────────────────────────────────────


def _overlap_ratio(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    """Fraction of window [a] that overlaps with [b]."""
    overlap = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    return overlap / max(a_end - a_start, 0.001)


def _is_dup(disc: dict, finalists: list[dict]) -> bool:
    """True if discovery overlaps an existing finalist by >40%."""
    for f in finalists:
        if _overlap_ratio(disc["start"], disc["end"], f["start"], f["end"]) > 0.40:
            return True
    return False


def merge_discoveries(
    discoveries: list[dict[str, Any]],
    finalists: list[dict[str, Any]],
    transcript_segments: list[dict[str, Any]],
    max_slots: int,
) -> list[dict[str, Any]]:
    """Pick the best non-overlapping VL discoveries and merge into finalists.

    Returns a combined list sorted by score01, with at most max_slots
    discoveries that don't heavily overlap existing transcript-picked windows.
    """
    # Pull transcript text for each discovery window.
    for d in discoveries:
        text_parts = []
        for seg in transcript_segments:
            if seg["end"] > d["start"] and seg["start"] < d["end"]:
                text_parts.append(seg["text"])
        d["text"] = " ".join(text_parts)
        d["opens_after_pause"] = False
        d["sentence_count"] = len(text_parts)

    # Remove discoveries that duplicate existing finalists.
    non_dups = [d for d in discoveries if not _is_dup(d, finalists)]

    # Sort by confidence descending.
    non_dups.sort(key=lambda x: x["confidence"], reverse=True)

    # Take best N that don't overlap each other.
    chosen: list[dict] = []
    for d in non_dups:
        if len(chosen) >= max_slots:
            break
        if chosen and _is_dup(d, chosen):
            continue
        # Give them a baseline score01 so the watch pass can blend with verdict.
        # confidence 0-1 maps to 0.40-0.60 base.
        d["score01"] = round(0.40 + d["confidence"] * 0.20, 3)
        d["base_score"] = d["score01"]
        d["parts"] = {"vl_discovery": d["confidence"]}
        d["discovered_by"] = "vl"
        chosen.append(d)

    if not chosen:
        return finalists

    merged = finalists + chosen
    merged.sort(key=lambda x: x["score01"], reverse=True)
    return merged


# ── Public API ────────────────────────────────────────────────────────────


def discover(
    video: Path,
    total_duration: float,
    work_dir: Path,
) -> list[dict[str, Any]]:
    """Whole-video discovery sweep. Returns raw range dicts."""
    if not config.VL_DISCOVER_ENABLED:
        return []

    frames_dir = work_dir / "discovery_frames"
    frame_data = sample_frames_full_video(video, total_duration, frames_dir)
    if not frame_data:
        return []

    # Send in batches to avoid overwhelming the context window.
    batch_size = config.VL_DISCOVER_BATCH
    all_results: list[dict[str, Any]] = []

    for i in range(0, len(frame_data), batch_size):
        batch = frame_data[i : i + batch_size]
        results = _ask_discovery(batch, total_duration)
        all_results.extend(results)

    return all_results


def watch_finalists(
    video: Path,
    finalists: list[dict[str, Any]],
    section_files: list[Path | None],
    full_video: Path | None,
    work_dir: Path,
) -> list[dict[str, Any]]:
    """Blend VL verdicts into finalist scores; returns finalists in rank order."""
    if not available():
        for f in finalists:
            f["vl"] = None
        return finalists

    for i, w in enumerate(finalists):
        f = section_files[i] if i < len(section_files) else None
        if f is None:
            f = full_video
        if f is None:
            w["vl"] = None
            continue

        sec = section_files[i] if i < len(section_files) else None
        v_start = 0.0 if sec else float(w["start"])
        v_end = v_start + float(w["end"]) - float(w["start"])

        frames_dir = work_dir / f"frames_{i}"
        try:
            frames = sample_frames(Path(f), v_start, float(v_end), frames_dir)
        except Exception:
            frames = []
        verdict = _ask_vlm(frames, w["text"]) if frames else None

        if verdict is None:
            w["vl"] = None
            continue

        # Blend: existing 60% · VL 40%.
        blended01 = w["score01"] * 0.60 + (verdict["score"] / 100) * 0.40
        w["score01"] = round(min(blended01, 1.0), 3)
        w["vl"] = verdict

    finalists.sort(key=lambda x: x["score01"], reverse=True)
    return finalists
