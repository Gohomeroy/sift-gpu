"""Stage 6 (streamer): cheap event detection — candidate recall for moments.

For streamer/livestream content the hook → question → payoff arc builder is
the WRONG primary discovery method: the funniest moments are jokes, roasts,
reactions, arguments, shocks and visual gags that carry no traditional
speech structure. This module replaces arc-building with high-recall event
detection.

It finds *potentially* interesting events from three cheap signals:

  audio      loudness spikes, shouting, sudden silence, laughter texture,
             excited energy — from a downsampled RMS series
  transcript keyword/pattern hits for jokes, roasts, arguments, strong
             opinions, surprise, emotional language, punchline cues
  visual     motion spikes (keyframe diffs) + scene/camera changes

Every hit becomes a normalized event object; nearby/semantically-connected
events merge into a sequence; each sequence expands into several context
window variants (different amounts of setup + aftermath) for Qwen3-VL-8B to
judge. This stage is deliberately recall-maximizing: a few extra mediocre
candidates are better than missing the funniest moment of the stream.
"""

from __future__ import annotations

import math
import wave
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

import config


# ── Transcript cue sets ────────────────────────────────────────────────────
# Purpose is cheap recall only — Qwen3-VL decides actual meaning. Keep the
# phrases short enough to match spoken text (transcript has no punctuation).
TRANSCRIPT_CUES: dict[str, list[str]] = {
    "laughter": [
        "laughing", "laughs", "hahaha", "lmao", "lol", "can't breathe",
        "i'm dead", "i am dead", "crying", "rolling", "rofl",
    ],
    "shock": [
        "no way", "what the fuck", "what the hell", "are you serious",
        "holy shit", "oh my god", "oh shit", "are you kidding", "wait what",
        "hold on", "no fucking way", "what the", "huh", "what?!", "bro what",
    ],
    "roast": [
        "you're literally", "you are literally", "you're a clown",
        "you are a clown", "go to bed", "stfu", "shut up", "garbage",
        "trash", "are you dumb", "that's foul", "you are the worst",
        "you're actually", "you are actually", "certified", "caught in 4k",
    ],
    "argument": [
        "you're wrong", "you are wrong", "no you didn't", "i told you",
        "we're done", "that's not true", "you lied", "prove it",
        "you can't say that", "don't touch", "get out", "i said no",
        "you're not listening",
    ],
    "strong_opinion": [
        "i hate", "i love", "the best", "the worst", "nobody",
        "everyone knows", "that's illegal", "i would never", "facts only",
        "this is crazy", "unbelievable", "i genuinely", "in my opinion",
        "no cap",
    ],
    "surprise": [
        "i quit", "i'm leaving", "i am leaving", "i actually",
        "never thought", "first time", "i can't believe", "no chance",
        "i just", "that actually", "it just happened", "they actually",
        "one more", "final round", "it's over", "that's it",
    ],
    "emotional": [
        "i'm so", "i am so", "i'm about to", "i am about to", "screaming",
        "panicking", "nervous", "scared", "so mad", "so angry", "so happy",
        "so scared", "so hyped", "hyped", "excited", "can't believe this",
    ],
    "setup_cue": [
        "watch this", "watch me", "check this out", "wait for it",
        "in 3, 2, 1", "right now", "listen", "watch", "look at this",
        "this is the moment", "here we go",
    ],
}

# Words with strong emotional weight bump the transcript signal extra.
EMOTIONAL_WORDS = {
    "fuck", "shit", "bitch", "damn", "hell", "crazy", "insane", "wild",
    "absolutely", "never", "always", "actually", "literally", "genuinely",
}


def _text_for_window(
    segments: list[dict[str, Any]], start: float, end: float
) -> str:
    """Concatenate transcript segments overlapping [start, end]."""
    parts = [
        seg["text"]
        for seg in segments
        if float(seg.get("end", 0)) > start and float(seg.get("start", 0)) < end
    ]
    return " ".join(parts).strip()


