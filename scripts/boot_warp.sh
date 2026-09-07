#!/bin/bash
set -x
if ! pgrep -x warp-svc >/dev/null; then
  nohup warp-svc > /tmp/warp-svc.log 2>&1 &
  sleep 5
fi
status=$(warp-cli --accept-tos status 2>&1 | tr -d '\r')
echo "$status" | grep -qi "Connected"
if [ $? -ne 0 ]; then
  warp-cli --accept-tos registration new >/dev/null 2>&1
  warp-cli --accept-tos mode proxy >/dev/null 2>&1
  warp-cli --accept-tos proxy port 40000 >/dev/null 2>&1
  warp-cli --accept-tos connect >/dev/null 2>&1
  sleep 8
fi
curl -x socks5://127.0.0.1:40000 -s -o /dev/null -w "egress_ip=%{remote_ip} http=%{http_code}\n" https://www.cloudflare.com/cdn-cgi/trace || echo "EGRESS FAIL"