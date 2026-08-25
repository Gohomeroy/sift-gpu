"""Stage 5: Qwen2.5-VL pass — watch the top windows and judge them.

Frames are sampled at 1 fps per finalist window and sent to a llama.cpp
server (llama-server with a Qwen2.5-VL GGUF + mmproj) over its
OpenAI-compatible endpoint. The model returns strict JSON:
  { "score": 0-100, "hook": str, "reasoning": str, "visual_energy": 0-10 }

If LLAMA_SERVER_URL is unset or unreachable, this stage is skipped and
heuristic scores stand — the pipeline never hard-fails because of it.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path

import requests

import config

SYSTEM_PROMPT = (
    "You are a short-form video virality expert. You will see sampled frames "
    "from one candidate clip window plus its transcript. Judge it like a "
    "TikTok/Shorts algorithm would. Respond ONLY with minified JSON: "
    '{"score": <0-100 int>, "hook": "<3-word hook type>", '
    '"reasoning": "<one sentence>", "visual_energy": <0-10 int>}'
)


def available() -> bool:
    if not config.LLAMA_SERVER_URL:
        return False
    try:
        r = requests.get(f"{config.LLAMA_SERVER_URL}/health", timeout=3)
        return r.status_code == 200
    except Exception:
        return False


def sample_frames(video: Path, start: float, end: float, out_dir: Path, max_frames: int = 40) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    duration = max(end - start, 1)
    fps = min(1.0, max_frames / duration)
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", str(start), "-t", str(duration),
            "-i", str(video), "-vf", f"fps={fps},scale=512:-2",
            str(out_dir / "f_%03d.jpg"),
        ],
        capture_output=True,
        timeout=300,
        check=True,
    )
    frames = sorted(out_dir.glob("f_*.jpg"))[:max_frames]
    return frames


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


def refine(video: Path, finalists: list[dict[str, Any]], work_dir: Path) -> list[dict[str, Any]]:
    """Blend VL verdicts into finalist scores; returns finalists in rank order."""
    if not available():
        for f in finalists:
            f["vl"] = None
        return finalists

    for i, w in enumerate(finalists):
        frames_dir = work_dir / f"frames_{i}"
        try:
            frames = sample_frames(Path(video), w["start"], w["end"], frames_dir)
        except Exception:
            frames = []
        verdict = _ask_vlm(frames, w["text"]) if frames else None

        if verdict is None:
            w["vl"] = None
            continue

        # Blend: heuristic 45% · semantic-informed score01 15% · VL 40%.
        blended01 = w["score01"] * 0.60 + (verdict["score"] / 100) * 0.40
        w["score01"] = round(min(blended01, 1.0), 3)
        w["vl"] = verdict

    finalists.sort(key=lambda x: x["score01"], reverse=True)
    return finalists
