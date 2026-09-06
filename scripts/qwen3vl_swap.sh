#!/usr/bin/env bash
# One-shot swap of the worker's VLM from Qwen2.5-VL to Qwen3-VL-8B.
#
# What it does:
#   1. Locates / builds llama-server (qwen3vl needs a recent llama.cpp).
#   2. Downloads Qwen3-VL-8B Q4_K_M + mmproj-F16 from unsloth (pre-quantized).
#   3. Stops any llama-server, DELETES the old Qwen2.5-VL models (no rollback).
#   4. Starts llama-server on :8080 with the new model.
#   5. Health-checks /health and does a tiny vision smoke test.
#
# Run (pod):  bash /workspace/sift/scripts/qwen3vl_swap.sh
# Env:        HF_TOKEN=<token>   (anonymous download works without it on unsloth)
# Options:    SKIP_REBUILD=1     reuse the existing llama-server binary
#             FORCE_REBUILD=1    always rebuild llama.cpp from HEAD
set -uo pipefail

LLAMA_BIN="${LLAMA_BIN:-/usr/local/bin/llama-server}"
LLAMA_PORT="${LLAMA_PORT:-8080}"
LLAMA_CTX="${LLAMA_CTX:-16384}"
MODEL_DIR="${MODEL_DIR:-/workspace/sift/worker/models}"
WORKER_DIR="${WORKER_DIR:-/workspace/sift/worker}"
LLAMA_BUILD="${LLAMA_BUILD:-/opt/llama.cpp}"

MODEL_Q4="$MODEL_DIR/Qwen3-VL-8B-Instruct-Q4_K_M.gguf"
MODEL_MM="$MODEL_DIR/mmproj-F16.gguf"
HF_REPO="unsloth/Qwen3-VL-8B-Instruct-GGUF"

log()  { echo -e "\e[1;32m[swap]\e[0m $*"; }
warn() { echo -e "\e[1;33m[swap]\e[0m $*" >&2; }
die()  { echo -e "\e[1;31m[swap] FAIL: $*\e[0m" >&2; exit 1; }

# ── 1 · llama-server (rebuild only when needed) ──────────────────────────
if [ ! -x "$LLAMA_BIN" ]; then
    log "llama-server not found — building llama.cpp (CUDA, ~3-5 min)..."
    FORCE_REBUILD=1
fi
if [ "${FORCE_REBUILD:-0}" = "1" ]; then
    if [ "${SKIP_REBUILD:-0}" = "1" ]; then
        die "llama-server missing and SKIP_REBUILD=1"
    fi
    NVC=$(command -v nvcc || true)
    if [ -z "$NVC" ] && [ -x "/usr/local/cuda-12.8/bin/nvcc" ]; then NVC=/usr/local/cuda-12.8/bin/nvcc; fi
    if [ -z "$NVC" ] && [ -x "/usr/local/cuda/bin/nvcc" ]; then NVC=/usr/local/cuda/bin/nvcc; fi
    [ -z "$NVC" ] && { apt-get install -y -qq nvidia-cuda-toolkit >/dev/null 2>&1 || true; NVC=$(command -v nvcc); }
    [ -z "$NVC" ] && die "nvcc not found"
    export CUDACXX="$NVC"
    if [ -d "$LLAMA_BUILD" ]; then rm -rf "$LLAMA_BUILD"; fi
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_BUILD" 2>&1 | tail -2 || die "clone failed"
    cd "$LLAMA_BUILD" || die "cd llama build failed"
    cmake -B build -DGGML_CUDA=ON -DLLAMA_CURL=OFF -DCMAKE_CUDA_ARCHITECTURES=86 \
        > /tmp/llama-cmake.log 2>&1 || die "cmake failed: $(tail -20 /tmp/llama-cmake.log)"
    cmake --build build --config Release -j$(nproc) > /tmp/llama-build.log 2>&1 \
        || die "build failed: $(tail -20 /tmp/llama-build.log)"
    [ -f build/bin/llama-server ] || die "llama-server binary not produced"
    cp build/bin/llama-server "$LLAMA_BIN"
    chmod +x "$LLAMA_BIN"
    cd /
    log "llama-server installed: $($LLAMA_BIN --version 2>&1 | head -1)"
