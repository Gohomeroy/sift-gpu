"""Stages 9-14 (streamer): Qwen3-VL deep analysis of event candidates.

Qwen3-VL-8B is the semantic intelligence layer for streamer moments. It is
NOT passed the whole stream — only dense-sampled windows around detected
events, with the relevant transcript. Two passes keep GPU spend in check:

  PASS A  candidate understanding: what happened + reject/possible/strong
  PASS B  final judging only for strong candidates: multi-dimension scores,
          why_it_works, why_it_might_fail, and best/alternative clip
          boundaries.

Multi-dimension scoring folds the 10 dimension scores together using
category-specific weights (funny vs controversial vs reaction vs …). The
resulting scores + verdicts drive memory-aware, variety-preserving selection
so re-submits discover NEW kinds of moments instead of five near-identical
clips.

JSON recovery: frames are described positionally; the model occasionally
emits prose or truncated JSON. We recover with a regex extract → repair →
corrective retry → graceful fallback, never crashing the job.
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
import memory
import vl as vl_core


PASS_A_PROMPT = (
    "You are a short-form livestream/Twitch/YouTube editor scouting candidate "
    "moments from a stream. You will see {n} frames sampled around one moment "
    "with timestamps, plus the transcript of that moment.\n\n"
    "Understand what actually happens (words + visuals + reactions matter). "
    "Decide whether this moment could work as a standalone short for a viewer "
    "who never saw the stream.\n\n"
    "Return ONLY minified JSON: "
    '{"verdict": "reject"|"possible"|"strong", '
    '"category": "funny"|"shocking"|"controversial"|"unexpected"|"rage"|'
    '"awkward"|"impressive"|"wholesome"|"argument"|"reaction"|"other", '
    '"summary": "<one sentence>", "confidence": <0.0-1.0>}\n'
    "Be highly critical. A technically coherent conversation where nothing "
    "entertaining happens is \"reject\"."
)

PASS_B_PROMPT = (
    "You are an expert editor specializing in viral livestream, Twitch, "
    "YouTube and Kick clips. You are reviewing a candidate moment.\n\n"
    "Determine whether this moment would work as a standalone short-form "
    "video for a viewer who has never seen the original stream.\n\n"
    "Understand what actually happens: the conversation, the visual events, "
    "facial expressions, gameplay, the setup before, the reaction during, "
    "the outcome after. Frames are labeled with timestamps.\n\n"
    "Return ONLY valid minified JSON with EXACTLY these keys:\n"
    '{"summary": "<what happened>",\n'
    ' "primary_category": "funny"|"shocking"|"controversial"|"unexpected"|'
    '"rage"|"awkward"|"impressive"|"wholesome"|"argument"|"reaction"|"other",\n'
    ' "secondary_categories": ["..."],\n'
    ' "scores": {"entertainment": 0-100, "humor": 0-100, "shock": 0-100, '
    '"controversy": 0-100, "reaction": 0-100, "unexpectedness": 0-100, '
    '"context_clarity": 0-100, "shareability": 0-100, "scroll_stop": 0-100, '
    '"boringness": 0-100},\n'
    ' "why_it_works": ["..."],\n'
    ' "why_it_might_fail": ["..."],\n'
    ' "best_clip": {"start": <seconds>, "end": <seconds>},\n'
    ' "alternative_clip_boundaries": [{"start": ..., "end": ..., "reason": "..."}],\n'
    ' "standalone_quality": "low"|"medium"|"high",\n'
    ' "final_verdict": "strong_clip"|"possible"|"reject"}\n'
    "Rules: boringness is the anti-score — a coherent but uninteresting "
    "conversation must score boringness high and final_verdict reject. "
    "best_clip.start/end are real seconds within the transcript range shown. "
    "Prefer boundaries that include enough setup AND the reaction."
)


DIMENSIONS = [
    "entertainment", "humor", "shock", "controversy", "reaction",
    "unexpectedness", "context_clarity", "shareability", "scroll_stop",
    "boringness",
]

# Category-specific weights (spec Part 11). Keys not listed fall back to a
# balanced "funny-ish" profile.
CATEGORY_WEIGHTS: dict[str, dict[str, float]] = {
    "funny": {
        "humor": 0.30, "entertainment": 0.20, "reaction": 0.15,
        "unexpectedness": 0.15, "context_clarity": 0.10, "shareability": 0.10,
    },
    "controversial": {
        "controversy": 0.30, "entertainment": 0.20, "reaction": 0.15,
        "unexpectedness": 0.10, "context_clarity": 0.10, "shareability": 0.10,
        "scroll_stop": 0.05,
    },
    "reaction": {
        "reaction": 0.30, "unexpectedness": 0.25, "entertainment": 0.20,
        "context_clarity": 0.15, "shareability": 0.10,
    },
    "shocking": {
        "shock": 0.30, "unexpectedness": 0.25, "entertainment": 0.15,
        "reaction": 0.10, "context_clarity": 0.10, "shareability": 0.10,
    },
    "unexpected": {
        "unexpectedness": 0.30, "entertainment": 0.20, "reaction": 0.15,
        "humor": 0.10, "context_clarity": 0.15, "shareability": 0.10,
    },
    "rage": {
        "entertainment": 0.25, "reaction": 0.25, "shock": 0.10,
        "controversy": 0.10, "context_clarity": 0.15, "shareability": 0.15,
    },
    "awkward": {
        "reaction": 0.25, "entertainment": 0.20, "humor": 0.10,
        "unexpectedness": 0.10, "context_clarity": 0.20, "shareability": 0.15,
    },
    "argument": {
        "entertainment": 0.15, "reaction": 0.20, "controversy": 0.25,
        "context_clarity": 0.15, "shareability": 0.20, "scroll_stop": 0.05,
    },
}

DEFAULT_WEIGHTS = {
    "entertainment": 0.25, "humor": 0.15, "reaction": 0.20,
    "unexpectedness": 0.15, "context_clarity": 0.15, "shareability": 0.10,
}

REJECT_BORINGNESS = 62.0     # boringness above this kills a candidate even if
                             # every other score is high (spec Part 12).
REJECT_CONTEXT = 30.0        # standalone clips need enough context clarity.
POSSIBLE_FLOOR = 45.0        # PASS B composite under this → not a clip.


# ── Dense multimodal sampling ───────────────────────────────────────────────


def sample_dense_frames(
    video: Path,
    start: float,
    end: float,
    work_dir: Path,
    out_name: str = "dense",
) -> list[tuple[float, Path]]:
    """Sample ~STREAMER_DENSE_FRAMES frames across [start, end] labeled with
    real seconds. Spread is biased toward the middle/reaction part of the
    window (frame density increases as we approach the event, per spec)."""
    dur = max(end - start, 2.0)
    n = max(3, config.STREAMER_DENSE_FRAMES)
    out_dir = work_dir / out_name
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*.jpg"):
        f.unlink(missing_ok=True)

    # Linear timestamps, then pull a majority from the second half (reaction
    # zone) by duplicating tail anchors — ffmpeg fps just samples uniformly,
    # so instead we explicitly pick timestamps and extract each as a frame.
    ts = sorted(set(
        round(min(max(start, start + dur * f), end - 0.2), 2)
        for f in [0.0, 0.18, 0.38, 0.55, 0.72, 0.85, 0.94, 1.0]
    ))[:n]

    frames: list[tuple[float, Path]] = []
    for i, t in enumerate(ts):
        frame_path = out_dir / f"f_{i:03d}.jpg"
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-ss", str(round(t, 2)), "-i", str(video),
                    "-frames:v", "1",
                    "-vf", f"scale={config.STREAMER_DENSE_WIDTH}:-2",
                    str(frame_path),
                ],
                capture_output=True, timeout=120, check=True,
            )
        except Exception:
            continue
        if frame_path.exists() and frame_path.stat().st_size > 1000:
            frames.append((round(t, 2), frame_path))
    return frames


def _transcript_slice(
    segments: list[dict[str, Any]], start: float, end: float
) -> str:
    """Transcript with timestamps for [start, end] so Qwen can map beats."""
    lines = []
    for seg in segments:
        s = float(seg.get("start", 0))
        e = float(seg.get("end", 0))
        if e > start and s < end:
            lines.append(f"[{s:.1f}s] {seg.get('text', '')}")
    return "\n".join(lines)


def _build_content(
    frames: list[tuple[float, Path]],
    transcript: str,
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    for ts, path in frames:
        b64 = base64.b64encode(path.read_bytes()).decode()
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            }
        )
    content.append({"type": "text", "text": transcript})
    return content


def _ask_vlm(
    system: str,
    content: list[dict[str, Any]],
    max_tokens: int = 500,
    temperature: float | None = None,
    timeout: int = 420,
) -> str | None:
    """POST to the local llama-server; returns raw assistant text or None."""
    if not vl_core.available():
        return None
    payload: dict[str, Any] = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature if temperature is not None else config.STREAMER_TEMPERATURE,
    }
    try:
        resp = requests.post(
            f"{config.LLAMA_SERVER_URL}/v1/chat/completions",
            json=payload,
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return None


# ── JSON recovery ───────────────────────────────────────────────────────────


def _extract_json(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _repair_json(raw: str) -> dict[str, Any] | None:
    """Best-effort repair: unquote bare keys, strip trailing commas, split
    stray prose glued to the JSON."""
    if not raw:
        return None
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    s = match.group(0) if match else raw
    s = re.sub(r"([,{])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', s)
    s = re.sub(r",\s*([}\]])", r"\1", s)
    try:
        data = json.loads(s)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _retry_with_correction(
    system: str, content: list[dict[str, Any]], last_raw: str
) -> str | None:
    """One corrective retry telling the model its output was invalid JSON."""
    corr = content + [
        {
            "type": "text",
            "text": (
                "Your previous answer was not valid JSON. Return ONLY the "
                f"strict JSON now, no prose. Previous answer was:\n{last_raw[:1200]}"
            ),
        }
    ]
    return _ask_vlm(system, corr, max_tokens=500)


# ── PASS A ──────────────────────────────────────────────────────────────────


def pass_a(
    candidate: dict[str, Any],
    video: Path,
    work_dir: Path,
    segments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Analyze one candidate; return {verdict, category, summary, confidence},
    or None when the VLM is unavailable or cannot be recovered."""
    frames = sample_dense_frames(
        video, candidate["start"], candidate["end"],
        work_dir, out_name=f"a_{int(candidate['start'])}",
    )
    if not frames:
        return {"verdict": "possible", "category": "other",
                "summary": "no frames extracted", "confidence": 0.3}
    tx = _transcript_slice(segments, candidate["start"], candidate["end"])
    if not tx.strip():
        tx = "(no transcript in this window)"

    system = PASS_A_PROMPT.format(n=len(frames))
    content = _build_content(frames, tx)
    raw = _ask_vlm(system, content, max_tokens=300)
    data = _extract_json(raw) or _repair_json(raw) if raw else None
    if data is None and raw:
        raw2 = _retry_with_correction(system, content, raw)
        data = _extract_json(raw2) or _repair_json(raw2) if raw2 else None
    if data is None:
        return {"verdict": "possible", "category": "other",
                "summary": "vlm unparseable", "confidence": 0.3}

    verdict = str(data.get("verdict", "possible")).lower()
    if verdict not in ("reject", "possible", "strong"):
        verdict = "possible"
    return {
        "verdict": verdict,
        "category": str(data.get("category", "other"))[:40],
        "summary": str(data.get("summary", ""))[:300],
        "confidence": round(min(1.0, max(0.0, float(data.get("confidence", 0.5)))), 3),
    }


