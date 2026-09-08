#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# SIFT GPU Worker — One-Shot Pod Bootstrap (idempotent)
# ══════════════════════════════════════════════════════════════════════════
# Run this on a fresh RunPod pod (pytorch:2.4.0-py3.11-cuda12.4.1):
#   # clone once, then:
#   bash scripts/bootstrap_pod.sh
#
# What it does:
#   1. Syncs the repo to origin/master (clones if needed)
#   2. Restores durable state (worker/.env, cookies.txt, cache, models)
#      from object storage when rclone remote "sift" is configured
#   3. Installs system/python/node deps, yt-dlp, builds llama.cpp (CUDA)
#   4. Downloads Qwen3-VL-8B + Qwen3-8B models if not restored already
#   5. Starts llama-server, Qwen3-8B, Remotion render server, WARP, worker
#   6. Health check + status table
#
# Idempotent: safe to re-run; UNLESS you edit it first. Kills existing
# services at the start of the service phase. Paths default to /workspace/sift.
# ──────────────────────────────────────────────────────────────────────────

export DEBIAN_FRONTEND=noninteractive
export PIP_BREAK_SYSTEM_PACKAGES=1

REPO_URL="https://github.com/Gohomeroy/sift-gpu.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/workspace/sift}"
MODEL_DIR="$REPO_DIR/models"
MODEL_Q4="$MODEL_DIR/Qwen3-VL-8B-Instruct-Q4_K_M.gguf"
MODEL_MM="$MODEL_DIR/mmproj-F16.gguf"
QWEN_8B_MODEL="$MODEL_DIR/Qwen3-8B-Q4_K_M.gguf"
LLAMA_BUILD="${LLAMA_BUILD:-$HOME/llama-build}"
LLAMA_BIN="/usr/local/bin/llama-server"
LLAMA_PORT=8080
LLAMA_CTX="${LLAMA_CTX:-16384}"
QWEN_PORT=8082
QWEN8B_ENABLED="${QWEN8B_ENABLED:-1}"
RENDER_PORT=3002
WORK_DIR="$REPO_DIR/tmp"
WORKER_DIR="$REPO_DIR/worker"

log()  { echo -e "\033[1;32m[$(date +%H:%M:%S)] $*\033[0m"; }
warn() { echo -e "\033[1;33m[$(date +%H:%M:%S)] WARNING: $*\033[0m"; }
fail() { echo -e "\033[1;31m[$(date +%H:%M:%S)] FAILED: $*\033[0m"; exit 1; }

# ── STEP 1: repo sync ───────────────────────────────────────────────────────
log "═══ Step 1/9: repo sync (origin/master) ═══"
if [ ! -d "$REPO_DIR/.git" ]; then
  log "  cloning repo into $REPO_DIR"
  git clone --depth 1 -b master "$REPO_URL" "$REPO_DIR" || fail "git clone failed"
else
  cd "$REPO_DIR" || fail "cannot enter $REPO_DIR"
  git remote set-url origin "$REPO_URL" 2>/dev/null
  git fetch origin master --depth 1 2>&1 | tail -2
  git checkout -B master origin/master -f 2>&1 | tail -3
  git clean -fdx -e models -e tmp -e worker/.venv -e worker/cookies.txt 2>&1 | tail -2
  log "  ✓ repo synced"
fi
SCRIPT_DIR="$REPO_DIR/scripts"

# ── STEP 2: restore durable state ───────────────────────────────────────────
log "═══ Step 2/9: restore durable state ═══"
# If rclone remote "sift" exists, pull .env + cookies (+ cache/models if flags).
# This is the whole point: fresh pod ≠ re-download 11GB and rebuild.
RCLONE_OK=0
if command -v rclone >/dev/null 2>&1 && rclone lsd "sift:" >/dev/null 2>&1; then
  RCLONE_OK=1
  bash "$SCRIPT_DIR/pod_state.sh" restore "$@" 2>&1 | sed 's/^/  /'
  log "  ✓ state restored from sift:"
else
  warn "  rclone remote 'sift' not configured — .env/cookies/models will come from repo/example + downloads"
fi

# ── .env (only overwritten if we have something better) ─────────────────────
ENV_FILE="$WORKER_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$WORKER_DIR/.env.example" ]; then
    cp "$WORKER_DIR/.env.example" "$ENV_FILE"
    log "  ✓ worker/.env written from .env.example"
    warn "  .env has empty secrets — edit worker/.env or run pod_state.sh restore"
  else
    warn "  no .env.example — you must scp/provide worker/.env manually"
  fi
fi

# ── STEP 3: system packages + node ──────────────────────────────────────────
log "═══ Step 3/9: system packages ═══"
if python3 -c "import cv2" 2>/dev/null; then
  log "  system deps already satisfied"
