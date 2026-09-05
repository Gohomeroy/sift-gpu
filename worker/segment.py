"""Stage 3: build arc-shaped candidate clip windows.

A clip is not a fixed 20-60s chunk anymore. Each window is a complete
mini-story with three beats:

    1. HOOK      — the clip opens ON a hook line (spoken within the first
                   1-3s, always; the window start == the hook sentence start)
    2. QUESTION  — an open-ended question inside the arc keeps the viewer
                   wondering (the hook itself may be the question)
    3. PAYOFF    — the answer / punchline / reveal; the clip ends right
                   after it lands, so duration follows the story, not a preset

Windows that can't satisfy the full arc are discarded rather than being cut
short artificially.
"""

from __future__ import annotations

from typing import Any

MIN_WINDOW = 8.0
MAX_WINDOW = 90.0
TRAIL_PAD = 0.35            # small tail after the payoff so it reads naturally
GAP_BONUS_SECONDS = 0.6     # pause before a sentence makes it feel like an opener
HOOK_THRESHOLD = 1.0
PAYOFF_THRESHOLD = 1.0
MAX_ANCHORS = 40            # upper bound on candidate windows before scoring

# Phrases that read as "this is where the story starts".
# NOTE: keep phrases that can't appear inside payoff/answer lines ("that's why
# I...", "know why I..."), otherwise payoff lines get mislabeled as hooks.
HOOK_PATTERNS = [
    "you won't believe", "wait for it", "here's the thing", "the craziest",
    "this is why", "let me tell you", "story time", "nobody tells you",
    "imagine this", "what if i", "i never thought", "the moment i",
    "i got caught", "plot twist", "listen to this",
    "stop what you're doing", "before you", "the day i",
    "then one day", "so there i was", "you need to hear",
    "i'm about to", "biggest mistake", "million dollar",
]

# A question can be a "?" or start with a question word ("did you ever…").
Q_STARTS = {
    "what", "why", "how", "where", "when", "who", "can", "could",
    "would", "will", "should", "do", "does", "did", "is", "are",
    "was", "were", "have", "has", "had", "what's", "why'd", "how'd",
    "are you", "did you", "do you", "have you", "is this", "is it",
}

# Phrases that typically open the resolution / answer / punchline.
PAYOFF_OPENERS = [
    "that's why", "that's how", "turns out", "that's when", "which is why",
    "so now", "long story short", "bottom line", "in the end", "the answer",
    "and that's", "and then", "eventually", "finally", "in fact",
    "so there", "and guess what", "needless to say", "before i knew it",
    "next thing i knew", "to make a long story short", "that's exactly",
]

# Words that signal an emotional / informational reveal.
PAYOFF_WORDS = [
    "revealed", "admitted", "announced", "confirmed", "discovered",
    "found out", "blew up", "shocked", "shock", "viral", "million",
    "billion", "banned", "fired", "crashed", "jail", "secret", "the truth",
    "dead", "quit", "exploded", "clapped back", "walked away", "the deal",
    "insane", "unbelievable", "took off", "blew my mind", "blew his mind",
    "turned out", "it worked", "it happened", "right then", "that moment",
]


def _is_question(text: str) -> bool:
    t = text.strip().lower()
    if not t:
        return False
    if "?" in t:
        return True
    words = t.split()
    if not words:
        return False
    first = words[0]
    two = " ".join(words[:2])
    return two in Q_STARTS or first in Q_STARTS


def _hook_score(seg: dict[str, Any], prev_gap: float) -> float:
    """How strongly this segment reads as a clip-opening hook."""
    text = str(seg.get("text", "")).strip()
    lower = text.lower()
    if not lower:
        return 0.0

    s = 0.0
    head = lower[:48]
    if any(p in head for p in HOOK_PATTERNS):
        s += 1.1  # explicit opener cue
    if lower.endswith("?"):
        s += 0.9  # a question as the hook is the strongest form
    if prev_gap >= GAP_BONUS_SECONDS:
        s += 0.8  # speaker starts a new thread after a pause
    n_words = len(lower.split())
    if n_words <= 14:
        s += 0.3  # punchy short opener
    return s