# ── PASS B ──────────────────────────────────────────────────────────────────


def pass_b(
    candidate: dict[str, Any],
    video: Path,
    work_dir: Path,
    segments: list[dict[str, Any]],
    total_duration: float,
) -> dict[str, Any] | None:
    """Deep analysis + boundaries for one strong candidate.

    Returns a full analysis dict (part of the clip's permanent record) or
    None on unrecoverable VLM failure.
    """
    start = max(0.0, candidate["start"] - config.STREAMER_ANALYZE_PRE)
    end = min(total_duration, candidate["end"] + config.STREAMER_ANALYZE_POST)
    frames = sample_dense_frames(video, start, end, work_dir, out_name=f"b_{int(candidate['start'])}")
    tx = _transcript_slice(segments, start, end)
    if not tx.strip():
        tx = "(no transcript in this window)"

    content = _build_content(frames, tx) if frames else []
    if not content:
        text_block = {
            "type": "text",
            "text": "No frames could be extracted. Base your analysis on the transcript only.\n" + tx,
        }
        content = [text_block]

    system = PASS_B_PROMPT
    raw = _ask_vlm(system, content, max_tokens=900)
    data = _extract_json(raw) or (_repair_json(raw) if raw else None)
    if data is None and raw:
        raw2 = _retry_with_correction(system, content, raw)
        data = _extract_json(raw2) or (_repair_json(raw2) if raw2 else None)
    if data is None:
        return None

    scores: dict[str, float] = {}
    raw_scores = data.get("scores") or {}
    for dim in DIMENSIONS:
        try:
            scores[dim] = round(min(100.0, max(0.0, float(raw_scores.get(dim, 0)))), 1)
        except Exception:
            scores[dim] = 0.0

    best = data.get("best_clip") or {}
    try:
        b_start = float(best.get("start", candidate["start"]))
        b_end = float(best.get("end", candidate["end"]))
    except Exception:
        b_start, b_end = candidate["start"], candidate["end"]

    alternatives: list[dict[str, Any]] = []
    for alt in (data.get("alternative_clip_boundaries") or [])[:4]:
        try:
            a_start = float(alt.get("start", b_start))
            a_end = float(alt.get("end", b_end))
        except Exception:
            continue
        alternatives.append(
            {
                "start": round(min(max(a_start, 0.0), total_duration), 2),
                "end": round(min(max(a_end, a_start + config.STREAMER_MIN_CLIP), total_duration), 2),
                "reason": str(alt.get("reason", ""))[:200],
            }
        )

    return {
        "summary": str(data.get("summary", ""))[:400],
        "primary_category": str(data.get("primary_category", "other"))[:40],
        "secondary_categories": [
            str(c)[:40] for c in (data.get("secondary_categories") or [])[:4]
        ],
        "scores": scores,
        "why_it_works": [str(x)[:200] for x in (data.get("why_it_works") or [])[:4]],
        "why_it_might_fail": [str(x)[:200] for x in (data.get("why_it_might_fail") or [])[:4]],
        "best_clip": {
            "start": round(min(max(b_start, 0.0), total_duration), 2),
            "end": round(min(max(b_end, b_start + config.STREAMER_MIN_CLIP), total_duration), 2),
        },
        "alternative_clip_boundaries": alternatives,
        "standalone_quality": str(data.get("standalone_quality", "low"))[:20],
        "final_verdict": str(data.get("final_verdict", "reject"))[:30],
    }


