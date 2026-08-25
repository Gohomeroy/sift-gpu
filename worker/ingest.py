"""Stage 1: download the source video and extract mono 16k audio."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import config

# YouTube bot-walls anonymous web-client downloads. Strategies tried in
# order: the android+safari player clients dodge the check without cookies,
# then local browser cookies as fallback.
STRATEGIES: list[list[str]] = [
    ["--extractor-args", "youtube:player_client=android,web_safari"],
    *(
        [["--cookies-from-browser", b] for b in [
            os.environ.get("YTDLP_COOKIES_FROM", ""),
            "chrome", "edge", "brave", "firefox",
        ] if b]
    ),
    [],
]


def download(source_url: str, job_id: str) -> Path:
    out_dir = config.WORK_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "source.mp4"

    base_cmd = [
        "yt-dlp",
        "-f",
        "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        str(target),
        source_url,
    ]

    last_err = ""
    for extra in STRATEGIES:
        proc = subprocess.run(
            [*base_cmd, *extra], capture_output=True, text=True, timeout=60 * 30
        )
        if proc.returncode == 0 and target.exists():
            return target
        candidates = list(out_dir.glob("source.*"))
        if candidates:
            return candidates[0]
        last_err = proc.stderr[-400:]
        print(f"[ingest] attempt failed ({' '.join(extra) or 'plain'}): {last_err[-160:]}", flush=True)

    raise RuntimeError(f"yt-dlp failed: {last_err}")


def extract_audio(video_path: Path) -> Path:
    audio = video_path.parent / "audio.wav"
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video_path),
            "-vn", "-ac", "1", "-ar", "16000",
            str(audio),
        ],
        capture_output=True,
        timeout=60 * 20,
        check=True,
    )
    return audio
