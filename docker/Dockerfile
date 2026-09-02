# ── SIFT GPU Worker ─────────────────────────────────────────────────────
# Multi-stage build: llama.cpp GPU build → Python worker → Node.js Remotion
# Target: RunPod / Vast.ai / any NVIDIA GPU server (RTX 3090+, CUDA 12+)
# ────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build llama.cpp with CUDA ─────────────────────────────────
FROM nvidia/cuda:12.6.3-devel-ubuntu22.04 AS llama-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/ggml-org/llama.cpp.git \
    && cd llama.cpp \
    && cmake -B build -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j$(nproc) --target llama-server llama-cli

# ── Stage 2: Python worker ────────────────────────────────────────────
FROM nvidia/cuda:12.6.3-runtime-ubuntu22.04 AS worker

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# System deps: ffmpeg, yt-dlp, Python 3.11, OpenCV headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3.11 \
    python3.11-venv \
    python3-pip \
    libgl1-mesa-glx \
    libglib2.0-0 \
    curl \
    wget \
    unzip \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp (latest)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

# Copy llama.cpp binaries from build stage
COPY --from=llama-build /build/llama.cpp/build/bin/ /usr/local/bin/

WORKDIR /app

# Python dependencies
COPY worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker code
COPY worker/ /app/worker/

# Copy Remotion renderer
COPY worker/remotion/ /app/remotion/

# Install Remotion deps
RUN cd /app/remotion && npm install --production

# Pre-download faster-whisper model (base)
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# Create working directory
RUN mkdir -p /app/tmp /app/models

# Expose ports: llama-server (8080), render server (3001)
EXPOSE 8080 3001

# Copy startup script
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

WORKDIR /app/worker

ENTRYPOINT ["/app/start.sh"]