def _payoff_score(seg: dict[str, Any], prev_was_question: bool) -> float:
    """How strongly this segment lands like the resolution / payoff."""
    text = str(seg.get("text", "")).strip()
    lower = text.lower()
    if not lower:
        return 0.0
    if _is_question(text):
        return 0.0  # a question is not the payoff

    s = 0.0
    head = lower[:60]
    if any(p in head for p in PAYOFF_OPENERS):
        s += 1.0
    hits = sum(1 for w in PAYOFF_WORDS if w in lower)
    s += min(hits / 2, 1) * 0.8
    n_words = len(lower.split())
    if 3 <= n_words <= 11:
        s += 0.5  # short declarative punch ("She was my sister.")
    if "!" in text:
        s += 0.5
    if prev_was_question:
        s += 0.6  # answering the just-asked question is a natural payoff
    return s


def _build_arc(
    transcript_segments: list[dict[str, Any]],
    hook_idx: int,
) -> dict[str, Any] | None:
    """Build a single hook → question → payoff window anchored at hook_idx."""
    hook = transcript_segments[hook_idx]
    start = float(hook.get("start", 0))
    end: float | None = None
    payoff_text = ""

    saw_question = _is_question(str(hook.get("text", "")))
    prev_was_question = saw_question

    j = hook_idx + 1
    while j < len(transcript_segments):
        seg = transcript_segments[j]
        seg_end = float(seg.get("end", start))
        if seg_end - start > MAX_WINDOW:
            break
        seg_text = str(seg.get("text", ""))
        is_q = _is_question(seg_text)
        if not saw_question and is_q:
            saw_question = True
        if _payoff_score(seg, prev_was_question) >= PAYOFF_THRESHOLD:
            end = seg_end
            payoff_text = seg_text
            break
        prev_was_question = is_q
        j += 1

    # Ran out of transcript: the last line is the de-facto payoff.
    if end is None and j >= len(transcript_segments):
        end = float(transcript_segments[-1]["end"])
        payoff_text = str(transcript_segments[-1].get("text", ""))

    if end is None:
        return None  # no payoff found within the cap
    if not saw_question:
        return None  # incomplete arc — no open-ended question to hold tension
    duration = end - start
    if duration < MIN_WINDOW or duration > MAX_WINDOW:
        return None

    prev_gap = 999.0
    if hook_idx > 0:
        prev_gap = start - float(transcript_segments[hook_idx - 1].get("end", start))

    chosen = transcript_segments[hook_idx: j]
    w_end = round(min(end + TRAIL_PAD, start + MAX_WINDOW), 2)
    return {
        "start": round(start, 2),
        "end": w_end,
        "text": " ".join(str(s.get("text", "")) for s in chosen).strip(),
        "opens_after_pause": prev_gap >= GAP_BONUS_SECONDS,
        "sentence_count": max(len(chosen), 1),
        "hook_score": round(_hook_score(hook, prev_gap), 2),
        "hook_text": str(hook.get("text", "")).strip(),
        "payoff_text": payoff_text.strip(),
        "has_question": True,
    }


