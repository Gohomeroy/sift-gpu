#!/bin/bash
pkill -f "tsx server"; sleep 2
cd /workspace/sift/worker/remotion
nohup npm run server >> /tmp/render-server.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "render_http=%{http_code}\n" http://127.0.0.1:3002 || echo "RENDER FAIL"