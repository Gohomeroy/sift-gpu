"""Stage 6: cut + face-tracked vertical reframe.

Samples faces at ~2fps with OpenCV's Haar cascade, builds a smoothed moving
crop window that follows the dominant speaker, and cuts a 1080x1920 h264+aac
vertical clip. Falls back to center-crop when faces are rarely detected.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2
import numpy as np

SAMPLE_FPS = 2.0
OUT_W, OUT_H = 1080, 1920

YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)

_face_detector = None


def _get_detector(frame_w: int, frame_h: int):
    """YuNet face detector (OpenCV 5 removed Haar cascades)."""
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


def track_crop_centers(video: Path, start: float, end: float) -> np.ndarray | None:
    """Smoothed per-sample x-centers for the crop window, or None if unusable."""
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, int(round(fps / SAMPLE_FPS)))

    cap.set(cv2.CAP_PROP_POS_FRAMES, int(start * fps))
    stamps: list[float] = []  # seconds since window start
    centers: list[float] = []

    while True:
        ok, frame = cap.read()
        t_rel = len(stamps) * step / fps
        if not ok or t_rel > (end - start):
            break
        faces = _detect_faces(frame)
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            centers.append(float(x + fw / 2))
        else:
            centers.append(np.nan)
        stamps.append(t_rel)
        for _ in range(step - 1):
            if not cap.read()[0]:
                break
    cap.release()

    arr = np.array(centers, dtype=float)
    valid = arr[~np.isnan(arr)]
    # Need enough face evidence to trust tracking.
    if len(valid) < max(4, int(len(arr) * 0.15)):
        return None

    arr[np.isnan(arr)] = np.mean(valid)
    kernel = max(3, (len(arr) // 6) | 1)
    pad = np.pad(arr, (kernel // 2, kernel // 2), mode="edge")
    smooth = np.convolve(pad, np.ones(kernel) / kernel, mode="valid")
    return smooth[: len(arr)]


def cut_and_reframe(video: Path, start: float, end: float, out_path: Path) -> Path:
    duration = end - start
    centers = track_crop_centers(video, start, end)

    audio_args = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"]

    if centers is None:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(video),
                "-vf", "crop=w=608:h=ih:x='(iw-608)/2':y=0,scale=1080:1920",
                "-r", "30",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                *audio_args,
                str(out_path),
            ],
            capture_output=True, timeout=60 * 30, check=True,
        )
        return out_path

    # --- Face-tracked pass (three robust steps, no filter-graph tricks) ---
    seg_path = out_path.parent / (out_path.stem + "_seg.mp4")
    silent_path = out_path.parent / (out_path.stem + "_silent.mp4")

    # 1) Wide cut of the segment.
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
         "-i", str(video), "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "18", "-an", str(seg_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 2) Moving-crop to vertical in OpenCV.
    cap = cv2.VideoCapture(str(seg_path))
    fps_in = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Map per-frame time -> interpolated crop center.
    n_centers = len(centers)
    xs = np.interp(
        np.arange(total) / fps_in,
        np.linspace(0, duration, num=n_centers),
        centers,
    )
    crop_w = 608
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
        x0 = int(max(0, min(c - crop_w / 2, frame.shape[1] - crop_w)))
        crop = frame[:, x0 : x0 + crop_w]
        writer.write(cv2.resize(crop, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA))
        i += 1
    cap.release()
    writer.release()

    if i == 0:
        raise RuntimeError("tracked reframe produced no frames")

    # 3) Mux the segment's audio under the reframed video.
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(silent_path), "-i", str(seg_path),
         "-map", "0:v:0", "-map", "1:a:0?",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         *audio_args,
         str(out_path)],
        capture_output=True, text=True, timeout=60 * 30,
    )
    seg_path.unlink(missing_ok=True)
    silent_path.unlink(missing_ok=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError(f"mux failed: {proc.stderr[-300:]}")
    return out_path
