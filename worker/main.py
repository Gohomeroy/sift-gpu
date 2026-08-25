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

    # 1-2 · Download + audio
    db.report_stage(job_id, "downloading", 5)
    video = ingest.download(job["source_url"], job_id)
    db.report_stage(job_id, "downloading", 12)
    audio = ingest.extract_audio(video)
    db.report_stage(job_id, "transcribing", 18)

    # 3 · Transcribe
    transcript = transcribe.transcribe(str(audio))
    db.report_stage(job_id, "segmenting", 34)

    # 4 · Candidate windows
    windows = segment.build_windows(transcript["segments"])
    if not windows:
        raise RuntimeError("No speech found in the source video.")
    db.report_stage(job_id, "scoring", 42)

    # 5 · Cheap scoring of every window
    ranked = score.score_windows(windows)
    finalists = ranked[: max(config.VL_TOP_N, 3)]

    # 6 · Qwen2.5-VL watches the finalists
    db.report_stage(job_id, "watching", 55)
    if vl.available():
        finalists = vl.refine(video, finalists, work_dir)

    # Keep the best three — that's what renders.
    picks = finalists[:3]
    total_picks = len(picks)

    for i, w in enumerate(picks):
        stage_pct = 62 + int((i / max(total_picks, 1)) * 30)
        db.report_stage(job_id, "cutting", stage_pct)

        style = (job.get("caption_style") or ["hormozi", "beast", "karaoke"][i % 3])
        raw_cut = work_dir / f"clip_{i}_raw.mp4"
        reframe.cut_and_reframe(video, float(w["start"]), float(w["end"]), raw_cut)

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
