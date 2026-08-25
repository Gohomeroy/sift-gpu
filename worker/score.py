"""Stage 4: cheap scoring of every candidate window.

Blend (weights sum to 1.0 before semantic component):
  hook quality 25% · power words 20% · emotional energy 12% · questions 10%
  length fit 10% · emphasis 8% · punchiness 8% · pacing 7%
Plus an optional semantic component: cosine similarity between the window
embedding and centroids built from real viral transcripts (when a dataset
CSV is configured). Semantic score can swing up to ±15 points on the 0-100
scale, which fixes the tight-spread ranking problem keyword scoring has.
"""

from __future__ import annotations

import csv
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

import config

HOOK_PATTERNS = [
    "you won't believe", "wait for it", "here's the thing", "the craziest",
    "i never", "nobody tells you", "biggest mistake", "story time",
    "listen", "imagine", "what if i told you", "this is why",
    "let me tell you", "the moment i", "i got caught", "he said",
    "she said", "and then", "plot twist", "turns out",
]
POWER_WORDS = [
    "insane", "crazy", "wild", "unbelievable", "shocking", "secret",
    "banned", "illegal", "exposed", "million", "billion", "free",
    "instantly", "never", "always", "worst", "best", "huge", "massive",
    "destroyed", "viral", "caught", "exposed", "truth", "lied", "scam",
]
EMOTION_WORDS = [
    "love", "hate", "angry", "crying", "screamed", "freaked", "panicked",
    "excited", "terrified", "shocked", "embarrassed", "proud", "furious",
    "hilarious", "funny", "laughing", "emotional", "heartbroken",
]

# ---------------------------------------------------------------------------
# Semantic centroids from real viral transcripts (optional)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _embedder():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer("all-MiniLM-L6-v2")


@lru_cache(maxsize=1)
def _centroids() -> np.ndarray | None:
    """Mean embeddings of high-engagement transcripts from the CSV, if present."""
    csv_path = config.VIRAL_CSV_PATH
    if not csv_path or not Path(csv_path).exists():
        return None

    texts: list[str] = []
    with open(csv_path, newline="", encoding="utf-8", errors="ignore") as fh:
        reader = csv.DictReader(fh)
        cols = [c.lower() for c in (reader.fieldnames or [])]
        tcol = next(
            (reader.fieldnames[i] for i, c in enumerate(cols) if c in ("transcript", "text", "description")),
            None,
        )
        vcol = next(
            (reader.fieldnames[i] for i, c in enumerate(cols) if c in ("views", "play_count", "n_views")),
            None,
        )
        if not tcol or not vcol:
            return None
        rows = list(reader)

    if not rows:
        return None
    views = np.array([_to_int(r.get(vcol)) for r in rows], dtype=float)
    threshold = float(np.nanpercentile(views, 92))
    top = [r.get(tcol, "") or "" for r, v in zip(rows, views) if v >= threshold and len(r.get(tcol) or "") > 120]
    if len(top) < 20:
        return None

    model = _embedder()
    embs = model.encode(top[:4000], batch_size=64, show_progress_bar=False)
    centroid = np.mean(embs, axis=0)
    centroid /= (np.linalg.norm(centroid) + 1e-9)
    return centroid.reshape(1, -1)


def _to_int(value: Any) -> float:
    try:
        return float(str(value).replace(",", ""))
    except Exception:
        return float("nan")


def _semantic_score(text: str) -> float | None:
    """0..1 similarity to the viral centroid, or None when unavailable."""
    cent = _centroids()
    if cent is None:
        return None
    emb = _embedder().encode([text[:2000]], show_progress_bar=False)[0]
    emb = emb / (np.linalg.norm(emb) + 1e-9)
    sim = float(np.dot(emb, cent[0]))
    # Map cosine [-0.2..0.8] → [0..1] empirically.
    return max(0.0, min(1.0, (sim + 0.2) / 1.0))


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------

def heuristic_score(window: dict[str, Any]) -> tuple[float, dict[str, float]]:
    text = window["text"]
    lower = text.lower()
    words = lower.split()
    n_words = max(len(words), 1)

    hook_hits = sum(1 for p in HOOK_PATTERNS if p in lower)
    hook = min(hook_hits / 2 + (1 if window.get("opens_after_pause") else 0), 2) / 2

    power = min(sum(1 for w in POWER_WORDS if w in lower) / 4, 1.5) / 1.5
    emotion = min(sum(1 for w in EMOTION_WORDS if w in lower) / 3, 1) 

    questions = min(lower.count("?") / 2, 1)
    exclamations = min(lower.count("!") / 3, 1)
    emphasis = (questions + exclamations) / 2

    duration = window["end"] - window["start"]
    length_fit = 1 - abs(duration - 38) / 38 if duration < 76 else 0
    length_fit = max(0.0, min(1.0, length_fit))

    avg_word_len = sum(len(w) for w in words) / n_words
    punchy = max(0.0, min(1.0, (7 - avg_word_len) / 4))
    short_sentences = min(window.get("sentence_count", 5) / 8, 1)

    pacing = min(n_words / max(duration, 1) / 2.6, 1)  # ~2.6 wps ≈ energetic speech

    parts = {
        "hook": hook * 0.25,
        "power": power * 0.20,
        "emotion": emotion * 0.12,
        "questions": questions * 0.10,
        "length_fit": length_fit * 0.10,
        "emphasis": emphasis * 0.08,
        "punchy": punchy * 0.08,
        "pacing": pacing * 0.07,
        "short_sentences": short_sentences * 0.00,  # reported, unweighted v1
    }
    base = sum(parts.values())
    return base, parts


def score_windows(windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scored: list[dict[str, Any]] = []
    sem_available = config.VIRAL_CSV_PATH and Path(config.VIRAL_CSV_PATH).exists()

    for w in windows:
        base, parts = heuristic_score(w)
        score01 = base
        if sem_available:
            sem = _semantic_score(w["text"])
            if sem is not None:
                parts["semantic"] = round(sem, 3)
                # Semantic can add/subtract up to 15 points of the final 100.
                score01 = base * 0.85 + sem * 0.30

        scored.append(
            {
                **w,
                "base_score": round(base, 3),
                "score01": round(min(score01, 1.0), 3),
                "parts": json.loads(json.dumps(parts)),
            }
        )

    scored.sort(key=lambda x: x["score01"], reverse=True)
    return scored


def to_percent(score01: float) -> int:
    """Map the blended 0..1 score onto a presentable 55..98 viral_score band."""
    eased = 1 - math.exp(-2.2 * score01) * math.exp(0)
    return int(round(55 + 43 * min(eased, 1.0)))
