# SIFT Clip Worker — contract (Phase E)

The AI Clipper UI queues jobs in `public.clip_jobs`. A separate worker
server (GPU box — RunPod/Vast/your own) processes them. This document is the
full contract between the SIFT app and the worker.

## Environment

The worker needs the Supabase URL + **service role key** (bypasses RLS —
required to transition job states and insert clips). Treat it as a secret.

## Job lifecycle

```
queued ──► processing ──► completed
                │
                └──► failed (set error text)
```

1. **Claim**: poll for oldest `queued` job:
   ```sql
   select * from clip_jobs where status = 'queued' order by created_at limit 1;
   update clip_jobs set status = 'processing', updated_at = now() where id = <id>;
   ```
2. **Download** the source video from `source_url` (yt-dlp handles YouTube,
   Twitch VODs, most long-form platforms).
3. **Highlight detection** (open-source models): scene detection
   (`pyscenedetect`) + transcript-based scoring (faster-whisper for captions
   → score segments by hook words, question density, emotional spikes).
4. **Cut clips** with ffmpeg around the top segments (30–60s, vertical crop
   for shorts if desired).
5. **Render captions** with a viral preset (Remotion recommended — SIFT's
   caption presets map to Remotion components).
6. **Upload** each rendered clip to storage:
   `clips/<organization_id>/<job_id>/<uuid>.mp4`
7. **Insert clip rows**:
   ```sql
   insert into clips (job_id, organization_id, title, start_seconds,
     end_seconds, viral_score, caption_style, storage_path)
   values (...);
   ```
   - `viral_score`: 0–100 from the scoring model
   - `caption_style`: one of the preset names below
8. **Complete**: `update clip_jobs set status = 'completed', updated_at = now()`.
   On any fatal error: `status = 'failed', error = '<human-readable reason>'`.

## Caption presets (v1)

| Name | Look |
| --- | --- |
| `hormozi` | Bold uppercase yellow, black outline, center-bottom |
| `beast` | White with green highlight box, pop-in scale |
| `clean` | White, subtle shadow, bottom-center |
| `karaoke` | Word-by-word highlight sweep |

## Notes

- The UI renders clips via signed URLs (org members only — RLS on storage).
- Job status changes push to clients automatically (realtime publication).
- Keep worker concurrency per org low (1–2) to avoid download bans.
