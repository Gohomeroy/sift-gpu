#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# SIFT GPU Worker — One-Shot Setup
# ══════════════════════════════════════════════════════════════════════════
# Run on a fresh RunPod pod (pytorch:2.4.0-py3.11-cuda12.4.1):
#   bash setup_gpu.sh
#
# What it does:
#   1. Installs system packages (ffmpeg, opencv deps, git, curl)
#   2. Installs Python dependencies from requirements.txt
#   3. Installs yt-dlp (standalone binary)
#   4. Builds llama.cpp with CUDA + installs llama-server
#   5. Downloads Qwen3-VL-8B GGUF models
#   6. Clones sift repo (master branch)
#   7. Writes worker/.env from template
#   8. Starts all services (llama-server, remotion, worker)
#   9. Verifies health of all services
#
# Idempotent: safe to re-run. Skips completed steps.
# ──────────────────────────────────────────────────────────────────────────
# No set -e — we handle errors per-step so apt warnings don't kill the script

# ── Config ────────────────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
export PIP_BREAK_SYSTEM_PACKAGES=1
REPO_URL="https://github.com/Gohomeroy/sift-gpu.git"
REPO_DIR="${REPO_DIR:-/root/sift}"
MODEL_DIR="$REPO_DIR/models"
MODEL_Q4="$MODEL_DIR/Qwen3-VL-8B-Instruct-Q4_K_M.gguf"
MODEL_MM="$MODEL_DIR/mmproj-F16.gguf"
LLAMA_BUILD="${LLAMA_BUILD:-/root/llama-build}"
LLAMA_BIN="/usr/local/bin/llama-server"
LLAMA_PORT=8080
RENDER_PORT=3002
WORKER_DIR="$REPO_DIR/worker"

# Supabase (from your .env — update if keys change)
SUPABASE_URL="https://lmgrfygmkdbejiyrbchp.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZ3JmeWdta2RiZWppeXJiY2hwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzUxNTYxMiwiZXhwIjoyMTAzMDkxNjEyfQ.2R8vhiqlvbCz7DjiCPOF22LK02ULi74qR_L-gTpBKpA"
export HF_TOKEN="${HF_TOKEN:-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}"

log() { echo -e "\033[1;32m[$(date +%H:%M:%S)] $*\033[0m"; }
warn() { echo -e "\033[1;33m[$(date +%H:%M:%S)] WARNING: $*\033[0m"; }
fail() { echo -e "\033[1;31m[$(date +%H:%M:%S)] FAILED: $*\033[0m"; exit 1; }

# ══════════════════════════════════════════════════════════════════════════
# STEP 1: System packages
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 1/9: System packages ═══"
if python3 -c "import cv2" 2>/dev/null; then
    log "  System packages already installed"
else
    apt-get update -qq || true
    apt-get install -y -qq \
        ffmpeg \
        libgl1 \
        libegl1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender-dev \
        git \
        curl \
        wget \
        build-essential \
        cmake \
        2>&1 | tail -3
    log "  ✓ System packages installed"
fi

# Node.js (needed for Remotion render server)
if command -v node &>/dev/null; then
    log "  Node.js already installed: $(node --version)"
else
    log "  Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tail -1
    apt-get install -y -qq nodejs 2>&1 | tail -2
    log "  ✓ Node.js installed: $(node --version)"
fi

# ══════════════════════════════════════════════════════════════════════════
# STEP 2: Python dependencies
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 2/9: Python dependencies ═══"
if python3 -c "import cv2; import mediapipe; import scenedetect; import faster_whisper" 2>/dev/null; then
    log "  Python deps already installed"
else
    pip install --quiet --upgrade pip 2>&1 | tail -1
    # Install torch first (check if CUDA-enabled torch already present)
    if python3 -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
        log "  CUDA torch already installed"
    else
        pip install --quiet torch torchvision --index-url https://download.pytorch.org/whl/cu124 2>&1 | tail -2
    fi
    pip install --quiet \
        supabase \
        yt-dlp \
        faster-whisper \
        opencv-python \
        numpy \
        sentence-transformers \
        requests \
        python-dotenv \
        "Pillow" \
        "scenedetect" \
        "mediapipe" \
        "ultralytics" \
        2>&1 | tail -3
    log "  ✓ Python deps installed"
fi

# ══════════════════════════════════════════════════════════════════════════
# STEP 3: yt-dlp standalone binary (latest)
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 3/9: yt-dlp binary ═══"
if command -v yt-dlp &>/dev/null; then
    log "  yt-dlp already installed: $(yt-dlp --version)"
