"""Stage 2: word-level transcription with faster-whisper (CPU int8).

Streams progress via callback (long videos otherwise look frozen at the
transcribing stage) and enforces a stall watchdog — if no new segment
arrives for STALL_TIMEOUT_SECONDS the transcription aborts instead of
hanging forever.
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable

from faster_whisper import WhisperModel

import config

STALL_TIMEOUT_SECONDS = int(os.environ.get("WHISPER_STALL_TIMEOUT", "300"))

_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(
            config.WHISPER_MODEL,
            device="cpu",
            compute_type="int8",
            cpu_threads=max(2, (os.cpu_count() or 4)),
        )
    return _model


def transcribe(
    audio_path: str,
    on_progress: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    """Returns {'segments': [...], 'words': [...]}.

    on_progress(fraction 0..1) fires as audio position advances.
    """
    model = _get_model()
    segments_out: list[dict[str, Any]] = []
    words_out: list[dict[str, Any]] = []

    segments, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        beam_size=1,  # greedy — ~2x faster than default beam, minor quality cost
    )

    total = float(info.duration or 0)
    last_yield = time.time()
    last_reported = -1.0

    for seg in segments:
        now = time.time()
        if now - last_yield > STALL_TIMEOUT_SECONDS:
            raise RuntimeError(
                f"transcription stalled: no new segments for {STALL_TIMEOUT_SECONDS}s "
                f"(position {seg.end:.0f}s of {total:.0f}s)"
            )
        last_yield = now

        segments_out.append(
            {"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()}
        )
        for w in seg.words or []:
            words_out.append(
                {
                    "start": round(w.start, 2),
                    "end": round(w.end, 2),
                    "word": w.word.strip(),
                }
            )

        if on_progress and total > 0:
            frac = min(seg.end / total, 1.0)
            if frac - last_reported >= 0.02:  # throttle DB writes to ~2% steps
                last_reported = frac
                on_progress(frac)

    return {"segments": segments_out, "words": words_out}
