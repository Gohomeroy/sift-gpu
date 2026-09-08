#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# SIFT GPU Worker — One-Shot Setup (DEPRECATED wrapper)
# ══════════════════════════════════════════════════════════════════════════
# This script previously fat-fingered secrets into worker/.env. It's now a
# thin wrapper around scripts/bootstrap_pod.sh — the durable, idempotent,
# reload-safe bootstrap that lives IN the repo (not /tmp) and restores state
# from object storage (rclone "sift") when configured.
#
# Usage (fresh RunPod pod, pytorch:2.4.0-py3.11-cuda12.4.1):
#   bash setup_gpu.sh            # same as: bash scripts/bootstrap_pod.sh
#   bash setup_gpu.sh --cache    # also restore/pull analysis cache
#   bash setup_gpu.sh --models   # also restore/pull GGUF models
#
# NO SECRETS ARE EMBEDDED HERE. worker/.env comes from:
#   1) pod_state.sh restore (rclone remote "sift", object storage)
#   2) worker/.env.example (blanks — you fill secrets)
#   3) scp/your existing worker/.env
# Change REPO_DIR only if your pod layout differs.
# ──────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REPO_DIR="${REPO_DIR:-/workspace/sift}"
exec bash "$SCRIPT_DIR/scripts/bootstrap_pod.sh" "$@"