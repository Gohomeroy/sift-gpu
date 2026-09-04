"""Stage 6 v2: smart vertical reframe with MediaPipe + YOLOv8.

Upgrades from YuNet to:
- MediaPipe BlazeFace (fast, no model download)
- YOLOv8 person detection fallback
- SmoothedCameraman with safe zone + jump confirmation
- Scene cut snap for instant framing on new shots
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import cv2
import numpy as np

OUT_W, OUT_H = 1080, 1920
CROP_W = int(OUT_H * 9 / 16)  # 1080

_ENC = None


def _encoder() -> str:
    """Pick h264_nvenc (GPU) when available, else libx264 (CPU)."""
    global _ENC
    if _ENC is None:
        try:
            r = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True, text=True, timeout=15,
            )
            _ENC = "h264_nvenc" if "h264_nvenc" in r.stdout else "libx264"
        except Exception:
            _ENC = "libx264"
    return _ENC


def _enc_args():
    """ffmpeg video-codec args — hardware NVENC on GPU pods, libx264 fallback."""
    if _encoder() == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "21"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]

# Smoothing parameters (from OpenShorts SmoothedCameraman)
SAFE_ZONE_RATIO = 0.25  # camera only moves when subject leaves this zone
JUMP_CONFIRM_FRAMES = 3  # big moves must repeat N times before following
SCENE_CUT_SNAP_SPEED = 999  # instant snap on scene cut
SLOW_PAN_SPEED = 3  # px/frame for slow pan
FAST_PAN_SPEED = 15  # px/frame for >50% distance jumps

# Detection strides
MEDIAPIPE_STRIDE = 4  # detect every N frames
YOLO_FALLBACK_STRIDE = 8  # YOLO every N frames when no face


class SmoothedCameraman:
    """Heavy-tripod smoothing: safe zone, jump confirmation, scene cut snap."""

    def __init__(self, crop_w: int, frame_w: int):
        self.crop_w = crop_w
        self.frame_w = frame_w
        self.safe_zone = crop_w * SAFE_ZONE_RATIO
        self.target_x = frame_w / 2
        self.current_x = frame_w / 2
        self._pending_target = None
        self._pending_count = 0

    def begin_scene(self):
        """Reset damping for scene cut — instant snap to first face."""
        self.current_x = self.target_x
        self._pending_target = None
        self._pending_count = 0

    def update(self, face_cx: float) -> float:
        """Return the crop x-center after smoothing."""
        dist = face_cx - self.current_x

        # Inside safe zone — don't move
        if abs(dist) <= self.safe_zone:
            return self.current_x

        # Jump confirmation: big move must repeat
        if self._pending_target is not None and abs(face_cx - self._pending_target) < self.safe_zone:
            self._pending_count += 1
        else:
            self._pending_target = face_cx
            self._pending_count = 1

        if self._pending_count < JUMP_CONFIRM_FRAMES:
            return self.current_x

        # Confirmed move — pick speed
        max_dist = self.frame_w / 2
        ratio = abs(dist) / max_dist
        speed = FAST_PAN_SPEED if ratio > 0.5 else SLOW_PAN_SPEED

        step = max(1, min(int(abs(dist)), speed)) * (1 if dist > 0 else -1)
        self.current_x += step

        # Clamp
        half = self.crop_w / 2
        self.current_x = max(half, min(self.current_x, self.frame_w - half))
        self._pending_target = None
        self._pending_count = 0
        return self.current_x


def _detect_faces_mediapipe(frame):
    """Fast face detection via MediaPipe BlazeFace."""
    import mediapipe as mp

    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    with mp.solutions.face_detection.FaceDetection(
        model_selection=0, min_detection_confidence=0.5
    ) as fd:
        results = fd.process(rgb)

    if not results.detections:
        return []

    faces = []
    for det in results.detections:
        bb = det.location_data.relative_bounding_box
        x = int(bb.xmin * w)
        y = int(bb.ymin * h)
        bw = int(bb.width * w)
        bh = int(bb.height * h)
        faces.append((x, y, bw, bh))
    return faces


def _detect_person_yolo(frame, model):
    """Fallback: YOLOv8 person detection, approximate face as top 40%."""
    results = model(frame, classes=[0], verbose=False)
    faces = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            pw, ph = x2 - x1, y2 - y1
            if pw < 30 or ph < 50:
                continue
            # Approximate face as top 40% of person box
            faces.append((x1, y1, pw, int(ph * 0.4)))
    return faces


def _pick_active_speaker(faces, prev_center: float | None) -> tuple[int, int, int, int]:
    """Pick the face most likely to be the active speaker (continuity)."""
    if not faces:
        return (0, 0, 0, 0)
    if len(faces) == 1:
        return faces[0]
    if prev_center is not None:
        return min(faces, key=lambda f: abs((f[0] + f[2] / 2) - prev_center))
    return max(faces, key=lambda f: f[2] * f[3])


def track_crop_centers_v2(video: Path, start: float, end: float) -> np.ndarray | None:
    """Smoothed per-sample x-centers using MediaPipe + YOLOv8 fallback."""
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, int(round(fps / 2.0)))  # 2fps sampling

    cap.set(cv2.CAP_PROP_POS_FRAMES, int(start * fps))

    yolo_model = None
    cameraman = None
    centers: list[float] = []
    prev_center: float | None = None
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        t_rel = frame_idx * step / fps
        if not ok or t_rel > (end - start):
            break

        h, w = frame.shape[:2]
        if cameraman is None:
            cameraman = SmoothedCameraman(min(int(h * 9 / 16), w), w)

        faces = []

        # Primary: MediaPipe
        if frame_idx % MEDIAPIPE_STRIDE == 0:
            try:
                faces = _detect_faces_mediapipe(frame)
            except Exception:
                pass

        # Fallback: YOLOv8
        if not faces and frame_idx % YOLO_FALLBACK_STRIDE == 0:
            try:
                if yolo_model is None:
                    from ultralytics import YOLO
                    yolo_model = YOLO("yolov8n.pt")
                faces = _detect_person_yolo(frame, yolo_model)
            except Exception:
                pass

        if faces:
            x, y, fw, fh = _pick_active_speaker(faces, prev_center)
            cx = float(x + fw / 2)
            cameraman.update(cx)
            centers.append(cameraman.current_x)
            prev_center = cx
        else:
            centers.append(cameraman.current_x)

        frame_idx += 1
        for _ in range(step - 1):
            if not cap.read()[0]:
                break

    cap.release()

    arr = np.array(centers, dtype=float)
    if len(arr) < 4:
        return None

    # Light smoothing
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


def cut_and_reframe_v2(video: Path, start: float, end: float, out_path: Path) -> Path:
    """Cut + reframe using MediaPipe/YOLOv8 face tracking."""
    duration = end - start
    centers = track_crop_centers_v2(video, start, end)

    audio_args = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"]

    if centers is None:
        # Fallback: crop to 9:16 from source height, then scale (no stretch).
        simple_crop = f"crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale={OUT_W}:{OUT_H}"
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(video),
                "-vf", simple_crop,
                "-r", "30",
                *_enc_args(),
                *audio_args,
                str(out_path),
            ],
            capture_output=True, timeout=60 * 30, check=True,
        )
        return out_path

    # Source crop width that preserves a 9:16 frame (no stretch).
    probe = cv2.VideoCapture(str(video))
    src_h = int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1920
    src_w = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1080
    probe.release()
    crop_w = min(int(src_h * 9 / 16), src_w)

    # Face-tracked pass
    seg_path = out_path.parent / (out_path.stem + "_seg.mp4")
    audio_path = out_path.parent / (out_path.stem + "_audio.m4a")
    silent_path = out_path.parent / (out_path.stem + "_silent.mp4")

    # 1) Wide cut
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
         "-i", str(video), *_enc_args(),
         str(seg_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 1b) Extract audio
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(seg_path), "-vn",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
         str(audio_path)],
        capture_output=True, timeout=60 * 30, check=True,
    )

    # 2) Moving-crop in OpenCV (video only)
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
        x0 = int(max(0, min(c - crop_w / 2, frame.shape[1] - crop_w)))
        crop = frame[:, x0 : x0 + crop_w]
        writer.write(cv2.resize(crop, (OUT_W, OUT_H), interpolation=cv2.INTER_LANCZOS4))
        i += 1
    cap.release()
    writer.release()

    if i == 0:
        raise RuntimeError("v2 reframe produced no frames")

    # 3) Mux audio
    proc = subprocess.run(
        ["ffmpeg", "-y",
         "-i", str(silent_path), "-i", str(audio_path),
         "-map", "0:v:0", "-map", "1:a:0",
         *_enc_args(),
         *audio_args,
         str(out_path)],
        capture_output=True, text=True, timeout=60 * 30,
    )
    seg_path.unlink(missing_ok=True)
    silent_path.unlink(missing_ok=True)
    audio_path.unlink(missing_ok=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError(f"v2 mux failed: {proc.stderr[-300:]}")
    return out_path