else
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    chmod a+rx /usr/local/bin/yt-dlp
    log "  ✓ yt-dlp installed: $(yt-dlp --version)"
fi

# ══════════════════════════════════════════════════════════════════════════
# STEP 4: Build llama.cpp with CUDA
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 4/9: llama.cpp (CUDA) ═══"
if [ -f "$LLAMA_BIN" ]; then
    log "  llama-server already installed at $LLAMA_BIN"
else
    # Resolve nvcc: RunPod torch images keep it at /usr/local/cuda-12.8/bin (not on PATH)
    NVC=$(command -v nvcc || true)
    if [ -z "$NVC" ] && [ -x "/usr/local/cuda-12.8/bin/nvcc" ]; then NVC=/usr/local/cuda-12.8/bin/nvcc; fi
    if [ -z "$NVC" ] && [ -x "/usr/local/cuda/bin/nvcc" ]; then NVC=/usr/local/cuda/bin/nvcc; fi
    if [ -z "$NVC" ]; then
        log "  nvcc not found, installing nvidia-cuda-toolkit..."
        apt-get install -y -qq nvidia-cuda-toolkit 2>&1 | tail -2
        NVC=$(command -v nvcc)
    fi
    log "  Using nvcc: $NVC"
    export CUDACXX="$NVC"
    if [ -d "$LLAMA_BUILD" ]; then
        rm -rf "$LLAMA_BUILD"
    fi
    log "  Cloning llama.cpp..."
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_BUILD" 2>&1 | tail -3
    cd "$LLAMA_BUILD"
    log "  Building with CUDA (this takes ~3-5 min)..."
    cmake -B build -DGGML_CUDA=ON -DLLAMA_CURL=OFF -DCMAKE_CUDA_ARCHITECTURES=86 > /tmp/llama-cmake.log 2>&1 || { tail -20 /tmp/llama-cmake.log; fail "cmake configure failed"; }
    cmake --build build --config Release -j$(nproc) > /tmp/llama-build.log 2>&1 || { tail -20 /tmp/llama-build.log; fail "llama.cpp build failed"; }
    if [ -f build/bin/llama-server ]; then
        cp build/bin/llama-server "$LLAMA_BIN"
        chmod +x "$LLAMA_BIN"
        log "  ✓ llama-server installed"
    else
        fail "llama-server binary not produced"
    fi
    cd /root
fi

# ══════════════════════════════════════════════════════════════════════════
# STEP 5: Download Qwen3-VL-8B models
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 5/9: Qwen3-VL-8B models ═══"
mkdir -p "$MODEL_DIR"
if [ -f "$MODEL_Q4" ] && [ -f "$MODEL_MM" ]; then
    log "  Models already downloaded"
else
    pip install --quiet huggingface_hub
    log "  Downloading Q4_K_M (~4.7GB) + mmproj-F16 (~1.1GB)..."
    python3 -c "
from huggingface_hub import hf_hub_download
import os
d = '$MODEL_DIR'
t = os.environ.get('HF_TOKEN', '')
hf_hub_download('unsloth/Qwen3-VL-8B-Instruct-GGUF', 'Qwen3-VL-8B-Instruct-Q4_K_M.gguf', local_dir=d, token=t)
hf_hub_download('unsloth/Qwen3-VL-8B-Instruct-GGUF', 'mmproj-F16.gguf', local_dir=d, token=t)
print('  Done')
"
    log "  ✓ Models downloaded"
fi

# ══════════════════════════════════════════════════════════════════════════
# STEP 6: Clone / update sift repo
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 6/9: Sift repo ═══"
mkdir -p "$REPO_DIR"
cd "$REPO_DIR" || { fail "cannot enter $REPO_DIR"; }
if [ ! -d "$REPO_DIR/.git" ]; then
    git init -q -b master
fi
git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL"
git fetch origin master 2>&1 | tail -2
git checkout -B master origin/master 2>&1 | tail -3
git pull origin master 2>&1 | tail -2
log "  ✓ Repo synced to master"

# ══════════════════════════════════════════════════════════════════════════
# STEP 7: Write worker/.env
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 7/9: Worker .env ═══"
cat > "$WORKER_DIR/.env" << ENVEOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
LLAMA_SERVER_URL=http://127.0.0.1:$LLAMA_PORT
RENDER_SERVER_URL=http://127.0.0.1:$RENDER_PORT
WHISPER_MODEL=base
VL_TOP_N=8
REFRAME_ENGINE=v2
WORK_DIR=$REPO_DIR/tmp
POLL_INTERVAL_SECONDS=5
VL_DISCOVER_ENABLED=1
VL_DISCOVER_FRAMES=12
HOOK_STYLE=classic
HOOK_POSITION=top
HOOK_DURATION=4
POSTING_ENABLED=1
POST_POLL_INTERVAL=10
ENVEOF
log "  ✓ .env written"

