"""SIFT clip worker — claims queued jobs and runs the local pipeline.

Pipeline: download → transcribe → segment → score → (VL discover) → (VL watch)
→ cut+reframe → render captions → upload. Stages stream to clip_jobs.stage/progress
so the app shows live status. Also handles social posting: polls for queued
clip_posts and uploads clips to TikTok/YouTube/Instagram.

Run: python main.py  (from sift/worker/)
"""

from __future__ import annotations

import os
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import config
import captions as captions_mod
import energy
import hooks
import ingest
import poster
import reframe
import reframe_v2
import scene_detection
import score
import segment
import supabase_client as db
import titles
import transcribe
import vl


def render_captions(
    clip_path: Path,
    cues: list[dict],
    title: str,
    style: str,
    duration: float,
    font: str = "anton",
    sub: str = "zoom",
    theme: str = "pop",
) -> Path:
    """Ask the Remotion render server to burn captions; falls back to ffmpeg drawtext, then raw cut."""
    import json
    import requests

    # Try Remotion server first.
    try:
        resp = requests.post(
            f"{config.RENDER_SERVER_URL}/render",
            json={
                "videoPath": str(clip_path),
                "cues": cues,
                "title": title,
                "captionStyle": style,
                "captionFont": font,
                "captionSub": sub,
                "captionTheme": theme,
                "durationSeconds": duration,
                "outName": f"{clip_path.parent.name}_{clip_path.stem}",
            },
            timeout=60 * 15,
        )
        resp.raise_for_status()
        out = Path(resp.json()["outputPath"])
        if out.exists() and out.stat().st_size > 1000:
            return out
    except Exception:
        pass

    # Fallback: ffmpeg drawtext captions (simpler but functional).
    if cues:
        try:
            captioned = clip_path.parent / (clip_path.stem + "_captioned.mp4")
            _ffmpeg_captions(clip_path, cues, captioned)
            if captioned.exists() and captioned.stat().st_size > 1000:
                return captioned
        except Exception:
            pass

    return clip_path  # raw vertical cut is still a valid deliverable


def _ffmpeg_captions(clip_path: Path, cues: list[dict], out_path: Path) -> None:
    """Burn captions onto video using ffmpeg drawtext filter."""
    import subprocess

    # Build a drawtext filter chain — show each cue as white text with black outline.
    filters = []
    for cue in cues:
        text = " ".join(w.get("text", "") for w in cue.get("words", []))
        if not text:
            continue
        start = cue.get("start", 0)
        end = cue.get("end", 0)
        # Escape special characters for ffmpeg drawtext.
        safe = text.replace("'", "'\\''").replace(":", "\\:")
        filters.append(
            f"drawtext=text='{safe}':fontsize=42:fontcolor=white:"
            f"borderw=3:bordercolor=black:"
            f"x=(w-text_w)/2:y=h-h/6:"
            f"enable='between(t,{start:.2f},{end:.2f})'"
        )

    if not filters:
        return

    vf = ",".join(filters)
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(clip_path),
            "-vf", vf,
            *reframe._enc_args(),
            "-c:a", "copy",
            str(out_path),
        ],
        capture_output=True, timeout=60 * 10, check=True,
    )


