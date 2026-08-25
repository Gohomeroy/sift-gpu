"""Supabase service-role client + job/clip/storage operations.

The service role key bypasses RLS — required to transition job states and
insert clips. Treat it as a secret; never expose it to the app frontend.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from supabase import create_client

import config


def _client():
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — copy "
            "worker/.env.example to worker/.env and fill them in."
        )
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)


def claim_next_job() -> dict[str, Any] | None:
    """Atomically claim the oldest queued job (queued -> processing)."""
    sb = _client()
    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=config.CLAIM_TIMEOUT_MINUTES)
    ).isoformat()

    rows = (
        sb.table("clip_jobs")
        .select("*")
        .eq("status", "processing")
        .lt("updated_at", cutoff)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        rows = (
            sb.table("clip_jobs")
            .select("*")
            .eq("status", "queued")
            .order("created_at")
            .limit(1)
            .execute()
            .data
        )
    if not rows:
        return None

    job = rows[0]
    updated = (
        sb.table("clip_jobs")
        .update({"status": "processing", "stage": "starting", "progress": 1})
        .eq("id", job["id"])
        # Only win if nobody else claimed it first.
        .neq("stage", "downloading")
        .execute()
    )
    if not updated.data:
        return None
    return job


def report_stage(job_id: str, stage: str, progress: int) -> None:
    _client().table("clip_jobs").update(
        {"stage": stage, "progress": max(0, min(100, int(progress)))}
    ).eq("id", job_id).execute()


def fail_job(job_id: str, error: str) -> None:
    _client().table("clip_jobs").update(
        {"status": "failed", "error": error[:500], "stage": "failed"}
    ).eq("id", job_id).execute()


def complete_job(job_id: str) -> None:
    _client().table("clip_jobs").update(
        {"status": "completed", "stage": "completed", "progress": 100}
    ).eq("id", job_id).execute()


def upload_clip(org_id: str, job_id: str, local_path: str) -> str:
    """Upload a rendered mp4 to the private clips bucket; returns storage path."""
    sb = _client()
    path = f"{org_id}/{job_id}/{local_path.split('/')[-1].split(chr(92))[-1]}"
    with open(local_path, "rb") as fh:
        sb.storage.from_("clips").upload(
            path,
            fh.read(),
            {"content-type": "video/mp4", "upsert": "true"},
        )
    return path


def insert_clip(row: dict[str, Any]) -> None:
    payload = {
        "job_id": row["job_id"],
        "organization_id": row["organization_id"],
        "title": row.get("title") or "",
        "start_seconds": row.get("start_seconds"),
        "end_seconds": row.get("end_seconds"),
        "viral_score": row.get("viral_score"),
        "caption_style": row.get("caption_style"),
        "storage_path": row["storage_path"],
        "caption": row.get("caption"),
        "hashtags": json.dumps(row.get("hashtags") or []),
        "reasoning": row.get("reasoning"),
        "provider": row.get("provider", "local"),
    }
    _client().table("clips").insert(payload).execute()


def signed_clip_url(storage_path: str, expires: int = 3600 * 24) -> str:
    sb = _client()
    return sb.storage.from_("clips").create_signed_url(storage_path, expires)[
        "signedURL"
    ]


def notify_stage_webhook(job_id: str, stage: str) -> None:  # pragma: no cover
    """Placeholder hook point (e.g. Discord ping on failure) — intentionally no-op."""
