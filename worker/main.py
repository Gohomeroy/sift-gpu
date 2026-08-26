"""SIFT clip worker — claims queued jobs and runs the local pipeline.

Pipeline: download → transcribe → segment → score → (VL watch) → cut+reframe
→ render captions → upload. Stages stream to clip_jobs.stage/progress so the
app shows live status. Run: python main.py  (from sift/worker/)
"""

from __future__ import annotations

import time
import traceback
from pathlib import Path

import config
import captions as captions_mod
import energy
import ingest
import reframe
import score
import segment
import supabase_client as db
import titles
import transcribe
import vl


def render_captions(
    clip_path: Path, cues: list[dict], title: str, style: str, duration: float
) -> Path:
    """Ask the Remotion render server to burn captions; falls back to raw cut."""
    import requests

    try:
        resp = requests.post(
            f"{config.RENDER_SERVER_URL}/render",
            json={
                "videoPath": str(clip_path),
                "cues": cues,
                "title": title,
                "captionStyle": style,
                "durationSeconds": duration,
                "outName": clip_path.stem,
            },
            timeout=60 * 15,
        )
        resp.raise_for_status()
        out = Path(resp.json()["outputPath"])
        if out.exists():
            return out
    except Exception:
        pass
    return clip_path  # raw vertical cut is still a valid deliverable


def process_job(job: dict) -> None:
    job_id = job["id"]
    org_id = job["organization_id"]
    work_dir = config.WORK_DIR / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    # 1 · Audio-only download (small + fast) → wav
    db.report_stage(job_id, "downloading", 4)
    audio_media = ingest.download_audio(job["source_url"], job_id)
    db.report_stage(job_id, "downloading", 10)
    audio = ingest.extract_audio(audio_media)

    # 2 · Transcribe from audio alone
    db.report_stage(job_id, "transcribing", 16)
    transcript = transcribe.transcribe(str(audio))

    # 3 · Candidate windows
    db.report_stage(job_id, "segmenting", 32)
    windows = segment.build_windows(transcript["segments"])
    if not windows:
        raise RuntimeError("No speech found in the source video.")

    # 4 · Cheap energy analysis over the WHOLE video (visual senses) —
    #     worst-format download; keyframe-only decode keeps it fast.
    total_duration = float(windows[-1]["end"])
    analysis_video = None
    db.report_stage(job_id, "analyzing", 38)
    try:
        analysis_video = ingest.download_analysis_video(job["source_url"], job_id)
    except Exception as exc:
        print(f"[main] analysis video unavailable: {exc}", flush=True)
    energy.analyze(windows, audio, analysis_video, total_duration)

    # 5 · Score every window (text + visual energy + optional centroids)
    db.report_stage(job_id, "scoring", 46)
    ranked = score.score_windows(windows)
    finalists = ranked[: max(config.VL_TOP_N, 3)]

    # 6 · Download ONLY the finalist sections as video (VL + cuts share them)
    db.report_stage(job_id, "downloading", 52)
    sections = [(float(w["start"]), float(w["end"])) for w in finalists]
    section_files = ingest.download_sections(job["source_url"], job_id, sections)

    # Fallback: if sections failed wholesale, grab the full video once.
    full_video: Path | None = None
    if all(f is None for f in section_files):
        print("[main] section downloads failed — falling back to full video", flush=True)
        full_video = ingest.download_full_video(job["source_url"], job_id)

    # 7 · Qwen2.5-VL watches the finalists
    db.report_stage(job_id, "watching", 58)
    if vl.available():
        for i, w in enumerate(finalists):
            f = section_files[i] or full_video
            if f is None:
                w["vl"] = None
                continue
            v_start = 0.0 if section_files[i] else float(w["start"])
            v_end = (f and (v_start + float(w["end"]) - float(w["start"])))
            finalists_frames_dir = work_dir / f"frames_{i}"
            try:
                frames = vl.sample_frames(Path(f), v_start, float(v_end), finalists_frames_dir)
                verdict = vl._ask_vlm(frames, w["text"]) if frames else None
            except Exception:
                verdict = None
            if verdict:
                w["score01"] = round(min(w["score01"] * 0.60 + (verdict["score"] / 100) * 0.40, 1.0), 3)
            w["vl"] = verdict
        finalists.sort(key=lambda x: x["score01"], reverse=True)

    picks = finalists[:3]
    total_picks = len(picks)

    for i, w in enumerate(picks):
        stage_pct = 62 + int((i / max(total_picks, 1)) * 30)
        db.report_stage(job_id, "cutting", stage_pct)

        style = (job.get("caption_style") or ["hormozi", "beast", "karaoke"][i % 3])
        raw_cut = work_dir / f"clip_{i}_raw.mp4"

        section = section_files[i] if i < len(section_files) else None
        if section is not None:
            # Section is already cut to the window; reframe across its length.
            reframe.cut_and_reframe(Path(section), 0.0, float(w["end"]) - float(w["start"]), raw_cut)
        else:
            if full_video is None:
                full_video = ingest.download_full_video(job["source_url"], job_id)
            reframe.cut_and_reframe(full_video, float(w["start"]), float(w["end"]), raw_cut)

        title = titles.make_title(w)
        cues = captions_mod.build_cues(transcript["words"], float(w["start"]), float(w["end"]))

        db.report_stage(job_id, "rendering", min(stage_pct + 4, 95))
        duration = float(w["end"]) - float(w["start"])
        final = render_captions(raw_cut, cues, title, style, duration)

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
                "storage_path": path,
                "caption": caption_text,
                "hashtags": tags,
                "reasoning": reasoning,
                "provider": "local",
            }
        )

    db.complete_job(job_id)


def cleanup_job_dir(job_id: str) -> None:
    """Keep disk sane after completion."""
    import shutil

    d = config.WORK_DIR / job_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def main() -> None:
    config.WORK_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[sift-worker] polling every {config.POLL_INTERVAL_SECONDS}s …")
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
