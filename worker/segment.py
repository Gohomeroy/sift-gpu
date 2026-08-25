"""Stage 3: merge sentences into candidate clip windows (20-60s).

Boundaries snap to sentence edges and prefer starting after a silence gap,
so clips open on a clean beat instead of mid-thought.
"""

from __future__ import annotations

from typing import Any

MIN_WINDOW = 18.0
MAX_WINDOW = 62.0
GAP_BONUS_SECONDS = 0.6  # a pause this long before a sentence makes a good opener


def build_windows(
    transcript_segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not transcript_segments:
        return []

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
                "start": round(max(0.0, w_start - 0.25), 2),
                "end": round(min(w_end + 0.35, w_start + MAX_WINDOW), 2),
                "text": " ".join(seg["text"] for seg in chosen),
                "opens_after_pause": prev_gap >= GAP_BONUS_SECONDS,
                "sentence_count": len(chosen),
            }
        )
        # Overlap by one sentence so strong moments aren't split at the seam.
        start_idx += max(1, int(len(chosen) * 0.8))

    return windows