fi
command -v "$LLAMA_BIN" >/dev/null || die "llama-server not available at $LLAMA_BIN"

# ── 2 · Download Qwen3-VL-8B models ─────────────────────────────────────
mkdir -p "$MODEL_DIR"
if [ -f "$MODEL_Q4" ] && [ -f "$MODEL_MM" ]; then
    log "Qwen3-VL-8B models already present"
else
    command -v huggingface-cli >/dev/null 2>&1 || pip install --quiet huggingface_hub
    log "Downloading Qwen3-VL-8B Q4_K_M (~4.7GB) + mmproj-F16 (~1.1GB)..."
    HF_TOKEN="${HF_TOKEN:-}" huggingface-cli download "$HF_REPO" \
        "Qwen3-VL-8B-Instruct-Q4_K_M.gguf" "mmproj-F16.gguf" \
        --local-dir "$MODEL_DIR" || die "model download failed"
fi
[ -f "$MODEL_Q4" ] && [ -f "$MODEL_MM" ] || die "model files missing after download"

# ── 3 · Stop old llama-server, delete Qwen2.5 models ────────────────────
pkill -f llama-server 2>/dev/null || true
sleep 2
log "Removing old Qwen2.5-VL models (no rollback):"
rm -fv "$MODEL_DIR"/Qwen2.5-VL-*.gguf "$MODEL_DIR"/mmproj-Qwen2.5-VL-*.gguf 2>/dev/null || true

# ── 4 · Start llama-server with Qwen3-VL-8B ────────────────────────────
log "Starting llama-server on :$LLAMA_PORT..."
nohup "$LLAMA_BIN" \
    --model "$MODEL_Q4" \
    --mmproj "$MODEL_MM" \
    --port "$LLAMA_PORT" \
    --ctx-size "$LLAMA_CTX" \
    --threads 4 \
    --n-gpu-layers 99 \
    --flash-attn on \
    --host 0.0.0.0 \
    > /tmp/llama-server.log 2>&1 &
echo "$!" > /tmp/llama-server.pid

# ── 5 · Health check + vision smoke test ────────────────────────────────
log "Waiting for llama-server to load the model..."
for _ in $(seq 1 90); do
    if curl -sf "http://127.0.0.1:$LLAMA_PORT/health" 2>/dev/null | grep -q "ok"; then
        log "llama-server ready (PID $(cat /tmp/llama-server.pid))"
        break
    fi
    if grep -qi "unknown architecture\|failed to load" /tmp/llama-server.log 2>/dev/null; then
        warn "Model failed to load — log tail:"
        tail -15 /tmp/llama-server.log
        warn "llama.cpp is probably too old for qwen3vl. Re-run with FORCE_REBUILD=1."
        exit 1
    fi
    sleep 3
done
curl -sf "http://127.0.0.1:$LLAMA_PORT/health" 2>/dev/null | grep -q "ok" \
    || die "llama-server not healthy — see /tmp/llama-server.log"

# Tiny vision smoke test: a 1px image through the OpenAI-compatible endpoint.
BASE64=$(printf '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x53\xde\x00\x00\x00\x0cIDAT\x78\x9c\x63\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\xfc\xd7\x00\x00\x00\x00IEND\xae\x42\x60\x82' | base64 -w0)
RESP=$(curl -sf -X POST "http://127.0.0.1:$LLAMA_PORT/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,$BASE64\"}},{\"type\":\"text\",\"text\":\"Reply with the single word: ok\"}]}],\"max_tokens\":16,\"temperature\":0}" 2>/dev/null) \
    || die "vision smoke test request failed"
echo "$RESP" | grep -qi '"content"' || die "no completion in smoke test response"
log "✓ Qwen3-VL-8B vision pass OK"
log "Done. Worker picks up the new model on its next VL call (LLAMA_SERVER_URL=http://127.0.0.1:$LLAMA_PORT)."
log "Logs: /tmp/llama-server.log"