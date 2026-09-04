"""Group word timestamps into caption line cues for the renderer."""

from __future__ import annotations

from typing import Any

MAX_WORDS_PER_CUE = 4
MAX_CUE_SECONDS = 1.6


def build_cues(
    words: list[dict[str, Any]], start: float, end: float
) -> list[dict[str, Any]]:
    """[{start,end,words:[{text,start,end}]}] clipped to [start,end]."""
    inside = [
        {
            "text": w["word"],
            "start": round(max(float(w["start"]) - start, 0), 2),
            "end": round(min(float(w["end"]) - start, end - start), 2),
        }
        for w in words
        if float(w["end"]) > start and float(w["start"]) < end and w.get("word")
    ]

    cues: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        if not current:
            return
        cues.append(
            {
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "words": list(current),
            }
        )
        current.clear()

    for w in inside:
        if current:
            span = w["end"] - current[0]["start"]
            gap = w["start"] - current[-1]["end"]
            if len(current) >= MAX_WORDS_PER_CUE or span > MAX_CUE_SECONDS or gap > 0.5:
                flush()
        current.append(w)
    flush()

    return cues