else
  apt-get update -qq || true
  apt-get install -y -qq \
      ffmpeg libgl1 libegl1 libglib2.0-0 libsm6 libxext6 libxrender-dev \
      git curl wget build-essential cmake rclone 2>&1 | tail -2
  apt-get install -y -qq \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
      libpango-1.0-0 libcairo2 2>&1 | tail -1
  log "  ✓ system packages installed"
fi
if ! command -v node >/dev/null 2>&1; then
  log "  installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tail -1
  apt-get install -y -qq nodejs 2>&1 | tail -1
fi
log "  node: $(node --version) | rclone: $(command -v rclone >/dev/null && rclone version 2>/dev/null | head -1 || echo 'missing')"

# ── STEP 4: python deps ─────────────────────────────────────────────────────
log "═══ Step 4/9: python deps ═══"
if python3 -c "import cv2; import mediapipe; import scenedetect; import faster_whisper" 2>/dev/null; then
  log "  python deps already installed"
else
  pip install --quiet --upgrade pip 2>&1 | tail -1
  if ! python3 -c "import torch; assert torch.cuda.is_available()" 2>/dev/null; then
    pip install --quiet torch torchvision --index-url https://download.pytorch.org/whl/cu124 2>&1 | tail -1
  fi
  pip install --quiet \
      supabase yt-dlp faster-whisper opencv-python numpy sentence-transformers \
      requests python-dotenv "Pillow" "scenedetect" "mediapipe" "ultralytics" 2>&1 | tail -2
  log "  ✓ python deps installed"
fi

# ── STEP 5: yt-dlp binary ───────────────────────────────────────────────────
log "═══ Step 5/9: yt-dlp binary ═══"
if command -v yt-dlp >/dev/null 2>&1; then
  log "  yt-dlp already: $(yt-dlp --version)"
else
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
  log "  ✓ yt-dlp $(yt-dlp --version)"
fi

# ── STEP 6: llama.cpp CUDA build ────────────────────────────────────────────
log "═══ Step 6/9: llama.cpp (CUDA) ═══"
if [ -x "$LLAMA_BIN" ]; then
  log "  llama-server present: $LLAMA_BIN"
else
  NVC=$(command -v nvcc || true)
  if [ -z "$NVC" ] && [ -x "/usr/local/cuda-12.8/bin/nvcc" ]; then NVC=/usr/local/cuda-12.8/bin/nvcc; fi
  if [ -z "$NVC" ] && [ -x "/usr/local/cuda/bin/nvcc" ]; then NVC=/usr/local/cuda/bin/nvcc; fi
  if [ -z "$NVC" ]; then
    log "  nvcc not found, installing nvidia-cuda-toolkit..."
    apt-get install -y -qq nvidia-cuda-toolkit 2>&1 | tail -2
    NVC=$(command -v nvcc)
  fi
  export CUDACXX="$NVC"
  log "  nvcc: $NVC | building (3-5 min)..."
  rm -rf "$LLAMA_BUILD"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_BUILD" 2>&1 | tail -2
  cd "$LLAMA_BUILD"
  cmake -B build -DGGML_CUDA=ON -DLLAMA_CURL=OFF -DCMAKE_CUDA_ARCHITECTURES=86 > /tmp/llama-cmake.log 2>&1 || { tail -20 /tmp/llama-cmake.log; fail "cmake failed"; }
  cmake --build build --config Release -j"$(nproc)" > /tmp/llama-build.log 2>&1 || { tail -20 /tmp/llama-build.log; fail "build failed"; }
  cp build/bin/llama-server "$LLAMA_BIN" && chmod +x "$LLAMA_BIN"
  log "  ✓ llama-server built"
  cd "$REPO_DIR"
fi

# ── STEP 7: models ──────────────────────────────────────────────────────────
log "═══ Step 7/9: GGUF models ═══"
mkdir -p "$MODEL_DIR"
NEED_VL=0; NEED_8B=0
[ -f "$MODEL_Q4" ] && [ -f "$MODEL_MM" ] || NEED_VL=1
if [ "$QWEN8B_ENABLED" = "1" ] && [ ! -f "$QWEN_8B_MODEL" ]; then NEED_8B=1; fi
if [ "$NEED_VL" = "0" ] && [ "$NEED_8B" = "0" ]; then
  log "  all models present"
else
  pip install --quiet huggingface_hub 2>&1 | tail -1
  # HF token: from .env (HF_TOKEN=) or opted-in env
  HF_TOKEN_VAL=$(grep -E '^HF_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r')
  export HF_TOKEN="${HF_TOKEN:-$HF_TOKEN_VAL}"
fi
if [ "$NEED_VL" = "1" ]; then
  log "  downloading Qwen3-VL-8B Q4 (~4.7GB) + mmproj (~1.1GB)..."
  python3 - "$MODEL_DIR" <<'PY'
