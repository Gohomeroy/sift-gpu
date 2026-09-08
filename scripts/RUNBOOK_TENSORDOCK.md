# TensorDock 4090 provisioning — SIFT GPU worker

Tuned to what the repo expects (`bootstrap_pod.sh`: Ubuntu, plain bash,
builds llama.cpp itself, pip torch cu124, Node 22, `REPO_DIR=/workspace/sift`).

Why this provider: on-demand (~$0.35-0.55/hr 4090, per-second, no egress) at
RunPod-Community price but with persistent VMs — pick a **Core / Data Center
Verified** host so instances survive restarts instead of vanishing.

## 1. Order the instance (dashboard)

- **GPU:** RTX 4090 (24GB) | **Core tier / "Data Center Verified"** basis
  (NOT community — filters to ~99.1% uptime hosts)
- **Capacity:** >=8 vCPU, **32-64GB RAM** (you run 2x llama-server + whisper +
  ffmpeg), and the largest disk on offer, **>=200GB NVMe** (`tmp/cache` +
  videos + ~11GB models + emoji pack)
- **Region:** any — work is batch outbound (Supabase / youtube / HF), not
  user-facing
- **OS template:** Ubuntu 22.04 or 24.04 (base; NO pyTorch image needed — the
  bootstrap pip-installs `torch cu124` and builds llama.cpp from source)
- **Billing:** on-demand (per-second), no egress fees. Use **reserved** to pin
  the same host across restarts
- **SSH:** add your public key; note the host user/IP/port (key auth,
  sometimes a non-22 port)

## 2. Verify GPU before anything else

```bash
nvidia-smi     # must show the 4090 + driver version
nvcc --version # CUDA toolkit — if missing, bootstrap auto-installs it
```

If `nvidia-smi` errors, the image lacks a driver:

```bash
apt-get update && apt-get install -y ubuntu-drivers-common
ubuntu-drivers install && reboot
```

## 3. Clone + bootstrap (same as any pod — scripts are provider-agnostic)

```bash
apt-get update && apt-get install -y git
git clone --depth 1 -b master https://github.com/Gohomeroy/sift-gpu.git /workspace/sift
cd /workspace/sift
bash setup_gpu.sh        # = bash scripts/bootstrap_pod.sh (all 9 steps)
```

Covers: deps, llama.cpp CUDA build (3-5 min), GGUF downloads (~11GB — the slow
part on a virgin pod), emoji pack, services on `:8080 :8082 :3002`, worker,
and a Step 9 health table.

## 4. Secrets — the one gap on a fresh pod

No rclone `sift` remote exists yet (old pod died before a backup), so
bootstrap writes `worker/.env` from `.env.example` with **empty**
`SUPABASE_SERVICE_ROLE_KEY` and `HF_TOKEN`. Fill them:

```bash
nano /workspace/sift/worker/.env
```

- `SUPABASE_SERVICE_ROLE_KEY=` <- production service-role key (required)
- `HF_TOKEN=` <- HF token (used for model pulls; blank refills are fine)
- optionally `YTDLP_COOKIES_FILE=` (the `worker/cookies.txt`)

Then restart the worker — or simply re-run `setup_gpu.sh`:

```bash
pkill -f "python3 -u main"
cd /workspace/sift/worker && nohup python3 -u main.py > /tmp/worker.log 2>&1 &
```

## 5. Set up state backup (so this never happens again)

Once healthy:

```bash
apt-get install -y rclone     # bootstrap installs it anyway
rclone config                 # create remote named exactly: sift —> R2 / B2 / S3
cd /workspace/sift && bash scripts/pod_state.sh backup --cache --models
bash scripts/pod_state.sh status
```

Afterwards a dead pod costs minutes, not an 11GB re-download.

## Notes

- **Worker -> render server:** both live on the pod on `localhost:3002`
  (`RENDER_SERVER_URL=http://127.0.0.1:3002`) — no inbound ports needed.
  Optionally open 3002 for local debugging.
- **WARP egress:** bootstrap skips it when `warp-cli` is absent (fine unless
  you need the analysis cache).
- **Stop/start:** on-demand instances persist across restarts; a **reserved**
  host keeps the same machine so state is even safer.