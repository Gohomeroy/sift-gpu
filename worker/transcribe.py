"""Stage 2: word-level transcription with faster-whisper (CPU int8)."""

from __future__ import annotations

from typing import Any

from faster_whisper import WhisperModel

import config

_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        _model = WhisperModel(
            config.WHISPER_MODEL,
            device="cpu",
            compute_type="int8",
        )
    return _model


def transcribe(audio_path: str) -> dict[str, Any]:
    """Returns {'segments': [{start,end,text}, ...], 'words': [{start,end,word}]}."""
    model = _get_model()
    segments_out: list[dict[str, Any]] = []
    words_out: list[dict[str, Any]] = []

    segments, _info = model.transcribe(
        audio_path,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
    )
    for seg in segments:
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

    return {"segments": segments_out, "words": words_out}
