#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════════
# SIFT burst worker for Google Colab / Kaggle — runs the full stack on a
# FREE session GPU (T4 / P100 / L4 / A100) and drains the Supabase job
# queue while the session lives.
#
# Why this works at all:
#   - The worker is OUTBOUND-ONLY (polls Supabase, downloads youtube, uploads
#     clips). No inbound ports, no public IP needed. Render server talks to
#     the worker over localhost.
#   - Human stays in the session; if the session dies mid-job,
#     claim_next_job() re-claims jobs stuck in 'processing' after
#     CLAIM_TIMEOUT_MINUTES (90). Re-open the notebook and re-run = resume.
#   - Re-running is fully idempotent: models/llama build/emoji/npm deps are
#     all skipped if already present, so a re-run only costs <2 min.
#
# The honest gotchas (why it's a burst worker, not a 24/7 pod):
#   - Session caps: Colab free ~12h, Kaggle ~12h + ~30-40h GPU quota/week.
#   - Models (~11GB) live on the ephemeral disk; re-downloaded each session.
#   - The free-12h GPU is T4 (16GB) / Kaggle P100 (16GB): we auto-disable the
#     optional Qwen3-8B coding-assist server and shrink the VL context so the
#     Qwen3-VL server fits comfortably. A 24GB+ GPU keeps both servers.
#   - yt-dlp may hit the YouTube bot-wall from datacenter IPs — keep your
#     cookies.txt handy (YTDLP_COOKIES_FILE) if downloads start failing.
#
# Run once, paste the whole file into one notebook cell:
#   %%writefile run_free_gpu.py
#   <this file>
#   !python run_free_gpu.py --queue    # start worker + all services
#   !python run_free_gpu.py --status   # watch health
#   !python run_free_gpu.py --stop     # kill services
# ══════════════════════════════════════════════════════════════════════════

import argparse
import os
import platform
import shlex
import subprocess
import sys
import time

REPO_URL = "https://github.com/Gohomeroy/sift-gpu.git"
REPO_DIR = "/content/sift" if os.path.isdir("/content") else "/kaggle/working/sift"

# Free 12h GPUs are 16GB. Only disable the compile helpers; the pipeline
# (Qwen3-VL analysis) keeps running on the 16GB card.
VRAM_TWOGPU_GB = 22            # need ~22GB to host BOTH llama servers
VL_CTX_FREEBGPU = 8192
GEN_CTX_FREEBGPU = 4096

SERVICES = {
    "llama-vl":    ("http://127.0.0.1:8080/health",  "llama-server --model"),
    "qwen3-8b":    ("http://127.0.0.1:8082/health",  None),  # optional
    "render":      ("http://127.0.0.1:3002/health",  "tsx server/index.ts"),
    "worker":      (None, None),
}

def sh(cmd, check=True, **kw):
    print(f"\n$ {cmd}")
    return subprocess.run(shlex.split(cmd), check=check, **kw)

def sh_shell(cmd, check=True, **kw):
    print(f"\n$ {cmd}")
    return subprocess.run(cmd, shell=True, check=check, **kw)

def gpu_mem_gb():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total",
             "--format=csv,noheader,nounits"]
        ).decode().strip().split()[0]
        return int(out) // 1024
    except Exception:
        return 0

def detect_cuda_arch():
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=compute_cap",
             "--format=csv,noheader"]
        ).decode().strip().split(".")[:2]
        return "".join(out)
    except Exception:
        return "86"

# ── steps ─────────────────────────────────────────────────────────────────

def step_repo():
    if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
        os.makedirs(REPO_DIR, exist_ok=True)
        sh(f"git clone --depth 1 -b master {REPO_URL} {REPO_DIR}")
    else:
        sh_shell(f"cd {REPO_DIR} && git fetch origin master --depth 1 && git checkout -B master origin/master -f")
    return os.path.join(REPO_DIR, "worker")