# ── Audio events ───────────────────────────────────────────────────────────


def _audio_rms(wav: Path, bucket: float) -> tuple[np.ndarray, float]:
    """RMS series over the whole wav in `bucket`-second non-overlapping windows.

    Returns (rms_array, seconds_per_bucket). The wav is mono 16k from ingest.
    """
    with wave.open(str(wav), "rb") as wf:
        rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    b = int(rate * bucket)
    if b < 1 or len(samples) < b:
        return np.array([float(np.sqrt(np.mean(samples**2) + 1e-9))]), len(samples)
    n = len(samples) // b
    if n < 1:
        return np.array([float(np.sqrt(np.mean(samples**2) + 1e-9))]), len(samples)
    seg = samples[: n * b].reshape(n, b)
    rms = np.sqrt(np.mean(seg**2, axis=1) + 1e-9)
    return rms, bucket


def _audio_events(wav: Path, total_duration: float) -> list[dict[str, Any]]:
    """Loudness spikes, shouting, sudden silence, laughter texture, excitement."""
    events: list[dict[str, Any]] = []
    rms, bucket = _audio_rms(wav, config.STREAMER_AUDIO_BUCKET)
    if len(rms) < 8:
        return events

    mean = float(np.mean(rms))
    std = float(np.std(rms)) + 1e-9
    p95 = float(np.percentile(rms, 95)) + 1e-9
    floor = float(np.percentile(rms, 20))

    ts = np.arange(len(rms)) * bucket
    dur = min(total_duration, len(rms) * bucket)

    # Loudness spike / shout: energy jumps significantly above local baseline.
    spike_thresh = mean + 2.2 * std
    shout_thresh = mean + 3.6 * std
    i = 0
    while i < len(rms):
        if rms[i] >= spike_thresh:
            j = i
            peak = i
            while j < len(rms) and rms[j] >= mean + 1.2 * std:
                if rms[j] > rms[peak]:
                    peak = j
                j += 1
            loud = float(rms[peak] / shout_thresh) if rms[peak] >= shout_thresh else float(
                (rms[peak] - mean) / (spike_thresh - mean + 1e-9)
            )
            t = min(float(ts[peak]), dur - 0.5)
            types = ["audio_spike"]
            if rms[peak] >= shout_thresh:
                types.append("shout")
            # Silence right after the spike = dramatic beat that reads on camera.
            if j < len(rms) and rms[max(j, peak + 1) : min(j + 2, len(rms))].mean() <= floor:
                types.append("sudden_silence")
            events.append(
                {
                    "timestamp": round(t, 2),
                    "event_types": types,
                    "signals": {
                        "audio_energy": round(min(1.0, max(loud, 0.0)), 3),
                        "speech_emotion": round(min(1.0, max(loud, 0.0)), 3),
                    },
                    "initial_interest": round(min(1.0, 0.45 + loud * 0.55), 3),
                }
            )
            i = j
        else:
            i += 1

    # Laughter texture: high RMS variance within a short window = rapid
    # oscillating sound bursts (laughs, excited chatter, applause).
    win = max(2, int(2.0 / bucket))
    pad = np.pad(rms, (0, max(0, win - 1)), mode="reflect")
    rolled = np.lib.stride_tricks.sliding_window_view(pad, win)
    var = np.var(rolled, axis=1)
    var_thresh = float(np.percentile(var, 90))
    vmean = float(np.mean(rms))
    i = 0
    while i < len(var) - 1:
        if var[i] >= var_thresh and rms[i] > vmean * 1.5:
            j = i
            while j < len(var) and var[j] >= var_thresh * 0.9:
                j += 1
            t = float(ts[(i + j) // 2]) + bucket
            if t < 0 or t > dur - 0.5:
                i = j
                continue
            strength = min(1.0, var[i] / max(var_thresh * 1.6, 1e-9))
            events.append(
                {
                    "timestamp": round(t, 2),
                    "event_types": ["excited_audio", "laughter_tendency"],
                    "signals": {
                        "audio_energy": round(min(1.0, strength), 3),
                        "laugh_probability": round(strength, 3),
                        "speech_emotion": round(min(1.0, strength), 3),
                    },
                    "initial_interest": round(min(1.0, 0.35 + strength * 0.5), 3),
                }
            )
            i = j
        else:
            i += 1

    # Keep only the strongest, best-spread events.
    events.sort(key=lambda e: e["initial_interest"], reverse=True)
    kept: list[dict[str, Any]] = []
    for e in events:
        if len(kept) >= config.STREAMER_MAX_EVENTS // 2:
            break
        if all(abs(e["timestamp"] - k["timestamp"]) > config.STREAMER_MERGE_GAP for k in kept):
            kept.append(e)
    return kept


# ── Transcript events ──────────────────────────────────────────────────────


def _transcript_event_score(text: str) -> dict[str, Any]:
    """Which cue sets fire + a rough emotional intensity 0..1 for one segment."""
    lower = text.lower()
    fired: list[str] = []
    for etype, cues in TRANSCRIPT_CUES.items():
        if any(cue in lower for cue in cues):
            fired.append(etype)
    hits = sum(1 for cue in sum(TRANSCRIPT_CUES.values(), []) if cue in lower)
    emph = min(lower.count("!") / 2.0, 1.0)
    words = lower.split()
    cap_ratio = (
        sum(1 for w in words if w.isupper() and len(w) > 2) / max(len(words), 1)
        if words
        else 0.0
    )
    emo = min(sum(1 for w in EMOTIONAL_WORDS if w in lower) / 3.0, 1.0)
    intensity = min(1.0, 0.25 * len(fired) + 0.2 * emph + 0.25 * cap_ratio + 0.3 * emo)
    return {"event_types": fired, "intensity": intensity, "hits": hits}


def _transcript_events(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cue-based hits on individual segments (cheap recall only)."""
    events: list[dict[str, Any]] = []
    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        sk = _transcript_event_score(text)
        if sk["intensity"] <= 0.28:
            continue
        events.append(
            {
                "timestamp": round(float(seg.get("start", 0)), 2),
                "event_types": sk["event_types"] or ["speech_emotion"],
                "signals": {
                    "speech_emotion": round(min(1.0, sk["intensity"]), 3),
                    "keyword_hits": min(sk["hits"], 10),
                },
                "initial_interest": round(min(1.0, 0.30 + sk["intensity"] * 0.65), 3),
            }
        )
    return events


# ── Visual events ──────────────────────────────────────────────────────────


def _visual_events(
    video: Path,
    scenes: list[tuple[float, float]],
    total_duration: float,
) -> list[dict[str, Any]]:
    """Motion spikes (keyframe diffs) + scene/camera changes."""
    events: list[dict[str, Any]] = []
    keyframe_ts: list[float] = []
    keyframe_diff: list[float] = []

    try:
        import energy

        diffs, _ = energy._keyframe_diffs(video)
        if len(diffs) >= 4 and total_duration > 0:
            n = len(diffs)
            keyframe_ts = [float(i * total_duration / n) for i in range(n)]
            keyframe_diff = [float(d) for d in diffs]
    except Exception:
        pass

    # Motion spike events.
    if len(keyframe_diff) >= 8:
        arr = np.array(keyframe_diff)
        mean = float(np.mean(arr))
        std = float(np.std(arr)) + 1e-9
        thresh = mean + 2.4 * std
        ts_arr = np.array(keyframe_ts)
        i = 0
        while i < len(arr):
            if arr[i] >= thresh:
                j = i
                peak = i
                while j < len(arr) and arr[j] >= mean + 1.2 * std:
                    if arr[j] > arr[peak]:
                        peak = j
                    j += 1
                strength = min(1.0, (arr[peak] - mean) / max(3.0 * std, 1e-9))
                events.append(
                    {
                        "timestamp": round(min(float(ts_arr[peak]), total_duration - 0.5), 2),
                        "event_types": ["visual_reaction"],
                        "signals": {"motion_change": round(max(strength, 0.0), 3)},
                        "initial_interest": round(min(1.0, 0.30 + strength * 0.5), 3),
                    }
                )
                i = j
            else:
                i += 1

    # Scene cuts = new visual information appears (camera change).
    for s, e in scenes:
        if e - s < 1.0:
            continue
        events.append(
            {
                "timestamp": round(float(s), 2),
                "event_types": ["camera_change"],
                "signals": {"scene_cut": 1.0, "motion_change": 0.4},
                "initial_interest": 0.22,  # cuts alone are weak — need another signal
            }
        )
    return events


# ── Merge + sequences ───────────────────────────────────────────────────────


def merge_sequences(
    events: list[dict[str, Any]],
    gap: float = 6.0,
    max_seq: int | None = None,
) -> list[dict[str, Any]]:
    """Cluster co-located events into event sequences (the unit of analysis).

    Returns sequences sorted by initial_interest desc with fields:
    timestamp.start/timestamp.peak/timestamp.end, event_types (deduped),
    signals (per-key max), initial_interest (max).
    """
    if not events:
        return []
    ordered = sorted(events, key=lambda e: e["timestamp"])

    sequences: list[dict[str, Any]] = []
    cur: list[dict[str, Any]] = [ordered[0]]
    for e in ordered[1:]:
        anchor = max(cur, key=lambda x: x["timestamp"])
        if e["timestamp"] - anchor["timestamp"] <= gap:
            cur.append(e)
        else:
            sequences.append(cur)
            cur = [e]
    sequences.append(cur)

    out: list[dict[str, Any]] = []
    for group in sequences:
        start = min(g["timestamp"] for g in group)
        end = max(g["timestamp"] for g in group)
        peak = max(group, key=lambda g: g["initial_interest"])
        types: list[str] = []
        for g in group:
            for t in g.get("event_types", []):
                if t not in types:
                    types.append(t)
        sig: dict[str, float] = defaultdict(float)
        for g in group:
            for k, v in (g.get("signals") or {}).items():
                if isinstance(v, (int, float)) and v > sig[k]:
                    sig[k] = float(v)
        # Soften with span length — very long merged regions dilute.
        span = end - start
        interest = float(peak["initial_interest"])
        if span > gap * 2:
            interest *= 0.9
        out.append(
            {
                "start": round(max(0.0, start - 0.5), 2),
                "peak": round(float(peak["timestamp"]), 2),
                "end": round(end + 0.5, 2),
                "event_types": types,
                "signals": dict(sig),
                "initial_interest": round(min(1.0, interest), 3),
            }
        )

    out.sort(key=lambda s: s["initial_interest"], reverse=True)
    n = max_seq or config.STREAMER_MAX_SEQUENCES
    return out[:n]


# ── Context window generation ───────────────────────────────────────────────


def context_windows(
    sequence: dict[str, Any],
    segments: list[dict[str, Any]],
    total_duration: float,
) -> list[dict[str, Any]]:
    """Expand one event sequence into candidate clip variants.

    Each variant is a different amount of setup (before peak) and aftermath
    (after peak). Qwen3-VL then picks where the clip should actually start
    and end — humor and reactions need different amounts of runway.
    """
    peak = float(sequence["peak"])
    pre = config.STREAMER_CONTEXT_PRE
    post = config.STREAMER_CONTEXT_POST
    spread = config.STREAMER_CONTEXT_SPREAD
    variants = config.STREAMER_CONTEXT_VARIANTS

    pres = [pre * (1 - spread), pre, pre * (1 + spread)]
    posts = [post * (1 - spread), post, post * (1 + spread)]
    pairs = {(round(p, 2), round(q, 2)) for p in pres for q in posts}
    pairs = list(pairs)[: max(1, variants)]

    windows: list[dict[str, Any]] = []
    for p, q in pairs:
        start = round(max(0.0, peak - p), 2)
        end = round(min(total_duration, peak + q), 2)
        if end - start < config.STREAMER_MIN_CLIP:
            continue
        if end - start > config.STREAMER_MAX_CLIP:
            # Prefer dropping setup over dropping the reaction.
            start = round(max(0.0, end - config.STREAMER_MAX_CLIP), 2)
        windows.append(
            {
                "start": start,
                "end": end,
                "peak": peak,
                "event_types": list(sequence.get("event_types", [])),
                "signals": dict(sequence.get("signals", {})),
                "initial_interest": sequence["initial_interest"],
                "text": _text_for_window(segments, start, end),
            }
        )

    # Unique (start, end) only — keep up to CONTEXT_VARIANTS per sequence.
    uniq: list[dict[str, Any]] = []
    seen_keys: set[tuple[float, float]] = set()
    for w in windows:
        key = (round(w["start"], 1), round(w["end"], 1))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        uniq.append(w)
        if len(uniq) >= max(1, config.STREAMER_CONTEXT_VARIANTS):
            break
    return uniq


# ── Public API ─────────────────────────────────────────────────────────────


def detect_events(
    wav: Path,
    video: Path,
    segments: list[dict[str, Any]],
    scenes: list[tuple[float, float]],
    total_duration: float,
) -> list[dict[str, Any]]:
    """All normalized event objects (audio + transcript + visual) merged into
    ranked event sequences."""
    events: list[dict[str, Any]] = []
    if wav.exists():
        try:
            events += _audio_events(wav, total_duration)
        except Exception:
            pass
    if segments:
        events += _transcript_events(segments)
    if video.exists():
        try:
            events += _visual_events(video, scenes, total_duration)
        except Exception:
            pass

    sequences = merge_sequences(events, gap=config.STREAMER_MERGE_GAP)
    return sequences


def build_candidates(
    sequences: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    total_duration: float,
    max_cands: int | None = None,
) -> list[dict[str, Any]]:
    """Turn ranked event sequences into clip-window candidates for Qwen3-VL.

    Guarantees WHOLE-STREAM temporal coverage. Without spreading, saturated
    initial_interest (many sequences pinned at 1.0) degenerates to
    chronological order — the first few minutes of audio spikes eat the entire
    budget and later golden windows starve (the original front-of-stream bug
    on 53-min streams). Strategy:

      1. window variants per sequence (setup/aftermath mixes)
      2. round-robin across temporal bands → every region represented
      3. evenly-spaced scan windows → quiet stretches still get judged
      4. remaining slots filled by pure interest order
    """

    def _key(w: dict[str, Any]) -> tuple[float, float]:
        return (round(float(w["start"]), 1), round(float(w["end"]), 1))

    caps = max_cands or config.STREAMER_PASS_A_LIMIT
    if caps <= 0 or total_duration <= 0:
        return []

    # Reserve a share of the budget for coverage scans so the dead-zone pass
    # (below) can actually insert candidates instead of being starved by the
    # band round-robin.
    rr_budget = max(4, caps * 2 // 3)

    # 1) Expand every sequence into its bounded window variants.
    expanded: list[dict[str, Any]] = []
    for seq in sequences:
        ws = context_windows(seq, segments, total_duration)
        if not ws:
            continue
        expanded.extend(ws[: max(1, config.STREAMER_CONTEXT_VARIANTS)])
    expanded.sort(key=lambda w: w["initial_interest"], reverse=True)

    seen: set[tuple[float, float]] = set()
    for w in expanded:
        seen.add(_key(w))
    picks: list[dict[str, Any]] = []

    # 2) Round-robin across temporal bands — ~1 band per 240s, min 4.
    n_bands = max(4, min(rr_budget, int(total_duration / 240.0) + 1))
    bands: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for w in expanded:
        b = min(n_bands - 1, int(w["peak"] / max(total_duration, 1e-9) * n_bands))
        bands[b].append(w)

    band_ids = sorted(bands)
    while len(picks) < rr_budget and band_ids:
        progressed = False
        for b in band_ids:
            if len(picks) >= rr_budget:
                break
            bucket = bands[b]
            if not bucket:
                continue
            picks.append(bucket[0])
            bucket.pop(0)
            progressed = True
        if not progressed:
            break

    # 2b) Dead-zone scan: any uncovered time band wider than a threshold gets
    #     a transcript-anchored midpoint candidate, so no 4-minute stretch of
    #     the stream goes unjudged. Measures actual window coverage (an event
    #     peak inside a band does NOT mean the band is covered).
    def _gaps_over_threshold(threshold: float) -> list[tuple[float, float]]:
        spans = sorted((float(w["start"]), float(w["end"])) for w in picks)
        merged: list[tuple[float, float]] = []
        for s, e in spans:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        gaps: list[tuple[float, float]] = []
        cursor = 0.0
        for s, e in merged:
            if s - cursor >= threshold:
                gaps.append((cursor, s))
            cursor = max(cursor, e)
        if total_duration - cursor >= threshold:
            gaps.append((cursor, total_duration))
        return [(a, b) for a, b in gaps if b - a >= config.STREAMER_MIN_CLIP]

    gap_thresh = max(config.STREAMER_MERGE_GAP * 3, min(90.0, total_duration / max(caps * 2, 1)))
    for gs, ge in _gaps_over_threshold(gap_thresh):
        if len(picks) >= caps:
            break
        mid = (gs + ge) / 2.0
        start = round(max(0.0, mid - config.STREAMER_CONTEXT_PRE), 2)
        end = round(min(total_duration, mid + config.STREAMER_CONTEXT_POST), 2)
        key = (round(start, 1), round(end, 1))
        if key in seen or end - start < config.STREAMER_MIN_CLIP:
            continue
        text = _text_for_window(segments, start, end)
        if not text:
            continue
        seen.add(key)
        picks.append(
            {
                "start": start,
                "end": end,
                "peak": round(mid, 2),
                "event_types": ["coverage_scan"],
                "signals": {},
                "initial_interest": 0.30,
                "text": text,
            }
        )

    # 3) Even scan — guarantee every ~4 min span gets at least one candidate
    #    even where no detector event fired (quiet but funny banter).
    if len(picks) < caps:
        step = max(
            config.STREAMER_MIN_CLIP + 8.0,
            (total_duration - config.STREAMER_ANALYZE_PRE - config.STREAMER_ANALYZE_POST)
            / max(caps, 1),
        )
        t = step
        while t < total_duration - config.STREAMER_MIN_CLIP and len(picks) < caps:
            start = round(max(0.0, t - config.STREAMER_CONTEXT_PRE), 2)
            end = round(min(total_duration, t + config.STREAMER_CONTEXT_POST), 2)
            key = (round(start, 1), round(end, 1))
            if key not in seen and end - start >= config.STREAMER_MIN_CLIP:
                text = _text_for_window(segments, start, end)
                if not text:
                    t += step
                    continue
                seen.add(key)
                picks.append(
                    {
                        "start": start,
                        "end": end,
                        "peak": round(t, 2),
                        "event_types": ["coverage_scan"],
                        "signals": {},
                        "initial_interest": 0.30,
                        "text": text,
                    }
                )
            t += step

    # 4) Fill any remaining budget by interest order.
    for w in expanded:
        if len(picks) >= caps:
            break
        key = _key(w)
        if key in seen:
            continue
        seen.add(key)
        picks.append(w)

    return picks[:caps]