def process_job(job: dict) -> None:
    job_id = job["id"]
    org_id = job["organization_id"]
    clip_count = max(1, min(10, int(job.get("clip_count", 3))))
    work_dir = config.WORK_DIR / job_id

    # Clean stale work directory from prior failed runs.
    import shutil
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    # 1 · Single full-video download (≤1080p) — ONE YouTube hit per job.
    #    YouTube tags datacenter IPs after a couple requests, so the old
    #    audio+analysis+sections download storm kept getting bot-walled.
    db.report_stage(job_id, "downloading", 4)
    full_video = ingest.download_full_video(job["source_url"], job_id)
    db.report_stage(job_id, "downloading", 12)

    # 2 · Extract audio from the full video → wav
    audio = ingest.extract_audio(full_video)

    # 3 · Transcribe from audio alone (streams real progress — long videos
    #     take ~4-6x realtime on CPU, so the UI must see it moving)
    db.report_stage(job_id, "transcribing", 16)
    _last_tx = {"t": 0.0}

    def tx_progress(frac: float) -> None:
        import time as _time

        now = _time.time()
        if now - _last_tx["t"] >= 4:  # max one write per 4s
            _last_tx["t"] = now
            db.report_stage(job_id, "transcribing", 16 + int(frac * 14))

    transcript = transcribe.transcribe(str(audio), on_progress=tx_progress)

    # 4 · Candidate windows from transcript
    db.report_stage(job_id, "segmenting", 32)
    windows = segment.build_windows(transcript["segments"])
    if not windows:
        raise RuntimeError("No speech found in the source video.")

    # 5 · Scene-aware windows from PySceneDetect (merges with transcript windows).
    scenes: list[tuple[float, float]] = []
    try:
        scenes = scene_detection.detect_scenes(full_video)
        print(f"[main] detected {len(scenes)} scenes", flush=True)
        scene_windows = scene_detection.build_scene_windows(
            transcript["segments"], scenes
        )
        # Merge: keep unique windows (by start time) favoring scene windows
        # when they align with transcript content.
        seen_starts = {round(w["start"], 1) for w in windows}
        for sw in scene_windows:
            key = round(sw["start"], 1)
            if key not in seen_starts:
                windows.append(sw)
                seen_starts.add(key)
        windows.sort(key=lambda w: w["start"])
    except Exception as exc:
        print(f"[main] scene detection failed: {exc}", flush=True)

    # 6 · Cheap energy analysis over the WHOLE video (visual senses).
    total_duration = float(windows[-1]["end"])
    db.report_stage(job_id, "analyzing", 38)
    energy.analyze(windows, audio, full_video, total_duration)

    # 7 · Score every window (text + visual energy + optional centroids)
    db.report_stage(job_id, "scoring", 46)
    ranked = score.score_windows(windows)

    # 8 · VL discovery sweep — watch the WHOLE video coarsely so visually-hot
    #     moments the transcript missed can still become clips.
    #     Skip if transcript already found strong candidates (score > 0.70)
    #     to save ~2-3 min of VL inference.
    discoveries: list[dict] = []
    top_score = ranked[0]["score01"] if ranked else 0
    skip_discovery = top_score >= 0.70
    if skip_discovery:
        print(f"[main] skipping VL discovery — top transcript score {top_score:.2f} >= 0.70", flush=True)
    elif vl.available():
        db.report_stage(job_id, "watching", 48)
        try:
            discoveries = vl.discover(full_video, total_duration, work_dir)
            print(f"[main] VL discovered {len(discoveries)} candidate ranges", flush=True)
        except Exception as exc:
            print(f"[main] VL discovery failed: {exc}", flush=True)
            discoveries = []

    # 9 · Merge discoveries into the ranked pool.
    #     Reserve 30% of clip_count slots for VL discoveries (at least 1).
    discover_slots = max(1, min(len(discoveries), clip_count // 3))
    if discoveries:
        ranked = vl.merge_discoveries(
            discoveries, ranked, transcript["segments"], discover_slots
        )

    # 10 · Pick the top N as finalists.
    finalists = ranked[: clip_count + discover_slots]

    # 11 · Qwen2.5-VL watches every finalist (both transcript-picked + discovered)
    db.report_stage(job_id, "watching", 58)
    finalists = vl.watch_finalists(full_video, finalists, [], full_video, work_dir)

    # 10 · Dedup finalists: if two windows overlap >50%, keep the higher-scored one.
    def _overlap(a, b):
        ov = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
        return ov / max(a["end"] - a["start"], 0.001)

    deduped: list[dict] = []
    for w in finalists:
        if not any(_overlap(w, d) > 0.50 for d in deduped):
            deduped.append(w)
    picks = deduped[:clip_count]

    # 10b · Hook rule — every clip must open on a hook in the first 1-3s.
    #        Arc windows already start at the hook; this snaps any leftover
    #        candidate (VL discovery, scene windows) to a hook sentence start.
    for w in picks:
        try:
            snapped = segment.snap_start_to_hook(w, transcript["segments"])
            if snapped is not None and abs(snapped - float(w["start"])) > 0.01:
                w["start"] = snapped
                w["text"] = " ".join(
                    seg["text"]
                    for seg in transcript["segments"]
                    if float(seg["start"]) >= snapped
                    and float(seg["end"]) <= float(w["end"])
                ).strip()
        except Exception as exc:
            print(f"[main] hook snap skipped for {w.get('start')}: {exc}", flush=True)
    total_picks = len(picks)

    # 13 · Cut each final pick straight from the local full video.
    #       (No per-section downloads — that's a second YouTube hit per clip.)
    #       Clips are cut+rendered CONCURRENTLY (2 workers) — the GPU pod
    #       has headroom, and serial JSON/Remotion renders were the long pole
    #       (5 clips took ~8min of wall time in rendering alone).
    db.report_stage(job_id, "cutting", 60)

    reframe_fn = reframe_v2.cut_and_reframe_v2 if config.REFRAME_ENGINE == "v2" else reframe.cut_and_reframe

    def process_one(i: int, w: dict) -> None:
        stage_pct = 66 + int((i / max(total_picks, 1)) * 30)
        db.report_stage(job_id, "cutting", stage_pct)

        style = job.get("caption_style") or "pop"
        font = job.get("caption_font") or "anton"
        sub = job.get("caption_sub") or "zoom"
        theme = job.get("caption_theme") or "pop"
        raw_cut = work_dir / f"clip_{i}_raw.mp4"

        reframe_fn(full_video, float(w["start"]), float(w["end"]), raw_cut)

        title = titles.make_title(w)
        cues = captions_mod.build_cues(transcript["words"], float(w["start"]), float(w["end"]))

        db.report_stage(job_id, "rendering", min(stage_pct + 4, 95))
        # Use the actual cut duration, not the window duration, to avoid dark padding.
        duration_mod = reframe_v2 if config.REFRAME_ENGINE == "v2" else reframe
        actual_duration = duration_mod.get_video_duration(raw_cut)
        duration = actual_duration if actual_duration > 0 else float(w["end"]) - float(w["start"])
        captioned = render_captions(raw_cut, cues, title, style, duration, font, sub, theme)

        if config.HOOKS_ENABLED:
            # Hook text overlay — punchy headline burned onto the clip.
            hook_path = work_dir / f"clip_{i}_hooked.mp4"
            final = hooks.add_hook_to_video(
                captioned, title, hook_path,
                style=config.HOOK_STYLE,
                position=config.HOOK_POSITION,
                duration=min(config.HOOK_DURATION, duration),
            )
        else:
            final = captioned

        caption_text, tags = titles.make_caption_and_tags(w, w.get("vl"))
        reasoning = None
        if w.get("vl"):
            reasoning = f"{w['vl'].get('hook', '')}: {w['vl'].get('reasoning', '')}".strip(": ")

        path = db.upload_clip(org_id, job_id, str(final))
        db.insert_clip(
            {
                "job_id": job_id,
                "organization_id": org_id,
                "title": title,
                "start_seconds": w["start"],
                "end_seconds": w["end"],
                "viral_score": score.to_percent(w["score01"]),
                "caption_style": style,
                "caption_font": font,
                "caption_sub": sub,
                "caption_theme": theme,
                "storage_path": path,
                "caption": caption_text,
                "hashtags": tags,
                "reasoning": reasoning,
                "provider": "local",
            }
        )
        print(f"[main] clip {i} done @ {round(duration, 1)}s", flush=True)

    max_workers = max(1, int(os.environ.get("CLIP_PARALLELISM", "2")))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(process_one, i, w) for i, w in enumerate(picks)]
        for fut in futures:
            fut.result()  # re-raise the first failure so the job is marked failed

    db.complete_job(job_id)


def cleanup_job_dir(job_id: str) -> None:
    """Keep disk sane after completion."""
    import shutil

    d = config.WORK_DIR / job_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def process_post(post: dict) -> None:
    """Download a clip and post it to the specified social platform."""
    post_id = post["id"]
    clip_data = post.get("clip", {})
    storage_path = clip_data.get("storage_path", "")

    if not storage_path:
        db.update_post_status(post_id, "failed", error="No storage path for clip")
        return

    # Download clip to temp dir.
    post_dir = config.WORK_DIR / f"post_{post_id[:8]}"
    post_dir.mkdir(parents=True, exist_ok=True)

    clip_path = db.download_clip_for_posting(storage_path, post_dir)
    if not clip_path or not clip_path.exists():
        db.update_post_status(post_id, "failed", error="Could not download clip")
        return

    # Post to platform.
    result = poster.post_clip(post, clip_path)

    if result.get("ok"):
        db.update_post_status(
            post_id,
            "posted",
            platform_post_id=result.get("post_id"),
            platform_url=result.get("url"),
        )
        print(f"[poster] posted {post_id} → {result.get('url', 'ok')}", flush=True)
    else:
        db.update_post_status(post_id, "failed", error=result.get("error", "unknown"))
        print(f"[poster] failed {post_id}: {result.get('error')}", flush=True)

    # Cleanup temp files.
    import shutil
    if post_dir.exists():
        shutil.rmtree(post_dir, ignore_errors=True)


def posting_loop() -> None:
    """Continuously poll for and process queued social posts."""
    if not config.POSTING_ENABLED:
        return

    print(f"[poster] posting enabled, polling every {config.POST_POLL_INTERVAL}s")
    warned = False
    while True:
        post = None
        try:
            post = db.claim_next_post()
            warned = False  # reset once we get a clean query
        except Exception as exc:
            err_str = str(exc).lower()
            if not warned:
                if "clip_posts" in err_str or "pgrst205" in err_str:
                    print("[poster] clip_posts table not found — social posting disabled until migration 0026 is applied")
                else:
                    traceback.print_exc()
                warned = True

        if not post:
            time.sleep(config.POST_POLL_INTERVAL)
            continue

        print(f"[poster] claimed post {post['id']} → {post.get('platform')}")
        try:
            process_post(post)
        except Exception as exc:
            traceback.print_exc()
            try:
                db.update_post_status(post["id"], "failed", error=f"{type(exc).__name__}: {exc}")
            except Exception:
                pass


def main() -> None:
    import threading

    config.WORK_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[sift-worker] polling every {config.POLL_INTERVAL_SECONDS}s …")

    # Start posting loop in a background thread.
    if config.POSTING_ENABLED:
        poster_thread = threading.Thread(target=posting_loop, daemon=True)
        poster_thread.start()

    while True:
        job = None
        try:
            job = db.claim_next_job()
        except Exception:
            traceback.print_exc()

        if not job:
            time.sleep(config.POLL_INTERVAL_SECONDS)
            continue

        print(f"[sift-worker] claimed {job['id']} — {job.get('title', '')}")
        try:
            process_job(job)
            cleanup_job_dir(job["id"])
            print(f"[sift-worker] completed {job['id']}")
        except Exception as exc:
            traceback.print_exc()
            try:
                db.fail_job(job["id"], f"{type(exc).__name__}: {exc}")
            except Exception:
                pass


if __name__ == "__main__":
    main()
