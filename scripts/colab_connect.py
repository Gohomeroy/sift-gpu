#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════════
# SIFT Colab/Kaggle <-> opencode bridge.
#
# Run this in a notebook. It:
#   1. Installs cloudflared (no account needed — quick tunnel)
#   2. Clones the repo to REPO_DIR (if missing)
#   3. Writes worker/.env from .env.example, filling SUPABASE_*
#      and HF_TOKEN from the notebook's os.environ (secret keys stay on
#      Colab — they're never sent over the tunnel)
#   4. Starts a one-shot command-executor HTTP server on 127.0.0.1:8787
#   5. Exposes it via a random trycloudflare.com tunnel and prints BOTH
#      the tunnel URL and a random TOKEN
#
# Paste the printed URL + TOKEN back to the agent. The agent then drives
# the whole stack (clone -> deps -> models -> llama build -> services)
# over the tunnel using scripts/run_free_gpu.py.
#
# SECURITY: the executor accepts only commands carrying the matching TOKEN;
# the tunnel URL is random and dies when the notebook session ends. Still,
# never put secrets in a command you send through it — keep them in
# os.environ above.
#
# One cell:
#   import os
#   os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "PasteKeyHere"
#   os.environ["HF_TOKEN"] = "PasteHFHere"            # optional for public GGUF
#   !wget -q https://raw.githubusercontent.com/Gohomeroy/sift-gpu/master/scripts/colab_connect.py -O colab_connect.py
#   !python colab_connect.py
# ══════════════════════════════════════════════════════════════════════════

import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.parse
import json

REPO_URL = "https://github.com/Gohomeroy/sift-gpu.git"
REPO_DIR = "/content/sift" if os.path.isdir("/content") else "/kaggle/working/sift"
EXEC_PORT = 8787
TOKEN = secrets.token_hex(16)

def sh(cmd, check=False, timeout=600):
    print(f"$ {cmd}", flush=True)
    return subprocess.run(cmd, shell=True, check=check, timeout=timeout,
                          capture_output=True, text=True)

def install_cloudflared():
    if shutil.which("cloudflared"):
        return
    arch = "amd64"
    url = ("https://github.com/cloudflare/cloudflared/releases/latest/download/"
           f"cloudflared-linux-{arch}")
    sh(f"wget -q {url} -O /usr/local/bin/cloudflared && "
       "chmod +x /usr/local/bin/cloudflared")

def clone_repo():
    if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
        os.makedirs(REPO_DIR, exist_ok=True)
        sh(f"git clone --depth 1 -b master {REPO_URL} {REPO_DIR}", check=True)

def write_env():
    worker = os.path.join(REPO_DIR, "worker")
    src = os.path.join(worker, ".env.example")
    dst = os.path.join(worker, ".env")
    if not os.path.isfile(src):
        print("!! no worker/.env.example found", flush=True)
        return
    if not os.path.isfile(dst):
        shutil.copy(src, dst)
    # Fill from notebook env if the file currently has an empty value
    with open(dst, "r", encoding="utf-8") as f:
        lines = f.readlines()
    out = []
    for line in lines:
        m = re.match(r"^([A-Z0-9_]+)=", line)
        if m and m.group(1) in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "HF_TOKEN"):
            key = m.group(1)
            val = os.environ.get(key, "").strip()
            if val and line.rstrip("\n").endswith("="):
                out.append(f"{key}={val}\n")
                continue
        out.append(line)
    with open(dst, "w", encoding="utf-8") as f:
        f.writelines(out)
    env_text = "".join(out)
    empty = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
             if not env_text.split(k + "=", 1)[-1].splitlines()[0].strip()]
    if empty:
        print(f"!! empty in worker/.env: {empty} — paste them into os.environ in the "
              "notebook cell and re-run.", flush=True)

# ── command executor ───────────────────────────────────────────────────────
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_OUT = 60000

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # silent

    def _authed(self, q):
        return q.get("token", [""])[0] == TOKEN

    def do_GET(self):
        parts = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parts.query)
        if not self._authed(q):
            return self._send(403, b"forbidden")
        path = parts.path
        try:
            if path == "/health":
                return self._send(200, b"ok")
            if path == "/ps":
                r = subprocess.run(["ps", "-ef"], capture_output=True, text=True)
                return self._send(200, r.stdout[-MAX_OUT:].encode())
            if path == "/log":
                fp = q.get("file", [""])[0]
                tail = int(q.get("tail", ["200"])[0])
                if not fp or not os.path.isfile(fp):
                    return self._send(404, b"no such file")
                with open(fp, "r", errors="replace") as f:
                    data = f.read()[-MAX_OUT:]
                    data = "\n".join(data.splitlines()[-tail:])
                return self._send(200, data.encode())
            if path == "/run":
                cmd = q.get("cmd", [""])[0]
                timeout = int(q.get("timeout", ["7200"])[0])
                if not cmd.strip():
                    return self._send(400, b"empty cmd")
                r = subprocess.run(cmd, shell=True, timeout=timeout,
                                   capture_output=True, text=True)
                body = json.dumps({
                    "code": r.returncode,
                    "out": r.stdout[-MAX_OUT:],
                    "err": r.stderr[-MAX_OUT:],
                }).encode()
                return self._send(200, body, "application/json")
            return self._send(404, b"unknown endpoint")
        except subprocess.TimeoutExpired:
            return self._send(500, b"timeout")
        except Exception as e:
            return self._send(500, str(e).encode())

def start_executor():
    srv = ThreadingHTTPServer(("127.0.0.1", EXEC_PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"[executor] listening on 127.0.0.1:{EXEC_PORT}", flush=True)

def tunnel_url():
    logf = "/tmp/cf.log"
    if os.path.exists(logf):
        os.remove(logf)
    p = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{EXEC_PORT}",
         "--no-autoupdate", "--logfile", logf],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True)
    pat = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
    for _ in range(120):
        time.sleep(1)
        if p.poll() is not None:
            print("!! cloudflared exited", flush=True)
            return None
        try:
            with open(logf, "r", errors="replace") as f:
                text = f.read()
            m = pat.search(text)
            if m:
                return m.group(0)
        except Exception:
            pass
    print("!! no tunnel URL within 120s (tail /tmp/cf.log)", flush=True)
    return None

def main():
    print("== SIFT colab bridge ==", flush=True)
    install_cloudflared()
    clone_repo()
    write_env()
    start_executor()
    url = tunnel_url()
    if not url:
        return
    print("", flush=True)
    print("=" * 60, flush=True)
    print(f"SIFT_TUNNEL_URL={url}", flush=True)
    print(f"SIFT_TUNNEL_TOKEN={TOKEN}", flush=True)
    print("=" * 60, flush=True)
    print("Paste both lines back to the agent.", flush=True)
    while True:
        time.sleep(3600)

if __name__ == "__main__":
    main()