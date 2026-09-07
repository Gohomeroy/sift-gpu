#!/bin/bash
pkill -f "main.py"; sleep 2
cd /workspace/sift/worker
nohup python3 -u main.py >> /tmp/worker.log 2>&1 &
sleep 5
pgrep -f main.py >/dev/null && echo "worker_restarted" || echo "WORKER FAIL"