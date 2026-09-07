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
import memory
import poster
import reframe
import reframe_blur
import reframe_v2
import scene_detection
import score
import segment
import streamer_moment_detector as smd
import streamer_vl as svl
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
    reframe_style: str = "track",
    caption_layout: str = "center",
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
                "reframeStyle": reframe_style,
                "captionLayout": caption_layout,
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


def build_merged_windows(
    transcript: dict, scenes: list[tuple[float, float]]
) -> list[dict]:
    """Rebuild arc + scene-merged candidate windows (shared by fresh + cached)."""
    windows = segment.build_windows(transcript["segments"])
    if scenes:
        try:
            scene_windows = scene_detection.build_scene_windows(
                transcript["segments"], scenes
            )
            seen_starts = {round(w["start"], 1) for w in windows}
            for sw in scene_windows:
                key = round(sw["start"], 1)
                if key not in seen_starts:
                    windows.append(sw)
                    seen_starts.add(key)
            windows.sort(key=lambda w: w["start"])
        except Exception as exc:
            print(f"[main] scene-window rebuild failed: {exc}", flush=True)
    return windows


def memory_cache_windows(cached: dict, transcript: dict) -> list[dict]:
    """Rebuild candidate windows from a cached analysis payload."""
    windows = build_merged_windows(transcript, cached.get("scenes", []))
    if not windows:
        raise RuntimeError("No speech found in the source video.")
    return windows


def _overlap_ratio(a: dict, b: dict) -> float:
    ov = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    return ov / max(a["end"] - a["start"], 0.001)


def _default_style(job: dict) -> tuple[str, str, str, str, str]:
    """(style, font, sub, theme, reframe) from the job or defaults."""
    return (
        job.get("caption_style") or "pop",
        job.get("caption_font") or "anton",
        job.get("caption_sub") or "zoom",
        job.get("caption_theme") or "pop",
        (job.get("reframe_style") or "track").lower(),
    )


def streamer_pipeline(
    job: dict,
    full_video: Path,
    audio: Path,
    transcript: dict,
    scenes: list[tuple[float, float]],
    work_dir: Path,
    total_duration: float,
    org_id: str,
    src_key: str,
    clip_count: int,
) -> list[dict]:
    """Streamer content path: cheap event detection → Qwen3-VL two-pass →
    multi-dim scoring → memory-aware final selection.

    Returns picks shaped exactly like podcast-path picks so the shared
    cut/render/upload loop consumes them. Gracefully degrades to heuristic
    candidate selection when the VLM is unavailable or rejects everything.
    """
    job_id = job["id"]
    db.report_stage(job_id, "watching", 50)

    segments = transcript["segments"]

    # Cheap event detection → merged sequences → context-window candidates.
    sequences = smd.detect_events(
        audio,
        full_video,
        segments,
        scenes,
        total_duration,
    )
    candidates = smd.build_candidates(sequences, segments, total_duration)
    # Editor-validated windows for this exact source are forced back into the
    # pool so re-runs re-score them against the calibrated bar (golden_moments).
    if config.CLIP_MEMORY_ENABLED:
        try:
            import golden_moments

            goldens = golden_moments.candidate_overrides(src_key, segments, total_duration)
            if goldens:
                candidates = goldens + candidates
                print(
                    f"[streamer] +{len(goldens)} golden-reference candidates "
                    f"({[g.get('golden_name') for g in goldens]})",
                    flush=True,
                )
        except Exception as exc:
            print(f"[streamer] golden overrides skipped: {exc}", flush=True)
    print(
        f"[streamer] {len(sequences)} sequences → {len(candidates)} candidates",
        flush=True,
    )

    # Qwen3-VL two-pass deep analysis.
    analyzed = svl.analyze_candidates(
        candidates, full_video, work_dir, segments, total_duration
    )
    print(f"[streamer] {len(analyzed)} candidates analyzed by Qwen3-VL", flush=True)

    # Clip memory: never repeat a window this workspace already clipped.
    used: set[str] = set()
    if config.CLIP_MEMORY_ENABLED:
        try:
            for m in db.list_clip_memory(org_id, src_key):
                used.add(str(m.get("window_key", "")))
        except Exception as exc:
            print(f"[streamer] clip_memory lookup skipped: {exc}", flush=True)

    picks = svl.select_finals(analyzed, clip_count, total_duration, memory_used=used)

    # Fallback/top-up: no VLM / everything rejected / Qwen approved fewer than
    # requested → heuristic candidates fill the rest so a job always returns up
    # to clip_count clips even if the model is picky or hiccups.
    if len(picks) < clip_count:
        print(
            f"[streamer] {len(picks)} surviving analysis — topping up to {clip_count} "
            "with event-scored candidates",
            flush=True,
        )
        ordered = sorted(
            candidates, key=lambda c: c.get("initial_interest", 0), reverse=True
        )
        for cand in ordered:
            if len(picks) >= clip_count:
                break
            start = round(float(cand["start"]), 2)
            end = round(float(cand["end"]), 2)
            key = memory.window_key(start, end)
            if key in used:
                continue
            if any(_overlap_ratio(cand, p) > 0.55 for p in picks):
                continue
            cand["start"], cand["end"] = start, end
            cand["analysis"] = None
            cand["_composite"] = round(float(cand.get("initial_interest", 0)) * 100, 1)
            cand["_parts"] = {}
            cand["_verdict"] = "possible"
            cand.setdefault("text", smd._text_for_window(segments, start, end))
            picks.append(cand)

    style, font, sub, theme, reframe_style = _default_style(job)
    shaped: list[dict] = []
    for w in picks:
        cand = dict(w)
        start = float(cand["start"])
        end = float(cand["end"])
        analysis = cand.get("analysis") or {}
        composite = cand.get("_composite", 0.0)
        cand["start"] = round(start, 2)
        cand["end"] = round(end, 2)
        cand["text"] = smd._text_for_window(segments, start, end) or cand.get("text", "")
        cand["score01"] = round(min(composite / 100.0, 1.0), 3)
        cand["base_score"] = cand["score01"]
        cand["parts"] = cand.get("_parts") or {}
        cand["caption_style"] = style
        cand["caption_font"] = font
        cand["caption_sub"] = sub
        cand["caption_theme"] = theme
        cand["reframe_style"] = reframe_style
        cand["memory_kind"] = "window"
        # Bind Qwen verdict for title/caption/reasoning reuse downstream.
        cand["vl"] = {
            "hook": str(analysis.get("primary_category") or "moment"),
            "reasoning": str(analysis.get("summary") or "")[:300],
        }
        cand["moment"] = {
            "event_types": cand.get("event_types") or [],
            "signals": cand.get("signals") or {},
            "initial_interest": cand.get("initial_interest", 0),
            "analysis": analysis,
        }
        shaped.append(cand)

    # Observability (spec Part 18): persist the full candidate record so a bad
    # selection can be explained later.
    _dump_candidate_debug(work_dir, sequences, candidates, analyzed, shaped)
    return shaped


