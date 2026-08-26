"""Cheap full-coverage energy analysis — the visual senses.

Runs over the WHOLE video so visually-hot windows rank up even when the
transcript is bland (gameplay, physical comedy, reactions):

  motion      mean frame-difference on keyframes-only decode (~10-20x realtime)
  cut_density hard-scene-change spikes per second
  loudness    mean speech-band RMS per window
  dynamics    RMS variance — screaming/laughter/applause texture

All features normalized 0..1 across the video's own windows.
Decode trick: ffmpeg `-skip_frame nokey` decodes keyframes only, so a
1-hour video costs seconds-to-a-minute instead of a full decode.
"""

from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np


# ---------------------------------------------------------------------------
# Video: motion + cut density from keyframe-only decode via rawvideo pipe
# ---------------------------------------------------------------------------

def _keyframe_diffs(video: Path) -> tuple[np.ndarray, float]:
    """Returns (diffs between consecutive keyframes, effective fps of samples)."""
    cmd = [
        "ffmpeg", "-nostats", "-loglevel", "error",
        "-skip_frame", "nokey",
        "-i", str(video),
        "-vf", "scale=160:-2",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=60 * 20)
    raw = proc.stdout
    # 160x90 gray frames at standard keyframe sizes; infer frame size from data.
    w, h = 160, 90
    frame_size = w * h
    n = len(raw) // frame_size
    if n < 4:
        return np.array([]), 0.0
    frames = np.frombuffer(raw[: n * frame_size], dtype=np.uint8).reshape(n, h, w)
    diffs = np.abs(np.diff(frames.astype(np.int16), axis=0)).mean(axis=(1, 2)) / 255.0
    return diffs, 0.0  # fps resolved by caller from duration


def video_energy(video: Path, duration: float) -> tuple[np.ndarray, np.ndarray]:
    """Per-window (motion, cuts) arrays aligned to caller's windows."""
    diffs, _ = _keyframe_diffs(video)
    return diffs, diffs  # raw series; windowing done by caller helper below


def window_video_features(
    windows: list[dict], diffs: np.ndarray, total_duration: float
) -> None:
    """Attach motion/cut_density (0..1) to each window in place."""
    if len(diffs) < 4 or total_duration <= 0:
        for w in windows:
            w["motion"] = 0.0
            w["cut_density"] = 0.0
        return

    sample_fps = len(diffs) / max(total_duration, 1)
    thresh = float(np.mean(diffs) + 2.0 * np.std(diffs))
    cuts = (diffs > max(thresh, 0.18)).astype(float)

    motions, cut_dens = [], []
    for w in windows:
        a = int(w["start"] * sample_fps)
        b = max(int(w["end"] * sample_fps), a + 1)
        seg = diffs[a:b]
        cseg = cuts[a:b]
        motions.append(float(seg.mean()) if len(seg) else 0.0)
        dur = max(w["end"] - w["start"], 1)
        cut_dens.append(float(cseg.sum() / dur))

    motions_arr = np.array(motions)
    cut_arr = np.array(cut_dens)
    m_max = motions_arr.max() or 1.0
    c_max = np.percentile(cut_arr, 95) or 1.0

    for w, m, c in zip(windows, motions_arr, cut_arr):
        w["motion"] = round(min(float(m) / m_max, 1.0), 3)
        w["cut_density"] = round(min(float(c) / c_max, 1.0), 3)


# ---------------------------------------------------------------------------
# Audio: loudness + dynamics from the 16k mono wav
# ---------------------------------------------------------------------------

def window_audio_features(windows: list[dict], wav: Path) -> None:
    with wave.open(str(wav), "rb") as wf:
        fps_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    total = n_frames / fps_rate

    # RMS in 0.5s buckets.
    bucket = int(fps_rate * 0.5)
    n_buckets = max(len(samples) // bucket, 1)
    rms = np.sqrt(
        (samples[: n_buckets * bucket].reshape(n_buckets, bucket) ** 2).mean(axis=1)
    )

    louds, dyns = [], []
    for w in windows:
        a = int(w["start"] / 0.5)
        b = max(int(w["end"] / 0.5), a + 1)
        seg = rms[a:b]
        louds.append(float(seg.mean()) if len(seg) else 0.0)
        dyns.append(float(seg.std()) if len(seg) else 0.0)

    loud_arr = np.array(louds)
    dyn_arr = np.array(dyns)
    l_ref = np.percentile(loud_arr, 95) or 1.0
    d_ref = np.percentile(dyn_arr, 95) or 1.0

    for w, l, d in zip(windows, loud_arr, dyn_arr):
        w["loudness"] = round(min(float(l) / l_ref, 1.0), 3)
        w["dynamics"] = round(min(float(d) / d_ref, 1.0), 3)


def analyze(
    windows: list[dict],
    wav: Path,
    analysis_video: Path | None,
    total_duration: float,
) -> None:
    """Attach all cheap energy features to windows in place."""
    window_audio_features(windows, wav)
    if analysis_video and analysis_video.exists():
        try:
            diffs, _ = _keyframe_diffs(analysis_video)
            window_video_features(windows, diffs, total_duration)
        except Exception as exc:  # visual pass must never kill a job
            print(f"[energy] visual pass skipped: {exc}", flush=True)
            for w in windows:
                w.setdefault("motion", 0.0)
                w.setdefault("cut_density", 0.0)
    else:
        for w in windows:
            w["motion"] = 0.0
            w["cut_density"] = 0.0
