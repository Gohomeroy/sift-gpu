"""Blur-fill vertical reframe — the "fits widescreen on a short" look.

Landscape/square sources are scaled down to fit inside a 1080x1920 canvas and
centered, while the SAME video fills the top/bottom area enlarged + heavily
blurred (slightly darkened so the foreground pops). Whole frame is built with
one ffmpeg filtergraph — no Python per-frame loop, no new dependencies.

Portrait sources (already ~9:16 or taller) skip the blur: they're just
center-cropped to 9:16 and scaled (matches the plain-crop fallback elsewhere).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2

from reframe_v2 import _enc_args  # reuse NVENC/libx264 picker

OUT_W, OUT_H = 1080, 1920

_BG_BLUR_SMALL = "320:568"   # blur at low res → fast; upscale after blur
_BG_BLUR_SIGMA = 30
_BG_BRIGHTNESS = -0.08        # subtle darken so the foreground pops
_BG_SATURATION = 1.05


def get_video_duration(video: Path) -> float:
    from reframe_v2 import get_video_duration as _dur
    return _dur(video)


def _blur_fill_filter(is_portrait: bool) -> str:
    if is_portrait:
        # Already vertical — plain 9:16 center crop + scale (no blur look).
        return (
            "crop=min(iw,ih*9/16):ih:(iw-min(iw,ih*9/16))/2:0,"
            "scale=1080:1920:force_divisible_by=2,format=yuv420p[v]"
        )

    fg = (
        "scale=1080:1920:force_original_aspect_ratio=decrease"
        ":force_divisible_by=2"
    )
    bg = (
        "scale=1080:1920:force_original_aspect_ratio=increase"
        ":force_divisible_by=2,"
        "crop=1080:1920,"
        f"scale={_BG_BLUR_SMALL}:flags=area,gblur=sigma={_BG_BLUR_SIGMA},"
        "scale=1080:1920:flags=bilinear,"
        f"eq=brightness={_BG_BRIGHTNESS}:saturation={_BG_SATURATION}"
    )
    return (
        f"[0:v]split=2[fg][bg];"
        f"[fg]{fg}[fgv];"
        f"[bg]{bg}[bgv];"
        f"[bgv][fgv]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]"
    )


def _probe_dims(video: Path) -> tuple[int, int]:
    cap = cv2.VideoCapture(str(video))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1920
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1080
    cap.release()
    return w, h


def cut_and_reframe(video: Path, start: float, end: float, out_path: Path) -> Path:
    """Cut + blur-fill a segment to 1080x1920 with original audio."""
    duration = end - start
    src_w, src_h = _probe_dims(video)
    is_portrait = src_h >= src_w * 16 / 9 - 1  # ≈9:16 or taller

    seg_path = out_path.parent / (out_path.stem + "_seg.mp4")
    audio_path = out_path.parent / (out_path.stem + "_audio.m4a")
    silent_path = out_path.parent / (out_path.stem + "_silent.mp4")

    # 1) Wide cut — stream copy, no re-encode (instant, lossless).
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
         "-i", str(video), "-c", "copy", str(seg_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 1b) Extract audio once.
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(seg_path), "-vn",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100", str(audio_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 2) Build the canvas in one pass.
    filt = _blur_fill_filter(is_portrait)
    proc = subprocess.run(
        ["ffmpeg", "-y",
         "-i", str(seg_path),
         "-filter_complex", filt,
         "-map", "[v]",
         *_enc_args(),
         "-pix_fmt", "yuv420p",
         str(silent_path)],
        capture_output=True, text=True, timeout=60 * 30,
    )
    if proc.returncode != 0 or not silent_path.exists():
        raise RuntimeError(f"blur-fill render failed: {proc.stderr[-400:]}")

    # 3) Mux audio (stream copy).
    proc = subprocess.run(
        ["ffmpeg", "-y",
         "-i", str(silent_path), "-i", str(audio_path),
         "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "copy",
         str(out_path)],
        capture_output=True, text=True, timeout=60 * 30,
    )
    seg_path.unlink(missing_ok=True)
    silent_path.unlink(missing_ok=True)
    audio_path.unlink(missing_ok=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError(f"blur-fill mux failed: {proc.stderr[-300:]}")
    return out_path