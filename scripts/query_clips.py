"""Ad-hoc inspector for clip_jobs on the active Supabase project.

Usage (run from the SIFT repo root with the Colab .env loaded):
    python scripts/query_clips.py ls                 # status counts
    python scripts/query_clips.py ls 25              # last 25 rows
    python scripts/query_clips.py show <job_id>      # full row JSON
    python scripts/query_clips.py requeue <job_id>   # set status=queued,
                                                      # clear stage/progress/error
"""
from __future__ import annotations
import json, sys

sys.path.insert(0, "worker")
import supabase_client as sb  # noqa: E402


def ls(n: int = 50) -> None:
    sb_c = sb._client()
    q = sb_c.table("clip_jobs").select("id,status,stage,progress,created_at,updated_at,error")
    res = q.order("updated_at", desc=True).limit(n).execute()
    counts: dict[str, int] = {}
    for r in res.data or []:
        counts[r.get("status") or "NULL"] = counts.get(r.get("status") or "NULL", 0) + 1
        e = (r.get("error") or "")[:60]
        print(f"- {r.get('id')} [{r.get('status')}] {r.get('stage', '?')} "
              f"p{r.get('progress', 0)} {r.get('created_at')} {r.get('updated_at')} "
              f"{e}")
    print("counts:", counts)


def show(job_id: str) -> None:
    sb_c = sb._client()
    res = sb_c.table("clip_jobs").select("*").eq("id", job_id).single().execute()
    print(json.dumps(res.data, indent=2, default=str))


def requeue(job_id: str) -> None:
    # Force the row back to queued so claim_next_job() can pick it up again.
    sb_c = sb._client()
    res = sb_c.table("clip_jobs").update(
        {"status": "queued", "stage": "queued", "progress": 0,
         "error": None, "updated_at": "now()"}
    ).eq("id", job_id).execute()
    print("requeued:", res.data)


def mk(source_url: str, title: str, clip_count: int = 1,
       content_type: str = "streamer") -> None:
    """Insert a fresh queued clip job (mirrors the web app's shape)."""
    # Reuse the organization that produced the 16 completed runs.
    org_id = "84a54e3f-ad03-44cc-b34b-ba68fd403176"
    created_by = "bbca7565-4d7f-48b9-948b-0fca51f7346d"
    sb_c = sb._client()
    res = sb_c.table("clip_jobs").insert({
        "organization_id": org_id,
        "created_by": created_by,
        "source_url": source_url,
        "title": title,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "provider": "local",
        "caption_style": "pop",
        "clip_count": clip_count,
        "caption_font": "anton",
        "caption_sub": "zoom",
        "caption_theme": "pop",
        "reframe_style": "track",
        "content_type": content_type,
    }).execute()
    print("inserted:", res.data[0]["id"], res.data[0]["status"])


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "ls":
        ls(int(args[1]) if len(args) > 1 and args[1].isdigit() else 50)
    elif args[0] == "show":
        show(args[1])
    elif args[0] == "requeue":
        requeue(args[1])
    elif args[0] == "mk" and len(args) >= 3:
        mk(args[1], args[2], int(args[3]) if len(args) > 3 else 1,
           args[4] if len(args) > 4 else "streamer")
    else:
        print(__doc__)
