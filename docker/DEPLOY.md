# SIFT GPU Deployment Guide

Deploy the SIFT worker to a rented GPU server (RunPod, Vast.ai, or any NVIDIA cloud).

## Prerequisites

- NVIDIA GPU with 24GB+ VRAM (RTX 3090, 4090, A100, H100)
- Docker installed
- NVIDIA Container Toolkit (`nvidia-docker2`)

## Quick Start (RunPod)

### 1. Create a GPU Pod

1. Go to [runpod.io](https://runpod.io) → Sign up / Log in
2. **Pods** → **Deploy** → Select GPU:
   - **RTX 3090** ($0.20–0.30/hr) — budget option
   - **RTX 4090** ($0.34–0.69/hr) — sweet spot
   - **A100 40GB** ($1.39/hr) — fast
3. Select **Community Cloud** (cheaper) or **Secure Cloud**
4. Choose template: **RunPod PyTorch 2.x** (CUDA pre-installed)
5. Set disk: **50GB** minimum (models + temp files)
6. Deploy

### 2. Connect to Your Pod

Once running, click **Connect** → **SSH** to get the connection string.

### 3. Upload Code

From your local machine:

```bash
# Zip the worker + docker folder
cd C:\Users\ROY\Desktop\sift
tar -czf sift-gpu.tar.gz worker/ docker/

# Upload via SCP (use RunPod's SSH details)
scp sift-gpu.tar.gz root@<POD_IP>:/root/
```

Or use RunPod's **Jupyter Lab** to upload directly.

### 4. Build & Run

On the GPU server:

```bash
cd /root
tar -xzf sift-gpu.tar.gz
cd sift

# Fill in your Supabase keys
cp docker/.env.gpu docker/.env
nano docker/.env  # Add your SUPABASE_SERVICE_ROLE_KEY

# Build the Docker image (~5-10 min first time)
docker compose -f docker/docker-compose.yml build

# Start the worker
docker compose -f docker/docker-compose.yml up -d

# Watch logs
docker compose -f docker/docker-compose.yml logs -f
```

### 5. Download Models (First Run)

The container needs the Qwen3-VL-8B model. On first run:

```bash
# Enter the container
docker exec -it sift-gpu-worker bash

# Download model (inside container)
pip install huggingface_hub
huggingface-cli download Qwen/Qwen3-VL-8B-Instruct \
    --include "*.gguf" \
    --local-dir /app/models/

# Or download from your local machine and upload:
# Qwen3-VL-8B-Instruct-Q4_K_M.gguf (~6GB)
# mmproj-Qwen3-VL-8B-F16.gguf (~1GB)
```

### 6. Verify

```bash
# Check health
curl http://localhost:8080/health

# Check worker logs
docker compose -f docker/docker-compose.yml logs -f sift-worker
```

## Alternative: Vast.ai

1. Go to [vast.ai](https://vast.ai) → Create account
2. Search for RTX 3090 or 4090 instances
3. Filter: 24GB+ VRAM, Docker support
4. Rent instance → SSH in
5. Follow same steps 3-6 above

## Model Download (Before Upload)

If you want to pre-download models locally:

```bash
# Install huggingface-cli
pip install huggingface_hub

# Download Qwen3-VL-8B GGUF (you need to convert or find pre-converted)
# Option 1: Use existing GGUF from your local models/ folder
# Option 2: Download from HuggingFace and convert with llama.cpp

# Upload to server
scp /path/to/Qwen3-VL-8B-Instruct-Q4_K_M.gguf root@<POD_IP>:/root/sift/models/
scp /path/to/mmproj-Qwen3-VL-8B-F16.gguf root@<POD_IP>:/root/sift/models/
```

## Cost Estimates

| GPU | $/hr | 100 clips | 3000 clips/month |
|---|---|---|---|
| RTX 3090 | $0.20 | ~$0.60 | ~$6–12 |
| RTX 4090 | $0.50 | ~$1.00 | ~$10–20 |
| A100 40GB | $1.39 | ~$2.10 | ~$25–50 |

**Shut down when not in use** — you're billed per second while running.

## Troubleshooting

### Model won't load (OOM)
- Use a smaller quantization (Q3_K_S instead of Q4_K_M)
- Reduce `LLAMA_CTX` to 2048
- Use a GPU with more VRAM

### yt-dlp download fails
- The worker tries multiple strategies (android, safari, cookies)
- On server, YouTube may rate-limit — add a small delay between jobs
- Set `YTDLP_COOKIES_FROM` if you have browser cookies available

### Render server crashes
- Remotion needs Chrome/Chromium headless
- The Dockerfile includes all necessary deps
- Check `/tmp/render-server.log` inside the container

### Worker says "No jobs"
- Check Supabase connection: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Submit a test job from the clipper UI
- Worker polls every 5 seconds — be patient

## Architecture

```
┌─────────────────────────────────────────────────┐
│              GPU Server (RunPod/Vast)            │
│                                                  │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ llama-server  │  │   SIFT Worker (Python) │   │
│  │ :8080         │  │                        │   │
│  │ Qwen3-VL-8B  │  │ download → transcribe  │   │
│  │ (GPU)        │←─│ → segment → VL score   │   │
│  └──────────────┘  │ → cut → render → upload│   │
│                     └────────────────────────┘   │
│  ┌──────────────┐                                │
│  │ Remotion     │  Ports: 8080 (VLM), 3001     │
│  │ :3001        │                                │
│  └──────────────┘                                │
└──────────────────────┬──────────────────────────┘
                       │ Upload clips
                       ▼
              ┌─────────────────┐
              │    Supabase     │
              │ (your existing  │
              │   database)     │
              └─────────────────┘
```

Nothing runs on your laptop — it just checks Supabase for completed clips.
