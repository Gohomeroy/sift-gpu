#!/bin/bash
# Relocatable: works from the repo (scripts/), not /tmp.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SCRIPT_DIR}/.."
WARN_TMP=0

if [ -f "$REPO_DIR/scripts/restart_render.sh" ] && [ -f "$REPO_DIR/scripts/restart_worker.sh" ] && [ -f "$REPO_DIR/scripts/boot_warp.sh" ]; then
  bash "$REPO_DIR/scripts/restart_render.sh"
  bash "$REPO_DIR/scripts/restart_worker.sh"
  bash "$REPO_DIR/scripts/boot_warp.sh"
else
  echo "restart_all.sh: scripts not found in repo — falling back to /tmp (legacy container)"
  bash /tmp/restart_render.sh
  bash /tmp/restart_worker.sh
  bash /tmp/boot_warp.sh
fi