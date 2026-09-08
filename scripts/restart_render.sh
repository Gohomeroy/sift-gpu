#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SCRIPT_DIR}/.."
REMOTION_DIR="${REPO_DIR}/worker/remotion"
pkill -f "tsx server"; sleep 2
cd "$REMOTION_DIR"
PORT=3002 RENDER_FILES_DIR="${REPO_DIR}/tmp" nohup npx tsx server/index.ts >> /tmp/render-server.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "render_http=%{http_code}\n" http://127.0.0.1:3002 || echo "RENDER FAIL"