# ══════════════════════════════════════════════════════════════════════════
# STEP 8: Start services
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 8/9: Starting services ═══"

# Install Remotion npm deps
log "  Installing Remotion dependencies..."
cd "$REPO_DIR/worker/remotion"
npm install --quiet 2>&1 | tail -2
cd "$REPO_DIR/worker"

# Kill any existing services
pkill -f llama-server 2>/dev/null || true
pkill -f "tsx server" 2>/dev/null || true
pkill -f "python3 -u main" 2>/dev/null || true
sleep 2

# 8a. llama-server
log "  Starting llama-server on port $LLAMA_PORT..."
llama-server \
    --model "$MODEL_Q4" \
    --mmproj "$MODEL_MM" \
    --port "$LLAMA_PORT" \
    --ctx-size 4096 \
    --threads 4 \
    --n-gpu-layers 99 \
    --flash-attn on \
    --host 0.0.0.0 \
    > /tmp/llama-server.log 2>&1 &
LLAMA_PID=$!
echo "$LLAMA_PID" > /tmp/llama-server.pid

# Wait for llama-server
log "  Waiting for llama-server to load model..."
for i in $(seq 1 120); do
    if curl -sf http://localhost:$LLAMA_PORT/health > /dev/null 2>&1; then
        log "  ✓ llama-server ready (PID: $LLAMA_PID)"
        break
    fi
    if ! kill -0 $LLAMA_PID 2>/dev/null; then
        warn "  llama-server died — check /tmp/llama-server.log"
        tail -10 /tmp/llama-server.log
        break
    fi
    sleep 3
done

# 8b. Remotion render server
log "  Starting Remotion on port $RENDER_PORT..."
cd "$REPO_DIR/worker/remotion"
PORT=$RENDER_PORT RENDER_FILES_DIR=$WORK_DIR npx tsx server/index.ts > /tmp/render-server.log 2>&1 &
RENDER_PID=$!
echo "$RENDER_PID" > /tmp/render-server.pid
cd "$WORKER_DIR"

# Wait for render server
for i in $(seq 1 30); do
    if curl -sf http://localhost:$RENDER_PORT/health > /dev/null 2>&1; then
        log "  ✓ Remotion ready (PID: $RENDER_PID)"
        break
    fi
    sleep 2
done

# 8c. Python worker
log "  Starting worker..."
cd "$WORKER_DIR"
nohup python3 -u main.py > /tmp/worker.log 2>&1 &
WORKER_PID=$!
echo "$WORKER_PID" > /tmp/worker.pid
log "  ✓ Worker started (PID: $WORKER_PID)"

# ══════════════════════════════════════════════════════════════════════════
# STEP 9: Health check
# ══════════════════════════════════════════════════════════════════════════
log "═══ Step 9/9: Health check ═══"
sleep 5

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    SERVICE STATUS                           ║"
echo "╠══════════════════════════════════════════════════════════════╣"

# llama-server
if curl -sf http://localhost:$LLAMA_PORT/health > /dev/null 2>&1; then
    echo "║  llama-server (VLM):    ✓ RUNNING on port $LLAMA_PORT            ║"
else
    echo "║  llama-server (VLM):    ✗ DOWN                                  ║"
fi

# Remotion
if curl -sf http://localhost:$RENDER_PORT/health > /dev/null 2>&1; then
    echo "║  Remotion (render):     ✓ RUNNING on port $RENDER_PORT            ║"
else
    echo "║  Remotion (render):     ✗ DOWN (will use ffmpeg fallback)         ║"
fi

# Worker
if kill -0 $WORKER_PID 2>/dev/null; then
    echo "║  Python worker:         ✓ RUNNING (polling every 5s)             ║"
else
    echo "║  Python worker:         ✗ DOWN — check /tmp/worker.log            ║"
fi

# GPU
GPU_MEM=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
if [ -n "$GPU_MEM" ]; then
    echo "║  GPU:                   ✓ $GPU_MEM MiB used                        ║"
else
    echo "║  GPU:                   ✗ nvidia-smi not available                 ║"
fi

echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
log "Setup complete. Worker is polling for jobs."
log "Logs: /tmp/llama-server.log | /tmp/render-server.log | /tmp/worker.log"