import os, sys
from huggingface_hub import hf_hub_download
d = sys.argv[1]
hf_hub_download('unsloth/Qwen3-VL-8B-Instruct-GGUF', 'Qwen3-VL-8B-Instruct-Q4_K_M.gguf', local_dir=d, token=os.environ.get('HF_TOKEN',''))
hf_hub_download('unsloth/Qwen3-VL-8B-Instruct-GGUF', 'mmproj-F16.gguf', local_dir=d, token=os.environ.get('HF_TOKEN',''))
PY
  log "  ✓ Qwen3-VL models"
fi
if [ "$NEED_8B" = "1" ]; then
  log "  downloading Qwen3-8B-Q4_K_M (~4.9GB)..."
  python3 - "$MODEL_DIR" <<'PY'
import os, sys
from huggingface_hub import hf_hub_download
d = sys.argv[1]
hf_hub_download('unsloth/Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf', local_dir=d, token=os.environ.get('HF_TOKEN',''))
PY
  log "  ✓ Qwen3-8B model"
fi

# ── STEP 8: start services (from repo scripts, NOT /tmp) ────────────────────
log "═══ Step 8/9: starting services ═══"
cd "$REPO_DIR/worker/remotion"
if [ ! -d node_modules ]; then
  log "  installing remotion deps..."
  npm install --quiet 2>&1 | tail -2
fi
cd "$REPO_DIR"

# WARP egress — only if warp is installed (fresh pods need it installed first)
if command -v warp-cli >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/boot_warp.sh" 2>&1 | sed 's/^/  /'
else
  warn "  warp-cli not installed — install WARP (Cloudflare team repo) for yt-dlp egress, then re-run"
fi

pkill -f llama-server 2>/dev/null || true
pkill -f "tsx server" 2>/dev/null || true
pkill -f "python3 -u main" 2>/dev/null || true
sleep 2

log "  starting llama-server (VL) on :$LLAMA_PORT..."
llama-server --model "$MODEL_Q4" --mmproj "$MODEL_MM" --port "$LLAMA_PORT" \
  --ctx-size "$LLAMA_CTX" --threads 4 --n-gpu-layers 99 --flash-attn on --host 0.0.0.0 \
  > /tmp/llama-server.log 2>&1 &

log "  waiting for llama-server..."
for i in $(seq 1 120); do
  curl -sf http://localhost:$LLAMA_PORT/health >/dev/null 2>&1 && { log "  ✓ llama-server ready"; break; }
  pgrep -f llama-server >/dev/null || { warn "  llama-server died"; tail -5 /tmp/llama-server.log; break; }
  sleep 3
done

if [ "$QWEN8B_ENABLED" = "1" ]; then
  log "  starting Qwen3-8B on :$QWEN_PORT..."
  llama-server --model "$QWEN_8B_MODEL" --port "$QWEN_PORT" \
    --ctx-size 8192 --threads 4 --n-gpu-layers 99 --flash-attn on --host 0.0.0.0 \
    > /tmp/llama-8b.log 2>&1 &
  for i in $(seq 1 120); do
    curl -sf http://localhost:$QWEN_PORT/health >/dev/null 2>&1 && { log "  ✓ Qwen3-8B ready"; break; }
    sleep 3
  done
fi

log "  starting render server on :$RENDER_PORT..."
cd "$REPO_DIR/worker/remotion"
PORT=$RENDER_PORT RENDER_FILES_DIR=$WORK_DIR npx tsx server/index.ts > /tmp/render-server.log 2>&1 &
cd "$REPO_DIR"
for i in $(seq 1 30); do
  curl -sf http://localhost:$RENDER_PORT/health >/dev/null 2>&1 && { log "  ✓ render server ready"; break; }
  sleep 2
done

log "  starting worker..."
cd "$WORKER_DIR"
nohup python3 -u main.py > /tmp/worker.log 2>&1 &
cd "$REPO_DIR"
log "  ✓ worker launched"

# ── STEP 9: health ─────────────────────────────────────────────────────────
log "═══ Step 9/9: health check ═══"
sleep 5
echo ""
CHK() { curl -sf "http://localhost:$2/health" >/dev/null 2>&1 && echo "✓ $1 (:$2)" || echo "✗ $1 (:$2) DOWN"; }
[ "$QWEN8B_ENABLED" = "0" ] && QWEN_PORT="(off)"
CHK llama-server "$LLAMA_PORT"
[ "$QWEN8B_ENABLED" = "1" ] && CHK qwen3-8b "$QWEN_PORT"
CHK render "$RENDER_PORT"
pgrep -f "python3 -u main" >/dev/null 2>&1 && echo "✓ worker (main.py)" || echo "✗ worker DOWN — tail /tmp/worker.log"
GPU=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
[ -n "$GPU" ] && echo "✓ gpu: $GPU MiB used" || echo "✗ nvidia-smi unavailable"
echo ""
log "done. logs: /tmp/llama-server.log /tmp/render-server.log /tmp/worker.log"