def step_env(worker_dir):
    env_file = os.path.join(worker_dir, ".env")
    if not os.path.isfile(env_file):
        sh(f"cp {os.path.join(worker_dir, '.env.example')} {env_file}")
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "HF_TOKEN"):
        val = ""
        with open(env_file) as f:
            for line in f:
                if line.strip().startswith(k + "="):
                    val = line.split("=", 1)[1].strip()
        if k == "SUPABASE_SERVICE_ROLE_KEY" and not val:
            print(f"!!  worker/.env has empty {k} — paste your key into")
            print(f"!!  {env_file} (or use Colab 'Secrets' panel), then re-run.")

def step_system():
    # apt packages (best-effort — Colab root OK, Kaggle mostly OK)
    sh_shell(
        "DEBIAN_FRONTEND=noninteractive apt-get update -qq && "
        "apt-get install -y -qq ffmpeg libgl1 libegl1 libglib2.0-0 libsm6 "
        "libxext6 libxrender-dev git curl wget cmake build-essential "
        "libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2t64 libdrm2 "
        "libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 "
        "libgbm1 libasound2t64 libpango-1.0-0 libcairo2 2>&1 | tail -3",
        check=False,
    )

def step_python():
    sh_shell(
        "pip install -q supabase yt-dlp faster-whisper opencv-python numpy "
        "sentence-transformers requests python-dotenv Pillow scenedetect "
        "mediapipe ultralytics huggingface_hub 2>&1 | tail -3",
        check=False,
    )
    # torch+cuda wheels (skip if a working CUDA torch is already importable)
    try:
        import torch
        ok = torch.cuda.is_available()
    except Exception:
        ok = False
    if not ok:
        sh_shell("pip install -q torch torchvision --index-url "
                 "https://download.pytorch.org/whl/cu124 2>&1 | tail -3",
                 check=False)
    sh_shell("pip install -q --user yt-dlp 2>&1 | tail -2", check=False)

PREBUILT_OWNER_REPO = "waqasm86/Ubuntu-Cuda-Llama.cpp-Executable"

def prebuilt_asset_name():
    """Resolve the current GitHub-release asset name for the prebuilt CUDA bundle."""
    import json
    import urllib.request
    api = f"https://api.github.com/repos/{PREBUILT_OWNER_REPO}/releases/latest"
    try:
        with urllib.request.urlopen(api, timeout=30) as r:
            data = json.load(r)
        for a in data.get("assets", []):
            name = a.get("name", "")
            if "ubuntu-cuda-x64" in name:
                return name
    except Exception as exc:
        print(f"!! prebuilt asset lookup failed: {exc}")
    return ""

def try_prebuilt_llama(binary):
    """Download the community prebuilt CUDA llama-server (~290MB, no compile).

    Ubuntu 22.04 / CUDA 12.x build that Colab and Kaggle both satisfy. If it
    fails to load a CUDA runtime (old driver), falls back to the source build.
    """
    import urllib.request
    name = prebuilt_asset_name()
    if not name:
        return False
    url = f"https://github.com/{PREBUILT_OWNER_REPO}/releases/latest/download/{name}"
    tarball = "/tmp/llama-prebuilt.tar.xz"
    try:
        print(f"downloading prebuilt llama-server ({name})")
        urllib.request.urlretrieve(url, tarball)
        subprocess.run(["tar", "-xf", tarball, "-C", "/tmp"], check=True)
        found = subprocess.check_output(
            ["bash", "-c",
             f"find /tmp -name llama-server -type f 2>/dev/null | head -1"]
        ).decode().strip()
        if not found:
            return False
        sh(f"cp {found} {binary} && chmod +x {binary}")
        out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=30)
        if out.returncode == 0 and "CUDA" in (out.stdout + out.stderr):
            return True
        print("!! prebuilt llama-server failed version/CUDA check — falling back to build")
        try:
            os.remove(binary)
        except OSError:
            pass
    except Exception as exc:
        print(f"!! prebuilt download failed ({exc}) — falling back to build")
    return False