# ── Multi-dimensional scoring ───────────────────────────────────────────────


def composite_score(analysis: dict[str, Any]) -> tuple[float, dict[str, float]]:
    """Category-weighted blend of the 10 dimensions → 0..100 + per-dim map.

    boringness is a veto handled by the caller, not blended in as a positive.
    """
    scores = analysis.get("scores") or {}
    cat = analysis.get("primary_category", "other")
    weights = CATEGORY_WEIGHTS.get(cat, DEFAULT_WEIGHTS)
    total = 0.0
    weight_sum = sum(weights.values()) or 1.0
    parts: dict[str, float] = {}
    for dim, w in weights.items():
        val = float(scores.get(dim, 0))
        total += val * w
        parts[dim] = round(val, 1)
    if not weights:
        return 0.0, parts
    return round(total / weight_sum, 1), parts


def verify_verdict(analysis: dict[str, Any], composite: float) -> str:
    """Collapse model verdict + composite + boringness into a final decision."""
    scores = analysis.get("scores") or {}
    boring = float(scores.get("boringness", 0))
    context = float(scores.get("context_clarity", 0))
    verdict = str(analysis.get("final_verdict", "reject")).lower()

    if boring >= REJECT_BORINGNESS:
        return "reject"
    if context < REJECT_CONTEXT:
        return "reject"
    if composite < POSSIBLE_FLOOR:
        return "reject"
    if "strong" in verdict and composite >= 70:
        return "strong"
    if composite >= POSSIBLE_FLOOR:
        return "possible"
    return "reject"


