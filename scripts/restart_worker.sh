#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SCRIPT_DIR}/.."
WORKER_DIR="${REPO_DIR}/worker"
pkill -f "main.py"; sleep 2
cd "$WORKER_DIR"
nohup python3 -u main.py >> /tmp/worker.log 2>&1 &
sleep 5
pgrep -f main.py >/dev/null && echo "worker_restarted" || echo "WORKER FAIL"