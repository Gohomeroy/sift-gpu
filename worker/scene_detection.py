"""Scene detection for tighter candidate windows.

Uses PySceneDetect ContentDetector to find shot boundaries, then feeds
scene-aware windows into the pipeline. Each window's scene count becomes
a visual-energy signal for scoring.
"""

from __future__ import annotations

from typing import Any

import scenedetect
from scenedetect import ContentDetector, open_video


def detect_scenes(video_path: str) -> list[tuple[float, float]]:
    """Return list of (start_sec, end_sec) for each detected scene."""
    video = open_video(video_path)
    scene_manager = scenedetect.SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=15))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()
    return [(s.get_seconds(), e.get_seconds()) for s, e in scene_list]


def build_scene_windows(
    transcript_segments: list[dict[str, Any]],
    scenes: list[tuple[float, float]],
    min_dur: float = 18.0,
    max_dur: float = 62.0,
) -> list[dict[str, Any]]:
    """Build candidate windows anchored to scene boundaries.

    Instead of fixed sliding windows, we snap to scene cuts so each clip
    starts and ends on natural visual transitions.
    """
    if not scenes:
        return []

    windows: list[dict[str, Any]] = []

    for i, (scene_start, scene_end) in enumerate(scenes):
        # Accumulate scenes until we hit min_dur
        acc_start = scene_start
        acc_end = scene_end
        j = i + 1
        while j < len(scenes) and (scenes[j][1] - acc_start) < min_dur:
            acc_end = scenes[j][1]
            j += 1

        if (acc_end - acc_start) < min_dur:
            continue
        if (acc_end - acc_start) > max_dur:
            acc_end = acc_start + max_dur

        # Find transcript text that falls within this window
        text_parts = []
        for seg in transcript_segments:
            seg_start = float(seg.get("start", 0))
            seg_end = float(seg.get("end", 0))
            if seg_end > acc_start and seg_start < acc_end:
                text_parts.append(seg.get("text", ""))

        if not text_parts:
            continue

        windows.append({
            "start": round(max(0.0, acc_start), 2),
            "end": round(acc_end, 2),
            "text": " ".join(text_parts),
            "scene_count": j - i,
            "opens_after_pause": False,
            "sentence_count": len(text_parts),
        })

    return windows


def scene_count_in_window(scenes: list[tuple[float, float]], start: float, end: float) -> int:
    """Count how many scene transitions fall within a time range."""
    count = 0
    for s, e in scenes:
        if s >= start and s <= end:
            count += 1
    return count
