"""Stage 6: cut + face-tracked vertical reframe.

Samples faces at ~2fps with YuNet, builds a smoothed moving crop window that
follows the active speaker, and cuts a 1080x1920 h264+aac vertical clip.
Falls back to center-crop when faces are rarely detected.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2
import numpy as np

SAMPLE_FPS = 2.0
OUT_W, OUT_H = 1080, 1920
# Correct crop width for 9:16 from any source: height * (9/16)
CROP_W = int(OUT_H * 9 / 16)  # 1080

YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)

_face_detector = None


def _get_detector(frame_w: int, frame_h: int):
    """YuNet face detector."""
    global _face_detector
    if _face_detector is None:
        models_dir = Path(__file__).resolve().parent / "models"
        models_dir.mkdir(exist_ok=True)
        model_path = models_dir / "face_detection_yunet_2023mar.onnx"
        if not model_path.exists():
            import urllib.request

            print("[reframe] downloading YuNet face model…", flush=True)
            urllib.request.urlretrieve(YUNET_URL, model_path)
        _face_detector = cv2.FaceDetectorYN.create(
            str(model_path), "", (frame_w, frame_h), score_threshold=0.6
        )
    _face_detector.setInputSize((frame_w, frame_h))
    return _face_detector


def _detect_faces(frame):
    h, w = frame.shape[:2]
    detector = _get_detector(w, h)
    _, faces = detector.detect(frame)
    if faces is None:
        return []
    # rows: [x, y, w, h, landmarks..., score]
    return [(int(f[0]), int(f[1]), int(f[2]), int(f[3])) for f in faces]


def _pick_active_speaker(faces, prev_center: float | None) -> tuple[int, int, int, int]:
    """Pick the face most likely to be the active speaker.

    Strategy: if a previous center exists, prefer the face closest to it
    (continuity — speakers don't teleport).  Otherwise pick the largest face.
    """
    if not faces:
        return (0, 0, 0, 0)
    if len(faces) == 1:
        return faces[0]
    if prev_center is not None:
        # Pick face whose center is closest to previous crop center.
        return min(
            faces,
            key=lambda f: abs((f[0] + f[2] / 2) - prev_center),
        )
    # Fallback: largest face area.
    return max(faces, key=lambda f: f[2] * f[3])


def track_crop_centers(video: Path, start: float, end: float) -> np.ndarray | None:
    """Smoothed per-sample x-centers for the crop window, or None if unusable."""
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, int(round(fps / SAMPLE_FPS)))

    cap.set(cv2.CAP_PROP_POS_FRAMES, int(start * fps))
    stamps: list[float] = []
    centers: list[float] = []
    prev_center: float | None = None

    while True:
        ok, frame = cap.read()
        t_rel = len(stamps) * step / fps
        if not ok or t_rel > (end - start):
            break
        faces = _detect_faces(frame)
        if faces:
            x, y, fw, fh = _pick_active_speaker(faces, prev_center)
            cx = float(x + fw / 2)
            centers.append(cx)
            prev_center = cx
        else:
            centers.append(np.nan)
            # Don't reset prev_center — keep tracking through brief occlusions.
        stamps.append(t_rel)
        for _ in range(step - 1):
            if not cap.read()[0]:
                break
    cap.release()

    arr = np.array(centers, dtype=float)
    valid = arr[~np.isnan(arr)]
    if len(valid) < max(4, int(len(arr) * 0.15)):
        return None

    arr[np.isnan(arr)] = np.mean(valid)
    kernel = max(3, (len(arr) // 6) | 1)
    pad = np.pad(arr, (kernel // 2, kernel // 2), mode="edge")
    smooth = np.convolve(pad, np.ones(kernel) / kernel, mode="valid")
    return smooth[: len(arr)]


def get_video_duration(video: Path) -> float:
    """Probe actual duration of a video file."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
        capture_output=True, text=True, timeout=30,
    )
    try:
        return float(result.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def cut_and_reframe(video: Path, start: float, end: float, out_path: Path) -> Path:
    duration = end - start
    centers = track_crop_centers(video, start, end)

    audio_args = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"]
    vf_center = f"crop={CROP_W}:ih:x='(iw-{CROP_W})/2':y=0,scale={OUT_W}:{OUT_H}"

    if centers is None:
        # Fallback: crop to 9:16 from source height, then scale (no stretch).
        simple_crop = f"crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale={OUT_W}:{OUT_H}"
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(video),
                "-vf", simple_crop,
                "-r", "30",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                *audio_args,
                str(out_path),
            ],
            capture_output=True, timeout=60 * 30, check=True,
        )
        return out_path

    # --- Face-tracked pass (three robust steps) ---
    seg_path = out_path.parent / (out_path.stem + "_seg.mp4")
    audio_path = out_path.parent / (out_path.stem + "_audio.m4a")
    silent_path = out_path.parent / (out_path.stem + "_silent.mp4")

    # 1) Wide cut of the segment (with audio).
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
         "-i", str(video), "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "18", str(seg_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 1b) Extract audio separately so we always have it.
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(seg_path), "-vn",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
         str(audio_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 2) Moving-crop to vertical in OpenCV (video only).
    cap = cv2.VideoCapture(str(seg_path))
    fps_in = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    n_centers = len(centers)
    xs = np.interp(
        np.arange(total) / fps_in,
        np.linspace(0, duration, num=n_centers),
        centers,
    )

    writer = cv2.VideoWriter(
        str(silent_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps_in,
        (OUT_W, OUT_H),
    )
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        c = xs[min(i, len(xs) - 1)]
        x0 = int(max(0, min(c - CROP_W / 2, frame.shape[1] - CROP_W)))
        crop = frame[:, x0 : x0 + CROP_W]
        writer.write(cv2.resize(crop, (OUT_W, OUT_H), interpolation=cv2.INTER_LANCZOS4))
        i += 1
    cap.release()
    writer.release()

    if i == 0:
        raise RuntimeError("tracked reframe produced no frames")

    # 3) Mux the extracted audio under the reframed video.
    proc = subprocess.run(
        ["ffmpeg", "-y",
         "-i", str(silent_path), "-i", str(audio_path),
         "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         *audio_args,
         str(out_path)],
        capture_output=True, text=True, timeout=60 * 30,
    )
    seg_path.unlink(missing_ok=True)
    silent_path.unlink(missing_ok=True)
    audio_path.unlink(missing_ok=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError(f"mux failed: {proc.stderr[-300:]}")
    return out_path
