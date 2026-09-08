#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# SIFT Pod State — backup/restore GPU pod state to any object store (rclone)
# ══════════════════════════════════════════════════════════════════════════
# Purpose: pod disk is ephemeral. This keeps the durable-but-gitignored data
# (worker/.env, cookies.txt, the growing analysis cache, optionally models)
# in cheap object storage so a brand-new pod restores in minutes instead of
# re-downloading ~11GB + rebuilding everything.
#
# Usage (run ON the pod):
#   bash scripts/pod_state.sh backup                 # .env + cookies
#   bash scripts/pod_state.sh backup --cache         # + analysis cache
#   bash scripts/pod_state.sh backup --models        # + GGUF models (big)
#   bash scripts/pod_state.sh restore                # .env + cookies
#   bash scripts/pod_state.sh restore --cache        # + cache
#   bash scripts/pod_state.sh restore --models       # + models
#   bash scripts/pod_state.sh status                 # what's stored
#
# Requires: rclone configured with an S3-compatible remote named "sift"
#   rclone config → new remote, type "s3", provider "Cloudflare R2" (or
#   Backblaze B2 / AWS S3), give it a bucket. Remote name must be "sift".
#   Works with ANY rclone remote (s3, b2, drive, dropbox, ...).
#
# Idempotent. CRLF-safe: ends with `exit` before any CRLF-only line matters.
# ──────────────────────────────────────────────────────────────────────────

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${REMOTE_NAME:-sift}"
REMOTE="${REMOTE_NAME}:sift-pod"
CACHE_SRC="$REPO_DIR/tmp/cache"
MODELS_SRC="$REPO_DIR/models"
ENV_SRC="$REPO_DIR/worker/.env"
COOKIES_SRC="$REPO_DIR/worker/cookies.txt"

log()  { echo -e "\033[1;32m[pod_state] $*\033[0m"; }
warn() { echo -e "\033[1;33m[pod_state] WARNING: $*\033[0m"; }
die()  { echo -e "\033[1;31m[pod_state] FAILED: $*\033[0m"; exit 1; }

require_rclone() {
  if ! command -v rclone >/dev/null 2>&1; then
    die "rclone not installed (apt-get install -y rclone), or set REMOTE_NAME to a configured remote."
  fi
  if ! rclone lsd "${REMOTE_NAME}:" >/dev/null 2>&1; then
    cat >&2 <<EOF
[pod_state] FAILED: rclone remote "$REMOTE_NAME" not reachable.
  Configure it once:
    rclone config  -> type 's3', provider 'Cloudflare R2' (or your object store),
                      remote name exactly "$REMOTE_NAME".
EOF
    exit 1
  fi
}

backup() {
  require_rclone
  local want_cache=0 want_models=0
  for a in "$@"; do
    case "$a" in
      --cache)  want_cache=1 ;;
      --models) want_models=1 ;;
    esac
  done

  mkdir -p "$REPO_DIR/tmp"
  [ -f "$ENV_SRC" ]    && rclone copyto "$ENV_SRC"    "$REMOTE/env" 2>/dev/null && log "uploaded worker/.env"
  [ -f "$COOKIES_SRC" ] && rclone copyto "$COOKIES_SRC" "$REMOTE/cookies.txt" 2>/dev/null && log "uploaded cookies.txt"
  if [ "$want_cache" = "1" ] && [ -d "$CACHE_SRC" ]; then
    rclone sync "$CACHE_SRC" "$REMOTE/cache" 2>/dev/null && log "uploaded analysis cache"
  fi
  if [ "$want_models" = "1" ] && [ -d "$MODELS_SRC" ]; then
    rclone sync "$MODELS_SRC" "$REMOTE/models" 2>/dev/null && log "uploaded models"
  fi
  log "backup done → $REMOTE"
}

restore() {
  require_rclone
  local want_cache=0 want_models=0
  for a in "$@"; do
    case "$a" in
      --cache)  want_cache=1 ;;
      --models) want_models=1 ;;
    esac
  done

  mkdir -p "$REPO_DIR/tmp" "$REPO_DIR/worker"
  if rclone lsf "$REMOTE/env" >/dev/null 2>&1; then
    rclone copyto "$REMOTE/env" "$ENV_SRC" 2>/dev/null && log "restored worker/.env"
  else
    warn "no .env in storage — bootstrap will write one from worker/.env.example"
  fi
  if rclone lsf "$REMOTE/cookies.txt" >/dev/null 2>&1; then
    rclone copyto "$REMOTE/cookies.txt" "$COOKIES_SRC" 2>/dev/null && log "restored cookies.txt"
  else
    warn "no cookies.txt in storage — yt-dlp will run without it"
  fi
  if [ "$want_cache" = "1" ] && rclone lsf "$REMOTE/cache" >/dev/null 2>&1; then
    mkdir -p "$CACHE_SRC"
    rclone sync "$REMOTE/cache" "$CACHE_SRC" 2>/dev/null && log "restored analysis cache"
  fi
  if [ "$want_models" = "1" ] && rclone lsf "$REMOTE/models" >/dev/null 2>&1; then
    mkdir -p "$MODELS_SRC"
    rclone sync "$REMOTE/models" "$MODELS_SRC" 2>/dev/null && log "restored models"
  fi
  log "restore done"
}

status() {
  require_rclone
  echo "── stored at $REMOTE ──"
  rclone lsl "$REMOTE" 2>/dev/null || echo "(empty)"
  echo "── cache size (local) ──"
  du -sh "$CACHE_SRC" 2>/dev/null || echo "no cache"
  echo "── models size (local) ──"
  du -sh "$MODELS_SRC" 2>/dev/null || echo "no models"
}

case "${1:-}" in
  backup)  shift; backup "$@" ;;
  restore) shift; restore "$@" ;;
  status)  shift; status "$@" ;;
  *) echo "usage: $0 {backup|restore|status} [--cache] [--models]"; exit 1 ;;
esac