# ── Final selection ─────────────────────────────────────────────────────────


def _overlap_ratio(a: dict[str, Any], b: dict[str, Any]) -> float:
    ov = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    return ov / max(a["end"] - a["start"], 0.001)


def final_boundary(
    analysis: dict[str, Any],
    candidate: dict[str, Any],
    total_duration: float,
) -> dict[str, Any]:
    """Qwen's proposed boundaries, clamped + validated."""
    best = (analysis or {}).get("best_clip") or {}
    start = float(best.get("start", candidate["start"]))
    end = float(best.get("end", candidate["end"]))
    start = round(min(max(start, 0.0), total_duration), 2)
    dur = min(max(end - start, config.STREAMER_MIN_CLIP), config.STREAMER_MAX_CLIP)
    end = round(min(start + dur, total_duration), 2)
    return {"start": start, "end": end}


def select_finals(
    analyzed: list[dict[str, Any]],
    clip_count: int,
    total_duration: float,
    memory_used: set[str] | None = None,
) -> list[dict[str, Any]]:
    """From PASS-B analyzed candidates, pick `clip_count` clips using quality,
    variety, non-overlap and clip memory.

    The primary category differs per pick so re-submits discover NEW kinds of
    moments (spec Part 14/16). Returns picks with start/end/text/scoring set.
    """
    memory_used = memory_used or set()

    # Score + verdict each analyzed candidate.
    ranked: list[dict[str, Any]] = []
    for cand in analyzed:
        analysis = cand.get("analysis")
        if not analysis:
            continue
        composite, parts = composite_score(analysis)
        verdict = verify_verdict(analysis, composite)
        cand["_composite"] = composite
        cand["_parts"] = parts
        cand["_verdict"] = verdict
        if verdict == "reject":
            continue
        cand["_score"] = composite * (1.0 if verdict == "strong" else 0.92)
        ranked.append(cand)

    ranked.sort(key=lambda c: c["_score"], reverse=True)

    picks: list[dict[str, Any]] = []
    used_categories: set[str] = set()
    for cand in ranked:
        if len(picks) >= clip_count:
            break
        start, end = final_boundary(
            cand.get("analysis"), cand, total_duration
        ).values()
        cand["start"], cand["end"] = float(start), float(end)
        key = memory.window_key(float(cand["start"]), float(cand["end"]))
        if key in memory_used:
            continue
        if any(_overlap_ratio(cand, p) > 0.50 for p in picks):
            continue
        cat = cand["analysis"].get("primary_category", "other")
        # Variety: cap same-category picks unless the stream only has one kind.
        cap = max(1, (clip_count + 1) // 2)
        if cat in used_categories and sum(
            1 for p in picks if p["analysis"].get("primary_category") == cat
        ) >= cap and len(ranked) > clip_count:
            continue
        used_categories.add(cat)
        picks.append(cand)

    return picks[:clip_count]


# ── Public entry ────────────────────────────────────────────────────────────


def analyze_candidates(
    candidates: list[dict[str, Any]],
    video: Path,
    work_dir: Path,
    segments: list[dict[str, Any]],
    total_duration: float,
) -> list[dict[str, Any]]:
    """Run the two-pass funnel. Returns candidates that survive PASS B with
    .analysis attached (verdict != reject and composite >= POSSIBLE_FLOOR).

    If the VLM is unreachable, returns [] so main.py falls back to heuristic
    discovery picks — the streamer path never hard-fails without it.
    """
    if not vl_core.available():
        return []

    # PASS A — understand every candidate once.
    pass_a_limit = config.STREAMER_PASS_A_LIMIT
    strong: list[dict[str, Any]] = []
    possible: list[dict[str, Any]] = []
    for cand in candidates[:pass_a_limit]:
        verdict_info = pass_a(cand, video, work_dir, segments)
        if not verdict_info:
            continue
        cand["pass_a"] = verdict_info
        if verdict_info["verdict"] == "strong":
            strong.append(cand)
        elif verdict_info["verdict"] == "possible":
            possible.append(cand)

    # PASS B — only the strongest, then soak remaining budget with possible.
    pass_b_list = (
        strong
        + possible[: max(0, config.STREAMER_PASS_B_LIMIT - len(strong))]
    )[: config.STREAMER_PASS_B_LIMIT]

    analyzed: list[dict[str, Any]] = []
    for cand in pass_b_list:
        analysis = pass_b(cand, video, work_dir, segments, total_duration)
        if not analysis:
            continue
        cand["analysis"] = analysis
        analyzed.append(cand)

    return analyzed