def step_llama(arch):
    """Ensure a CUDA llama-server binary. Prebuilt bundle first, else source build."""
    model_dir = os.path.join(REPO_DIR, "models")
    mod_vl = os.path.join(model_dir, "Qwen3-VL-8B-Instruct-Q4_K_M.gguf")
    mod_mm = os.path.join(model_dir, "mmproj-F16.gguf")
    for m in (mod_vl, mod_mm):
        if not os.path.isfile(m):
            print(f"missing model {m} — download with step_models() first")
            sys.exit(1)

    binary = "/usr/local/bin/llama-server"
    if os.path.isfile(binary):
        return binary
    if try_prebuilt_llama(binary):
        return binary
    src = os.path.join(REPO_DIR, "llama_cpp_build")
    if not os.path.isdir(src):
        sh(f"git clone --depth 1 https://github.com/ggml-org/llama.cpp {src}")
    subprocess.run(["cmake", "-E", "make_directory", os.path.join(REPO_DIR, "tmp")], check=False)
    sh(f"cmake -S {src} -B {src}/build -DGGML_CUDA=ON -DLLAMA_CURL=OFF "
       f"-DCMAKE_CUDA_ARCHITECTURES={arch}", check=False)
    sh(f"cmake --build {src}/build --config Release -j{os.cpu_count() or 4}", check=False)
    sh(f"cp {src}/build/bin/llama-server {binary} && chmod +x {binary}")
    return binary

def step_models(worker_dir):
    """Download Qwen3-VL GGUF if absent (Qwen3-8B only if there's VRAM)."""
    env_file = os.path.join(worker_dir, ".env")
    model_dir = os.path.join(REPO_DIR, "models")
    os.makedirs(model_dir, exist_ok=True)
    token = ""
    with open(env_file) as f:
        for line in f:
            if line.strip().startswith("HF_TOKEN="):
                token = line.split("=", 1)[1].strip()
    os.environ["HF_TOKEN"] = token
    import huggingface_hub
    for repo, fname, path in [
        ("unsloth/Qwen3-VL-8B-Instruct-GGUF", "Qwen3-VL-8B-Instruct-Q4_K_M.gguf",
         os.path.join(model_dir, "Qwen3-VL-8B-Instruct-Q4_K_M.gguf")),
        ("unsloth/Qwen3-VL-8B-Instruct-GGUF", "mmproj-F16.gguf",
         os.path.join(model_dir, "mmproj-F16.gguf")),
    ]:
        if not os.path.isfile(path):
            huggingface_hub.hf_hub_download(
                repo, fname, local_dir=model_dir, token=token.strip() or None)

def step_emoji():
    sh_shell(f"python3 {os.path.join(REPO_DIR, 'scripts', 'fetch_emojis.py')} "
             f"--dir {os.path.join(REPO_DIR, 'tmp', 'emoji')}")

def step_remotion():
    rem = os.path.join(REPO_DIR, "worker", "remotion")
    if not os.path.isdir(os.path.join(rem, "node_modules")):
        sh_shell(f"cd {rem} && npm install --quiet 2>&1 | tail -2")