def _dump_candidate_debug(
    work_dir: Path,
    sequences: list[dict],
    candidates: list[dict],
    analyzed: list[dict],
    picks: list[dict],
) -> None:
    """Write streamer_candidates.json with the full decision trail."""
    import json

    try:
        work_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "sequences": sequences,
            "candidates": candidates,
            "analysis": analyzed,
            "picks": [
                {
                    "start": p.get("start"),
                    "end": p.get("end"),
                    "event_types": p.get("moment", {}).get("event_types", []),
                    "analysis": p.get("moment", {}).get("analysis"),
                    "initial_interest": p.get("moment", {}).get("initial_interest", 0),
                }
                for p in picks
            ],
        }
        (work_dir / "streamer_candidates.json").write_text(
            json.dumps(payload, default=str, indent=1), encoding="utf-8"
        )
    except Exception as exc:
        print(f"[streamer] debug dump skipped: {exc}", flush=True)


def podcast_pipeline(
    job: dict,
    windows: list[dict],
    transcript: dict,
    full_video: Path,
    work_dir: Path,
    total_duration: float,
    org_id: str,
    src_key: str,
    clip_count: int,
) -> list[dict]:
    """Legacy hook→question→payoff path: score → VL discovery → ARC rule →
    watch finalists → memory-aware picking → hook snap. Returns picks shaped
    exactly like streamer_pipeline's so the shared cut loop consumes both."""
    job_id = job["id"]

    # 7 · Score every window (text + visual energy + optional centroids)
    db.report_stage(job_id, "scoring", 46)
    ranked = score.score_windows(windows)

    # 8 · VL discovery sweep — watch the WHOLE video coarsely so visually-hot
    #     moments the transcript missed can still become clips.
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
    discover_slots = max(1, min(len(discoveries), clip_count // 3))
    if discoveries:
        ranked = vl.merge_discoveries(
            discoveries, ranked, transcript["segments"], discover_slots
        )

    # 9b · ARC RULE — every clip must be a complete hook → question → payoff.
    db.report_stage(job_id, "segmenting", 50)
    arc_ranked: list[dict] = []
    for w in ranked:
        arc = segment.ensure_arc(w, transcript["segments"])
        if arc is not None:
            arc_ranked.append(arc)

    # 10 · Pick the top N arc-valid candidates, skipping overlaps.
    finalists: list[dict] = []
    for w in arc_ranked:
        if not any(_overlap_ratio(w, d) > 0.50 for d in finalists):
            finalists.append(w)
        if len(finalists) >= clip_count + discover_slots:
            break

    # 11 · Qwen3-VL watches every finalist.
    db.report_stage(job_id, "watching", 58)
    finalists = vl.watch_finalists(full_video, finalists, [], full_video, work_dir)

    # 10 · Dedup finalists.
    deduped: list[dict] = []
    for w in finalists:
        if not any(_overlap_ratio(w, d) > 0.50 for d in deduped):
            deduped.append(w)
    ranked_picks = deduped[: max(clip_count, 10)]

    # 10c · MEMORY-AWARE PICKING.
    base_style = job.get("caption_style") or "pop"
    base_font = job.get("caption_font") or "anton"
    base_sub = job.get("caption_sub") or "zoom"
    base_theme = job.get("caption_theme") or "pop"
    base_reframe = (job.get("reframe_style") or "track").lower()
    if config.CLIP_MEMORY_ENABLED:
        picks = memory.pick_variations(
            ranked_picks, clip_count, org_id, src_key,
            base_style, base_font, base_sub, base_theme, base_reframe,
        )
    else:
        picks = ranked_picks[:clip_count]
        for w in picks:
            w.setdefault("memory_kind", "window")

    # Supercuts (combos) may have extended ends past the source — clamp.
    for w in picks:
        if float(w["end"]) > total_duration:
            w["end"] = round(total_duration, 2)
        w.setdefault("caption_style", base_style)
        w.setdefault("caption_font", base_font)
        w.setdefault("caption_sub", base_sub)
        w.setdefault("caption_theme", base_theme)
        w.setdefault("reframe_style", base_reframe)

    # 10b · Hook rule — every clip must open on a hook in the first 1-3s.
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
    return picks


def process_job(job: dict) -> None:
    job_id = job["id"]
    org_id = job["organization_id"]
    clip_count = max(1, min(10, int(job.get("clip_count", 3))))
    work_dir = config.WORK_DIR / job_id
    src_key = memory.source_key(job["source_url"])

    # Clean stale work directory from prior failed runs.
    import shutil
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    # 1 · Single full-video download (≤1080p) — ONE YouTube hit per job.
    #    YouTube tags datacenter IPs after a couple requests, so the old
    #    audio+analysis+sections download storm kept getting bot-walled.
    #    CACHE HIT: if this source was already analyzed, skip the download
    #    + transcription entirely and reuse the prior transcript/windows.
    cached = memory.load_analysis(src_key) if config.CLIP_MEMORY_ENABLED else None
    using_cache = cached is not None and memory.cached_video_available(src_key)

    if using_cache:
        print(f"[main] cache hit for {src_key} — reusing analysis", flush=True)
        db.report_stage(job_id, "downloading", 12)
        full_video = memory.video_path(src_key)
        audio = memory.audio_path(src_key)
        transcript = cached["transcript"]
        scenes = cached.get("scenes", [])
        windows = memory_cache_windows(cached, transcript)
    else:
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

        # 4-5 · Candidate windows (arc + scene-merged)
        db.report_stage(job_id, "segmenting", 32)
        scenes: list[tuple[float, float]] = []
        try:
            scenes = scene_detection.detect_scenes(full_video)
            print(f"[main] detected {len(scenes)} scenes", flush=True)
        except Exception as exc:
            print(f"[main] scene detection failed: {exc}", flush=True)
        windows = build_merged_windows(transcript, scenes)

        # Persist the expensive analysis for future re-submits.
        if config.CLIP_MEMORY_ENABLED:
            try:
                total_dur = float(windows[-1]["end"]) if windows else 0.0
                memory.save_analysis(src_key, transcript, scenes, total_dur)
                memory.ensure_cached_media(src_key, full_video, audio)
            except Exception as exc:
                print(f"[main] analysis cache write failed: {exc}", flush=True)

    if not windows:
        raise RuntimeError("No speech found in the source video.")

    # 6 · Cheap energy analysis over the WHOLE video (visual senses).
    total_duration = float(windows[-1]["end"])
    db.report_stage(job_id, "analyzing", 38)
    energy.analyze(windows, audio, full_video, total_duration)

    # Branch on content type — streamer = event-driven Qwen3-VL moments,
    # anything else keeps the legacy hook→question→payoff arc pipeline.
    content_type = (job.get("content_type") or "auto").lower()
    if config.STREAMER_MODE or content_type == "streamer":
        picks = streamer_pipeline(
            job, full_video, audio, transcript, scenes, work_dir,
            total_duration, org_id, src_key, clip_count,
        )
    else:
        picks = podcast_pipeline(
            job, windows, transcript, full_video, work_dir,
            total_duration, org_id, src_key, clip_count,
        )
    total_picks = len(picks)

    # 13 · Cut each final pick straight from the local full video.
    #       (No per-section downloads — that's a second YouTube hit per clip.)
    #       Clips are cut+rendered CONCURRENTLY (2 workers) — the GPU pod
    #       has headroom, and serial JSON/Remotion renders were the long pole
    #       (5 clips took ~8min of wall time in rendering alone).
    db.report_stage(job_id, "cutting", 60)

    def process_one(i: int, w: dict) -> None:
        stage_pct = 66 + int((i / max(total_picks, 1)) * 30)
        db.report_stage(job_id, "cutting", stage_pct)

        # Per-window style overrides (from memory variation picking).
        style = w.get("caption_style") or job.get("caption_style") or "pop"
        font = w.get("caption_font") or job.get("caption_font") or "anton"
        sub = w.get("caption_sub") or job.get("caption_sub") or "zoom"
        theme = w.get("caption_theme") or job.get("caption_theme") or "pop"
        window_reframe = (
            w.get("reframe_style") or job.get("reframe_style") or "track"
        ).lower()
        raw_cut = work_dir / f"clip_{i}_raw.mp4"

        # Reframe engine follows the WINDOW choice so combos of mixed styles
        # (track + blur cuts) each get their own framing.
        if window_reframe == "blur":
            mod = reframe_blur
        elif config.REFRAME_ENGINE == "v2":
            mod = reframe_v2
        else:
            mod = reframe
        fn = mod.cut_and_reframe_v2 if hasattr(mod, "cut_and_reframe_v2") else mod.cut_and_reframe

        fn(full_video, float(w["start"]), float(w["end"]), raw_cut)

        title = titles.make_title(w)
        cues = captions_mod.build_cues(transcript["words"], float(w["start"]), float(w["end"]))

        db.report_stage(job_id, "rendering", min(stage_pct + 4, 95))
        # Use the actual cut duration, not the window duration, to avoid dark padding.
        actual_duration = mod.get_video_duration(raw_cut)
        duration = actual_duration if actual_duration > 0 else float(w["end"]) - float(w["start"])
        # Blur-mode landscape cuts center a 16:9 foreground on a 1080x1920
        # canvas; captions sit smaller, in the blurred band right below the
        # footage. Portrait sources are full-bleed so they keep the centered layout.
        caption_layout = "center"
        if window_reframe == "blur":
            is_portrait = False
            try:
                import cv2

                cap = cv2.VideoCapture(str(full_video))
                fw = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
                fh = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
                cap.release()
                if fw and fh:
                    is_portrait = fh >= fw * 16.0 / 9.0 - 1  # ≈9:16 or taller
            except Exception:
                pass
            # Landscape sources get blurred bands top/bottom → captions live in
            # the bottom band right below the footage. Portrait = full-bleed,
            # keep the centered layout.
            if not is_portrait:
                caption_layout = "below_feed"
        captioned = render_captions(
            raw_cut, cues, title, style, duration,
            font, sub, theme, window_reframe, caption_layout,
        )

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
        rec = (w.get("moment") or {}).get("analysis")
        if rec:
            try:
                import json as _json
                reasoning = ((reasoning + " | ") if reasoning else "") + _json.dumps(
                    rec, default=str
                )[:1500]
            except Exception:
                pass

        path = db.upload_clip(org_id, job_id, str(final))
        clip_row = db.insert_clip(
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
                "reframe_style": window_reframe,
                "storage_path": path,
                "caption": caption_text,
                "hashtags": tags,
                "reasoning": reasoning,
                "provider": "local",
            }
        )
        # Remember this clip decision so the next job on the same source
        # picks fresh windows / other styles instead of repeating it.
        if config.CLIP_MEMORY_ENABLED:
            try:
                clip_id = (clip_row or {}).get("id")
                for seg in [w] + list(w.get("extra_segments") or []):
                    db.insert_clip_memory(
                        {
                            "organization_id": org_id,
                            "source_key": src_key,
                            "window_key": memory.window_key(
                                float(seg["start"]), float(seg["end"])
                            ),
                            "kind": (
                                "combo" if w.get("extra_segments") else w.get("memory_kind", "window")
                            ),
                            "style_sig": memory.style_sig(style, font, sub, theme, window_reframe),
                            "start_seconds": seg["start"],
                            "end_seconds": seg["end"],
                            "clip_id": clip_id,
                        }
                    )
            except Exception as exc:
                print(f"[main] clip memory write skipped: {exc}", flush=True)
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