def _fallback_windows(
    transcript_segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Safety net: sentence-group windows with the opener at the very start.

    Only used when the arc builder finds no complete hook→question→payoff
    arcs (e.g. a transcript with no questions at all), so the pipeline never
    starves. These still open on the first sentence of the group.
    """
    windows: list[dict[str, Any]] = []
    start_idx = 0
    while start_idx < len(transcript_segments):
        first = transcript_segments[start_idx]
        end_idx = start_idx
        while end_idx < len(transcript_segments):
            span_end = transcript_segments[end_idx]["end"]
            if span_end - first["start"] > MAX_WINDOW:
                break
            end_idx += 1
            span = transcript_segments[end_idx - 1]["end"] - first["start"] if end_idx > start_idx else 0
            if span >= MIN_WINDOW:
                break
        end_idx = max(end_idx, start_idx + 1)
        chosen = transcript_segments[start_idx:end_idx]
        w_start = float(chosen[0]["start"])
        w_end = float(chosen[-1]["end"])
        prev_gap = 999.0
        if start_idx > 0:
            prev_gap = w_start - float(transcript_segments[start_idx - 1]["end"])
        windows.append(
            {
                "start": round(w_start, 2),
                "end": round(min(w_end + TRAIL_PAD, w_start + MAX_WINDOW), 2),
                "text": " ".join(str(seg["text"]) for seg in chosen).strip(),
                "opens_after_pause": prev_gap >= GAP_BONUS_SECONDS,
                "sentence_count": len(chosen),
                "hook_text": str(chosen[0].get("text", "")).strip(),
                "payoff_text": "",
                "has_question": False,
            }
        )
        start_idx += max(1, int(len(chosen) * 0.8))
    return windows


def build_windows(
    transcript_segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build arc windows: every candidate opens on a hook, holds tension with a
    question, and ends right after the payoff."""
    if not transcript_segments:
        return []

    # Score every segment as a potential hook.
    anchors: list[tuple[int, float]] = []
    for i, seg in enumerate(transcript_segments):
        prev_gap = 999.0
        if i > 0:
            prev_gap = float(seg.get("start", 0)) - float(transcript_segments[i - 1].get("end", 0))
        s = _hook_score(seg, prev_gap)
        if s >= HOOK_THRESHOLD or i == 0:
            anchors.append((i, s))

    if not anchors:
        return _fallback_windows(transcript_segments)

    # Strongest hooks first.
    anchors.sort(key=lambda x: x[1], reverse=True)

    windows: list[dict[str, Any]] = []
    built: list[tuple[float, float]] = []

    for idx, _score in anchors:
        if len(windows) >= MAX_ANCHORS:
            break
        start_cand = float(transcript_segments[idx]["start"])
        # Skip anchors swallowed by a stronger window already built.
        if any(start_cand >= s and start_cand <= e for s, e in built):
            continue
        arc = _build_arc(transcript_segments, idx)
        if arc is None:
            continue
        # Don't emit two windows that start in the same stretch.
        if any(abs(arc["start"] - s) < 2.0 for s, _e in built):
            continue
        built.append((arc["start"], arc["end"]))
        windows.append(arc)

    if not windows:
        return _fallback_windows(transcript_segments)

    # Keep the strongest arcs well-spread across the video.
    windows.sort(key=lambda w: -w.get("hook_score", 0))
    out: list[dict[str, Any]] = []
    occupied: list[tuple[float, float]] = []
    for w in windows:
        if len(out) >= MAX_ANCHORS:
            break
        if any(
            w["start"] < o_end and w["end"] > o_start for o_start, o_end in occupied
        ):
            continue
        occupied.append((w["start"], w["end"]))
        out.append(w)

    out.sort(key=lambda w: w["start"])
    return out


def snap_start_to_hook(
    window: dict[str, Any],
    transcript_segments: list[dict[str, Any]],
    lookahead: float = 3.0,
) -> float | None:
    """Re-anchor a candidate so it opens on a hook sentence within the first
    1-3 seconds. Returns the new start time, or None if nothing usable (caller
    keeps the original start in that case).

    Used as a safety net for windows that didn't come from the arc builder
    (VL discoveries, scene-boundary windows) so the hook rule holds there too.
    """
    start = float(window.get("start", 0))
    if not transcript_segments:
        return None

    # First segment that overlaps the window start.
    cover_idx: int | None = None
    for i, seg in enumerate(transcript_segments):
        if float(seg.get("end", 0)) > start:
            cover_idx = i
            break
    if cover_idx is None:
        return None

    # Prefer a hook sentence that begins within [start, start+lookahead].
    for i in range(cover_idx, min(cover_idx + 6, len(transcript_segments))):
        seg = transcript_segments[i]
        seg_start = float(seg.get("start", 0))
        if seg_start > start + lookahead:
            break
        if seg_start < start:
            continue
        prev_gap = 999.0
        if i > 0:
            prev_gap = seg_start - float(transcript_segments[i - 1].get("end", 0))
        if _hook_score(seg, prev_gap) >= HOOK_THRESHOLD:
            return round(seg_start, 2)

    # Fall back to the covering segment itself so we never open mid-thought.
    return round(float(transcript_segments[cover_idx].get("start", start)), 2)