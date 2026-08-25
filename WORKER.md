# SIFT Clip Worker — implementation guide

The AI Clipper UI queues jobs in `public.clip_jobs`. This worker processes
them on a local machine (CPU), and later on Oracle free-tier / any GPU box.
Two engines are planned behind one job contract:

| Provider | Detection | Status |
| --- | --- | --- |
| `local` | faster-whisper + heuristics + semantic centroids + **Qwen2.5-VL** watch pass | **built** (`worker/`) |
| `reka` | Reka Clip API (proprietary Reka Flash; returns finished clips w/ ai_score) | next phase |

## Pipeline (local provider)

```
queued
  → downloading   yt-dlp ≤1080p mp4 + ffmpeg mono 16k wav
  → transcribing  faster-whisper (base, int8) word timestamps
  → segmenting    sentences → 18-62s windows, pause-aware openers
  → scoring       hook/power/emotion/pacing heuristics
                  + MiniLM cosine vs viral centroids (optional CSV)
  → watching      top-8 windows → Qwen2.5-VL (llama-server) verdict JSON;
                  skipped silently when no server configured
  → cutting       top-3 windows · OpenCV face track @2fps → moving 9:16 crop
  → rendering     Remotion 1080x1920 · word-pop captions (hormozi/beast/
                  karaoke/boxed/minimal) · title bar · progress bar
completed         clips uploaded to private `clips` bucket + rows inserted
```

Scores map onto a 55–98 band for display. VL adds `caption` (social text),
`hashtags`, and `reasoning` ("why this clip") per clip.

## Setup (Windows/CPU)

```bash
cd sift/worker
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt

copy .env.example .env        # fill SUPABASE_URL + SERVICE ROLE KEY
```

Optional Qwen2.5-VL pass (~5GB download):

```bash
# llama.cpp build with multimodal support:
llama-server -m Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf ^
  --mmproj mmproj-Qwen2.5-VL-7B-F16.gguf --port 8080
```

Caption renderer (separate Node server):

```bash
cd remotion && npm install
set RENDER_FILES_DIR=C:\path\to\sift\worker\tmp
npm run server                # :3001
```

Run the worker:

```bash
python main.py
```

## Environment (worker/.env)

| Key | Purpose |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | queue + storage access (bypasses RLS) |
| `LLAMA_SERVER_URL` | llama.cpp server for the VL pass (optional) |
| `VIRAL_CSV_PATH` | viral-transcript CSV → semantic centroids (optional) |
| `WHISPER_MODEL` | tiny/base/small/medium (default base) |
| `VL_TOP_N` | how many finalists the VL pass watches (default 8) |
| `RENDER_SERVER_URL` | Remotion server (default http://127.0.0.1:3001) |
| `WORK_DIR` | scratch space for downloads/renders |

## Notes

- Keep concurrency at 1 job per machine — whisper and VL saturate CPU.
- Failed jobs land in `clip_jobs.status='failed'` with a human-readable error.
- Oracle free-tier target (4 ARM cores / 24GB): whisper + VL quantized fit
  comfortably; face tracking is the only piece worth GPU-accelerating later.
