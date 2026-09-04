#!/usr/bin/env bash
# ── SIFT GPU Worker Startup ────────────────────────────────────────────
# Loads Qwen3-VL-8B into GPU via llama.cpp, then starts the Python worker.
# Set MODEL_PATH env var to point to your GGUF file.
# ────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODEL_PATH="${MODEL_PATH:-/app/models/Qwen3-VL-8B-Instruct-Q4_K_M.gguf}"
MMPROJECT_PATH="${MMPROJECT_PATH:-/app/models/mmproj-Qwen3-VL-8B-F16.gguf}"
LLAMA_PORT="${LLAMA_PORT:-8080}"
LLAMA_CTX="${LLAMA_CTX:-4096}"
LLAMA_THREADS="${LLAMA_THREADS:-4}"
WHISPER_MODEL="${WHISPER_MODEL:-base}"
RENDER_PORT="${RENDER_PORT:-3001}"
WORKER_POLL="${WORKER_POLL:-5}"

LLAMA_PID=""
RENDER_PID=""

cleanup() {
    echo "Shutting down..."
    [ -n "$LLAMA_PID" ] && kill $LLAMA_PID 2>/dev/null || true
    [ -n "$RENDER_PID" ] && kill $RENDER_PID 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "╔══════════════════════════════════════════════════════╗"
echo "║           SIFT GPU Worker — Starting Up              ║"
echo "╚══════════════════════════════════════════════════════╝"

# ── 1. Check GPU availability ──────────────────────────────────────────
echo "[1/4] Checking GPU..."
if ! nvidia-smi > /dev/null 2>&1; then
    echo "  ⚠ nvidia-smi not found — VL scoring will be skipped"
    echo "  Set LLAMA_SERVER_URL manually if using external endpoint"
fi

# ── 2. Start llama-server (VLM inference) ──────────────────────────────
echo "[2/4] Starting llama-server on port ${LLAMA_PORT}..."

if [ -f "$MODEL_PATH" ]; then
    llama-server \
        --model "$MODEL_PATH" \
        --mmproj "$MMPROJECT_PATH" \
        --port "$LLAMA_PORT" \
        --ctx-size "$LLAMA_CTX" \
        --threads "$LLAMA_THREADS" \
        --n-gpu-layers 99 \
        --flash-attn on \
        --host 0.0.0.0 \
        > /tmp/llama-server.log 2>&1 &

    LLAMA_PID=$!
    echo "  llama-server PID: $LLAMA_PID"

    # Wait for server to be ready
    echo "  Waiting for model to load..."
    for i in $(seq 1 120); do
        if curl -sf http://localhost:${LLAMA_PORT}/health > /dev/null 2>&1; then
            echo "  ✓ llama-server ready"
            break
        fi
        if ! kill -0 $LLAMA_PID 2>/dev/null; then
            echo "  ✗ llama-server died — check /tmp/llama-server.log"
            tail -30 /tmp/llama-server.log
            exit 1
        fi
        sleep 2
    done
else
    echo "  ⚠ Model not found at ${MODEL_PATH}"
    echo "  Download it: huggingface-cli download Qwen/Qwen3-VL-8B-Instruct"
    echo "  VL scoring will be skipped"
fi

# ── 3. Start Remotion render server ────────────────────────────────────
echo "[3/4] Starting Remotion render server on port ${RENDER_PORT}..."
cd /app/remotion
PORT=$RENDER_PORT npx tsx server/index.ts > /tmp/render-server.log 2>&1 &
RENDER_PID=$!
echo "  Render server PID: $RENDER_PID"
cd /app/worker

# ── 4. Start Python worker ─────────────────────────────────────────────
echo "[4/4] Starting SIFT worker..."
export LLAMA_SERVER_URL="http://127.0.0.1:${LLAMA_PORT}"
export RENDER_SERVER_URL="http://127.0.0.1:${RENDER_PORT}"
export WHISPER_MODEL
export WORK_DIR="/app/tmp"
export POLL_INTERVAL_SECONDS="$WORKER_POLL"

python main.py
