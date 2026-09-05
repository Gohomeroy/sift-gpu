"""Stage 1: staged downloads — audio first, analysis video, then slices.

Only the audio is needed for transcription/scoring, and it's ~20x smaller
than video. Visual analysis runs on a worst-quality download. Final cuts
download ONLY the winning sections via yt-dlp --download-sections.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import config

# YouTube bot-walls anonymous web-client downloads; android+safari player
# clients dodge it without cookies. Browser cookies remain as fallback.
# A cookie file (Netscape format) beats all of them.
# Node + EJS fetch solve YouTube's JS challenge when yt-dlp runs from PyPI
# (pip package has no bundled scripts; node is a hard dep for Remotion anyway).
# Also route through a proxy when configured: YouTube flags datacenter IPs at
# the playability gate (before tokens are checked), so egressing through
# Cloudflare WARP (or any non-flagged IP) is what actually unblocks downloads.
EJS_ARGS = ["--js-runtimes", "node", "--remote-components", "ejs:github"]
# Throttle requests + retry to ride out YouTube's transient IP tag-of-war.
RELAX_ARGS = ["--sleep-requests", "1.0", "--retries", "4", "--retry-sleep", "15"]
# Prefer h264 > vp9 > av01. AV1 mp4 gets picked by `ext=mp4` format filters and
# OpenCV/PySceneDetect can't decode it on this container (no hw AV1).
FORMAT_ARGS = ["--format-sort", "vcodec:h264"]
PROXY_ARGS = ["--proxy", config.YTDLP_PROXY] if config.YTDLP_PROXY else []
STRATEGIES: list[list[str]] = []
if config.YTDLP_COOKIES_FILE:
    STRATEGIES.append(["--cookies", str(config.YTDLP_COOKIES_FILE), *PROXY_ARGS, *EJS_ARGS, *RELAX_ARGS, *FORMAT_ARGS])
STRATEGIES += [
    ["--extractor-args", "youtube:player_client=android,web_safari", *PROXY_ARGS, *EJS_ARGS, *RELAX_ARGS, *FORMAT_ARGS],
    *(
        [["--cookies-from-browser", b, *PROXY_ARGS, *EJS_ARGS, *RELAX_ARGS, *FORMAT_ARGS] for b in [
            os.environ.get("YTDLP_COOKIES_FROM", ""),
            "chrome", "edge", "brave", "firefox",
        ] if b]
    ),
    [*PROXY_ARGS, *EJS_ARGS, *RELAX_ARGS, *FORMAT_ARGS],
]


def _run_ytdlp(args: list[str], what: str) -> Path | None:
    out_dir = Path(args[args.index("-o") + 1]).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    # Snapshot existing files so we can detect truly new downloads.
    existing = {f.name for f in out_dir.iterdir() if f.is_file()}

    for extra in STRATEGIES:
        proc = subprocess.run(
            ["yt-dlp", *args, *extra],
            capture_output=True, text=True, timeout=60 * 30,
        )
        # Only accept files that didn't exist before this attempt AND are >10KB.
        produced = [
            f for f in out_dir.iterdir()
            if f.is_file() and f.name not in existing and f.stat().st_size > 10_000
        ]
        if proc.returncode == 0 and produced:
            return produced[0]
        print(
            f"[ingest] {what} attempt failed ({' '.join(extra) or 'plain'}): "
            f"{proc.stderr[-160:]}", flush=True,
        )
    return None


def download_audio(source_url: str, job_id: str) -> Path:
    """Bestaudio-only download — small and fast, all we need to transcribe."""
    out_dir = config.WORK_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "source_audio"
    got = _run_ytdlp(
        [
            "-f", "bestaudio/best",
            "--no-playlist",
            "-o", str(target),
            source_url,
        ],
        "audio",
    )
    if got is None:
        raise RuntimeError("yt-dlp could not download audio for this link.")
    return got


def extract_audio(media: Path) -> Path:
    wav = media.parent / "audio.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(media), "-vn", "-ac", "1", "-ar", "16000",
         str(wav)],
        capture_output=True, timeout=60 * 20, check=True,
    )
    return wav


def download_analysis_video(source_url: str, job_id: str) -> Path | None:
    """Worst-format video for the cheap motion/cut pass (optional)."""
    out_dir = config.WORK_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "analysis_video"
    return _run_ytdlp(
        [
            "-f", "worst[height>=144]/worst",
            "--no-playlist",
            "-o", str(target),
            source_url,
        ],
        "analysis-video",
    )


def download_sections(
    source_url: str,
    job_id: str,
    sections: list[tuple[float, float]],
    height: int = 1080,
) -> list[Path | None]:
    """Download only the winning windows as video files (index-aligned).

    Default to 1080p (not 720p) so the 9:16 vertical crop keeps enough native
    resolution to look crisp when reframed to 1080x1920. Upscaling a 720p
    source (~405px wide after the 9:16 vertical crop) to 1080 looks soft/blurry.
    """
    out_dir = config.WORK_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    files: list[Path | None] = []
    for i, (start, end) in enumerate(sections):
        target = out_dir / f"section_{i}.mp4"
        got = _run_ytdlp(
            [
                "-f", f"bv*[height<={height}][ext=mp4]+ba[ext=m4a]/b[height<={height}]/b",
                "--merge-output-format", "mp4",
                "--no-playlist",
                "--force-keyframes-at-cuts",
                "--download-sections", f"*{start:.2f}-{end:.2f}",
                "-o", str(target),
                source_url,
            ],
            f"section-{i}",
        )
        files.append(got)
    return files


def download_full_video(source_url: str, job_id: str) -> Path:
    """Fallback when section downloads fail — full ≤1080p video."""
    out_dir = config.WORK_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "source.mp4"
    got = _run_ytdlp(
        [
            "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/bv*+ba/b",
            "--merge-output-format", "mp4",
            "--no-playlist",
            "-o", str(target),
            source_url,
        ],
        "full-video",
    )
    if got is None:
        raise RuntimeError("yt-dlp could not download this video at all.")
    return got