def start_services():
    vram = gpu_mem_gb()
    two_servers = vram >= VRAM_TWOGPU_GB
    print(f"[gpu] {vram}GB VRAM detected — "
          f"{'both llama servers' if two_servers else 'VL-only (shrink ctx)'}")

    env = dict(os.environ)
    env.update({
        "RENDER_SERVER_URL": "http://127.0.0.1:3002",
        "WORK_DIR": os.path.join(REPO_DIR, "tmp"),
        "QWEN8B_ENABLED": "1" if two_servers else "0",
    })

    def bg(cmd, log, cwd=None):
        with open(log, "w") as lf:
            p = subprocess.Popen(shlex.split(cmd), stdout=lf, stderr=lf,
                                 env=env, start_new_session=True, cwd=cwd or REPO_DIR)
        return p

    # kill anything stale from a prior run in THIS session
    sh_shell("pkill -f llama-server; pkill -f 'tsx server'; "
             "pkill -f 'python3 -u main'", check=False)
    time.sleep(2)

    mod_dir = os.path.join(REPO_DIR, "models")
    ctx_vl = str(VL_CTX_FREEBGPU if not two_servers else 16384)
    p = bg(
        f"llama-server --model {mod_dir}/Qwen3-VL-8B-Instruct-Q4_K_M.gguf "
        f"--mmproj {mod_dir}/mmproj-F16.gguf --port 8080 --ctx-size {ctx_vl} "
        f"--threads 4 --n-gpu-layers 99 --flash-attn on --host 0.0.0.0 ",
        "/tmp/llama-vl.log",
    )
    print(f"  llama-vl pid={p.pid} ctx={ctx_vl}")

    if two_servers:
        mod8 = os.path.join(mod_dir, "Qwen3-8B-Q4_K_M.gguf")
        if os.path.isfile(mod8):
            p = bg(
                f"llama-server --model {mod8} --port 8082 "
                f"--ctx-size {GEN_CTX_FREEBGPU} --threads 4 --n-gpu-layers 99 "
                f"--flash-attn on --host 0.0.0.0 ",
                "/tmp/llama-8b.log",
            )
            print(f"  qwen3-8b pid={p.pid} (ctx {GEN_CTX_FREEBGPU})")

    rem = os.path.join(REPO_DIR, "worker", "remotion")
    p = bg(
        f"PORT=3002 RENDER_FILES_DIR={os.path.join(REPO_DIR, 'tmp')} "
        f"npx tsx server/index.ts",
        "/tmp/render.log", cwd=rem,
    )
    print(f"  render pid={p.pid}")
    time.sleep(1)  # npx/wd sensitive

    wdir = os.path.join(REPO_DIR, "worker")
    p = bg(f"python3 -u main.py", "/tmp/worker.log", cwd=wdir)
    print(f"  worker pid={p.pid}")

def health():
    def _h(url):
        try:
            import requests
            r = requests.get(url, timeout=3)
            return r.status_code == 200
        except Exception:
            return False
    lines = []
    lines.append(f"llama-vl  :8080  {'UP' if _h('http://127.0.0.1:8080/health') else 'DOWN'}   (tail /tmp/llama-vl.log)")
    if gpu_mem_gb() >= VRAM_TWOGPU_GB:
        lines.append(f"qwen3-8b  :8082  {'UP' if _h('http://127.0.0.1:8082/health') else 'DOWN'}   (tail /tmp/llama-8b.log)")
    lines.append(f"render    :3002  {'UP' if _h('http://127.0.0.1:3002/health') else 'DOWN'}   (tail /tmp/render.log)")
    worker = False
    try:
        out = subprocess.check_output(["pgrep", "-f", "python3 -u main"]).decode()
        worker = bool(out.strip())
    except Exception:
        worker = False
    lines.append(f"worker           {'UP' if worker else 'DOWN'}   (tail /tmp/worker.log)")
    gpu = "unavailable"
    try:
        gpu = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total",
             "--format=csv,noheader,nounits"]).decode().strip()
    except Exception:
        pass
    lines.append(f"gpu mem: {gpu} MiB")
    print("\n".join(lines))

def monitor():
    while True:
        health()
        print("-" * 40)
        time.sleep(60)

def stop():
    sh_shell("pkill -f llama-server; pkill -f 'tsx server'; "
             "pkill -f 'python3 -u main'", check=False)
    print("stopped.")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", action="store_true", help="bootstrap + start everything")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--monitor", action="store_true", help="status every 60s (keeps cell busy)")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    if args.stop:
        return stop()
    if args.status:
        return health()

    worker_dir = os.path.join(REPO_DIR, "worker")
    print(f"== SIFT free-GPU worker ({platform.node()}) ==")
    step_repo()

    step_env(worker_dir)
    step_system()
    step_python()
    step_models(worker_dir)
    arch = detect_cuda_arch()
    step_llama(arch)
    step_emoji()
    step_remotion()
    start_services()
    print("\n== services up ==")
    if args.monitor:
        monitor()

if __name__ == "__main__":
    main()